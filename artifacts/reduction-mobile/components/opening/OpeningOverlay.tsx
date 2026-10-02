/**
 * components/opening/OpeningOverlay.tsx — draws the opening sequence over
 * the app, which boots underneath as normal.
 *
 * One clock, on the UI thread (`useFrameCallback`), advances `t`; one
 * derived value calls `sceneAt` (lib/opening/scene.ts) once per frame; every
 * drawn prop is read from that. No per-frame work reaches the JS thread:
 * it hears only "started" and "ended".
 *
 * Layers, back to front, as absolutely positioned siblings (never zIndex):
 *   the cream (or dark-to-cream) background, a View, off once the reveal
 *     begins — by then the zoomed interior covers the screen;
 *   the scene, one Svg: the pot, the liquid (its ripples and bubbles
 *     clipped to it), the pour — all clipped to OUTSIDE the reveal circle,
 *     so the live app shows through the hole — and the ring at its edge;
 *   the shaker and the bottle, each its own small Svg drawn once and moved
 *     by the GPU (transform and opacity only), since they never change shape.
 *
 * It captures every touch while it is up: a tap skips (150ms fade). It is
 * hidden from VoiceOver, and the parent unmounts it when it ends, so it
 * can never block the app.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from 'react-native-svg';
import { DARK_TO_CREAM_S, FADE_LEVELS, FULL, MAX_HOLD_S, QUICK, SKIP_FADE_S, STATIC } from '@/lib/opening/config';
import { BOTTLE, CREAM, DROPS, DROP_D, DROP_FILL, POT, SHAKER, STREAM, type BrandEl } from '@/lib/opening/brandShapes';
import { makeParticles, SPICE_COLOURS } from '@/lib/opening/particles';
import { RING_W, VIEWBOX, advance, frameStats, sceneAt, stageFor, staticOpacity, type Scene } from '@/lib/opening/scene';
import type { ReplayKind } from '@/lib/opening/launch';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const PARTICLES = makeParticles();
const DARK = '#211a16';
const EMPTY = 'M0 0';
const d = (s: string) => {
  'worklet';
  return s === '' ? EMPTY : s;
};

export interface Props {
  kind: ReplayKind;
  /** The system is dark: open on the splash's #211a16 and fade to cream. */
  darkStart: boolean;
  /** Set true by the parent when the app underneath can be revealed. */
  ready: SharedValue<boolean>;
  /** Show this frame and stand still (web development screenshots only). */
  frozenT?: number;
  /** The first frame is on screen (hide the native splash now). */
  onShown: () => void;
  /** The clock has started: this counts as shown. */
  onStarted: () => void;
  onEnded: (stats: ReturnType<typeof frameStats>) => void;
}

export function OpeningOverlay({ kind, darkStart, ready, frozenT, onShown, onStarted, onEnded }: Props) {
  const { width, height } = useWindowDimensions();
  const stage = useMemo(() => stageFor(width, height), [width, height]);
  const tl = kind === 'quick' ? QUICK : FULL;
  const pour = kind === 'quick' ? PARTICLES.quick : PARTICLES.full;
  const bubbles = PARTICLES.bubbles;
  const pre = darkStart ? DARK_TO_CREAM_S : 0;
  const isStatic = kind === 'static';
  const revStart = isStatic ? STATIC.hold : tl.rev[0];
  const total = isStatic ? STATIC.total : tl.total;

  const t = useSharedValue(frozenT ?? -pre);
  const hold = useSharedValue(0);
  const fade = useSharedValue(1);
  const ended = useSharedValue(false);
  const frames = useSharedValue(0);
  const sumMs = useSharedValue(0);
  const worstMs = useSharedValue(0);
  const slow = useSharedValue(0);

  const finishedRef = useRef(false);
  const finish = (f: number, sum: number, worst: number, sl: number) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    // frameStats from the running totals: its average and worst are all
    // the sheet shows, so the frames themselves are never shipped over.
    const avg = f ? sum / f : 0;
    onEnded({ frames: f, avgFps: avg ? Math.round(1000 / avg) : 0, worstFps: worst ? Math.round(1000 / worst) : 0, slow: sl, seconds: Math.round(sum) / 1000 });
  };

  const clock = useFrameCallback((info) => {
    'worklet';
    if (ended.value) return;
    const dtMs = info.timeSincePreviousFrame;
    if (dtMs !== null) {
      frames.value += 1;
      sumMs.value += dtMs;
      worstMs.value = Math.max(worstMs.value, dtMs);
      if (dtMs > 1000 / 55) slow.value += 1;
    }
    const c = advance({ t: t.value, hold: hold.value }, (dtMs ?? 16.67) / 1000, ready.value, revStart, total, MAX_HOLD_S);
    t.value = c.t;
    hold.value = c.hold;
    if (c.t >= total) {
      ended.value = true;
      runOnJS(finish)(frames.value, sumMs.value, worstMs.value, slow.value);
    }
  }, false);

  // Start once the first frame is on screen: the parent hides the native
  // splash in onShown, and only then does anything move or count as shown.
  const shown = useRef(false);
  const onLayout = () => {
    if (shown.current) return;
    shown.current = true;
    onShown();
    if (frozenT !== undefined) return;
    requestAnimationFrame(() => {
      onStarted();
      clock.setActive(true);
    });
  };
  useEffect(() => () => clock.setActive(false), [clock]);

  const skip = () => {
    if (frozenT !== undefined || ended.value) return;
    ended.value = true;
    clock.setActive(false);
    const f = frames.value;
    const s = sumMs.value;
    const w = worstMs.value;
    const sl = slow.value;
    fade.value = withTiming(0, { duration: SKIP_FADE_S * 1000 }, (done) => {
      if (done) runOnJS(finish)(f, s, w, sl);
    });
  };

  const scene = useDerivedValue<Scene | null>(() =>
    isStatic ? null : sceneAt(tl, t.value, stage, pour, bubbles, hold.value, pre, FADE_LEVELS)
  );

  const containerStyle = useAnimatedStyle(() => ({
    opacity: fade.value * (isStatic ? staticOpacity(t.value, STATIC.hold, STATIC.fade) : 1),
  }));
  const bgStyle = useAnimatedStyle(() => {
    const s = scene.value;
    const cream = isStatic ? (pre > 0 ? Math.max(0, Math.min(1, (t.value + pre) / pre)) : 1) : s!.bgCream;
    if (s && !s.bgOn) return { backgroundColor: 'transparent' };
    return { backgroundColor: interpolateColor(cream, [0, 1], [DARK, CREAM]) };
  });

  return (
    <Animated.View
      // Clipped: the shaker and the bottle are moved by transforms, and
      // off-screen (or scaled by the dive) they must not grow the page.
      style={[StyleSheet.absoluteFill, styles.clip, containerStyle]}
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`opening-${kind}`}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={skip} accessible={false} testID="opening-skip">
        <Animated.View style={[StyleSheet.absoluteFill, bgStyle]} />
        {isStatic ? (
          <StillArtwork width={width} height={height} />
        ) : (
          <>
            <SceneSvg scene={scene as SharedValue<Scene>} width={width} height={height} />
            <Layer scene={scene as SharedValue<Scene>} which="shaker" stage={stage} />
            <Layer scene={scene as SharedValue<Scene>} which="bottle" stage={stage} />
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });

// ——— the scene ———

// Explicit sizes, not absoluteFill alone: on the web react-native-svg sizes
// an <svg> from its viewBox's aspect ratio, which put the scene 160px low
// on an iPhone 13 and left the bottom of a Pro Max uncovered by the dive.
function SceneSvg({ scene, width, height }: { scene: SharedValue<Scene>; width: number; height: number }) {
  const L = FADE_LEVELS;
  const hole = useAnimatedProps(() => ({ d: scene.value.hole }));
  const liquid = useAnimatedProps(() => ({ d: scene.value.liquid }));
  const pot = useAnimatedProps(() => ({ opacity: scene.value.potOpacity }));
  const handleL = useAnimatedProps(() => ({ d: d(scene.value.handles[0]) }));
  const handleR = useAnimatedProps(() => ({ d: d(scene.value.handles[1]) }));
  const body = useAnimatedProps(() => ({ d: scene.value.body, opacity: scene.value.bodyOpacity }));
  const rim = useAnimatedProps(() => ({ d: scene.value.rim }));
  const inner = useAnimatedProps(() => ({ d: scene.value.inner }));
  const sp0 = useAnimatedProps(() => ({ d: d(scene.value.spice[0]) }));
  const sp1 = useAnimatedProps(() => ({ d: d(scene.value.spice[1]) }));
  const sp2 = useAnimatedProps(() => ({ d: d(scene.value.spice[2]) }));
  const drops = useAnimatedProps(() => ({ d: d(scene.value.drops) }));
  const ring = useAnimatedProps(() => ({ r: scene.value.ringR, opacity: scene.value.ringOpacity }));
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height} viewBox={VIEWBOX} preserveAspectRatio="xMidYMid slice">
      <Defs>
        <ClipPath id="opening-hole">
          <AnimatedPath animatedProps={hole} clipRule="evenodd" />
        </ClipPath>
        <ClipPath id="opening-liquid">
          <AnimatedPath animatedProps={liquid} />
        </ClipPath>
      </Defs>
      <G clipPath="url(#opening-hole)">
        <AnimatedG animatedProps={pot}>
          <AnimatedPath animatedProps={handleL} fill={POT.handleFill} />
          <AnimatedPath animatedProps={handleR} fill={POT.handleFill} />
          <AnimatedPath animatedProps={body} fill={POT.body.fill} />
          <AnimatedPath animatedProps={rim} fill={POT.rim.fill} />
          <AnimatedPath animatedProps={inner} fill={POT.inner.fill} />
          <G clipPath="url(#opening-liquid)">
            {Array.from({ length: 2 * L }, (_, i) => (
              <Ripple key={`r${i}`} scene={scene} index={i} />
            ))}
            {Array.from({ length: L }, (_, i) => (
              <Bubbles key={`b${i}`} scene={scene} level={i} />
            ))}
          </G>
        </AnimatedG>
        <AnimatedPath animatedProps={sp0} fill={SPICE_COLOURS[0]} />
        <AnimatedPath animatedProps={sp1} fill={SPICE_COLOURS[1]} />
        <AnimatedPath animatedProps={sp2} fill={SPICE_COLOURS[2]} />
        <AnimatedPath animatedProps={drops} fill={DROP_FILL} />
      </G>
      <AnimatedCircle cx={512} cy={512} animatedProps={ring} fill="none" stroke="rgba(255,236,210,0.85)" strokeWidth={RING_W} />
    </Svg>
  );
}

/** One fade level of one kind of ripple: all of them are one path. */
function Ripple({ scene, index }: { scene: SharedValue<Scene>; index: number }) {
  const L = FADE_LEVELS;
  const spice = index < L;
  const props = useAnimatedProps(() => ({ d: d(scene.value.ripples[index]), strokeWidth: scene.value.rippleWidth }));
  return (
    <AnimatedPath
      animatedProps={props}
      fill="none"
      stroke={spice ? 'rgba(255,196,150,0.9)' : '#e0a23a'}
      opacity={(0.9 * ((index % L) + 1)) / L}
    />
  );
}

/** One fade level of bubbles: mostly the top one; a popping bubble steps
 *  down through the rest as it fades. */
function Bubbles({ scene, level }: { scene: SharedValue<Scene>; level: number }) {
  const props = useAnimatedProps(() => ({ d: d(scene.value.bubbles[level]), strokeWidth: scene.value.bubbleWidth }));
  return (
    <AnimatedPath
      animatedProps={props}
      fill="rgba(255,210,160,0.14)"
      stroke="rgba(255,215,170,0.6)"
      opacity={(level + 1) / FADE_LEVELS}
    />
  );
}

// ——— the shaker and the bottle ———

function Layer({ scene, which, stage }: { scene: SharedValue<Scene>; which: 'shaker' | 'bottle'; stage: ReturnType<typeof stageFor> }) {
  const art = which === 'shaker' ? SHAKER : BOTTLE;
  const E = art.extent * stage.k;
  const style = useAnimatedStyle(() => {
    const p = scene.value[which];
    const X = stage.ox + p.x * stage.k;
    const Y = stage.oy + p.y * stage.k;
    return {
      opacity: p.opacity,
      transform: [{ translateX: X - E }, { translateY: Y - E }, { rotate: `${p.rot}deg` }, { scale: p.scale }],
    };
  });
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 2 * E, height: 2 * E }, style]}>
      <Svg width={2 * E} height={2 * E} viewBox={`${-art.extent} ${-art.extent} ${2 * art.extent} ${2 * art.extent}`}>
        <PartArt which={which} />
      </Svg>
    </Animated.View>
  );
}

function renderEl(e: BrandEl, key: string, clipIds: Record<string, string>) {
  const clip = 'clip' in e && e.clip ? `url(#${clipIds[e.clip]})` : undefined;
  switch (e.tag) {
    case 'rect':
      return <Rect key={key} x={e.x} y={e.y} width={e.width} height={e.height} rx={e.rx} fill={e.fill} opacity={e.opacity} clipPath={clip} />;
    case 'circle':
      return <Circle key={key} cx={e.cx} cy={e.cy} r={e.r} fill={e.fill} />;
    case 'ellipse':
      return <Ellipse key={key} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill={e.fill} />;
    case 'path':
      return <Path key={key} d={e.d} fill={e.fill} transform={e.transform} />;
  }
}

/** The shaker or the bottle in its own coordinates, the artwork's own
 *  elements (lib/opening/brandShapes.ts). */
function PartArt({ which, idPrefix = 'layer' }: { which: 'shaker' | 'bottle'; idPrefix?: string }) {
  const ids = { jar: `${idPrefix}-jar`, bottle: `${idPrefix}-bottle` };
  return which === 'shaker' ? (
    <>
      <Defs>
        <ClipPath id={ids.jar}>
          <Rect {...SHAKER.clip} />
        </ClipPath>
      </Defs>
      {SHAKER.els.map((e, i) => renderEl(e, `s${i}`, ids))}
    </>
  ) : (
    <>
      <Defs>
        <ClipPath id={ids.bottle}>
          <Path d={BOTTLE.clipD} />
        </ClipPath>
      </Defs>
      {BOTTLE.els.map((e, i) => renderEl(e, `b${i}`, ids))}
    </>
  );
}

// ——— Reduce Motion: the artwork, still ———

/** The mark exactly as the icon draws it, in the scene's frame (so it sits
 *  where the animation's first frames put the pot). */
function StillArtwork({ width, height }: { width: number; height: number }) {
  return (
    <Svg style={StyleSheet.absoluteFill} width={width} height={height} viewBox={VIEWBOX} preserveAspectRatio="xMidYMid slice" testID="opening-still">
      {POT.handles.map((h, i) => (
        <Rect key={`h${i}`} {...h} fill={POT.handleFill} />
      ))}
      <Path d={POT.body.d} fill={POT.body.fill} />
      <Ellipse {...POT.rim} />
      <Ellipse {...POT.inner} />
      <Ellipse {...POT.slick} />
      {POT.flecks.map((f, i) => (
        <Circle key={`f${i}`} {...f} />
      ))}
      {STREAM.map((c, i) => (
        <Circle key={`c${i}`} {...c} />
      ))}
      {DROPS.map((p, i) => (
        <Path key={`d${i}`} d={DROP_D} fill={DROP_FILL} transform={`translate(${p.x} ${p.y}) scale(${p.s})`} />
      ))}
      <G transform={`translate(${SHAKER.at.x} ${SHAKER.at.y}) rotate(${SHAKER.at.rotate})`}>
        <PartArt which="shaker" idPrefix="still" />
      </G>
      <G transform={`translate(${BOTTLE.at.x} ${BOTTLE.at.y}) rotate(${BOTTLE.at.rotate})`}>
        <PartArt which="bottle" idPrefix="still" />
      </G>
    </Svg>
  );
}
