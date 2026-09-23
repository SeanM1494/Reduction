/**
 * app/dev/flip.tsx — DEVELOPMENT BUILDS ONLY. A test of the Recipe Box page
 * flip on a real iPhone, before the book is built on top of it. It goes
 * when step 2 lands; a release build redirects away from it.
 *
 * The question it answers: does a 3D page turn — rotateY with perspective,
 * hinged at the spine by transformOrigin — render correctly on iOS in this
 * React Native? Two structures, switchable, because they fail differently:
 *
 *   NESTED — the prototype's: one leaf holding both faces, the back face
 *   pre-rotated 180° and culled with backfaceVisibility: 'hidden'. It needs
 *   the leaf's children to stay in 3D. React Native renders each view as its
 *   own flat layer, so on iOS the back face may show MIRRORED through the
 *   front, or never appear at all.
 *
 *   SPLIT — the front and back faces are two separate views, each a single
 *   rotation about the spine, shown or hidden by the angle (the front up to
 *   90°, the back after). No preserve-3d, no backface culling: only rotateY,
 *   perspective and transformOrigin. Still a real 3D turn, not a 2D squash.
 *
 * ONE CONTINUOUS POSITION drives it, in spreads: `pos` is `k` at rest on
 * spread k and `k + p` mid-turn. Every leaf derives its angle from
 * `pos − its own spread`, so when a turn commits, React re-rendering the
 * next spread and the animation finishing can land in either order without
 * a wrong frame: the old leaves already sit where the new ones will.
 *
 * Paint order is JSX order, no zIndex (CLAUDE.md): the pages underneath,
 * then the backward leaf's front, the forward leaf's front, the forward
 * leaf's back, the backward leaf's back — one order correct for both
 * directions, worked through in the comments below.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

type Mode = 'split' | 'nested';

const PAGES = 9; // odd on purpose: the last right-hand page is the blank one
const PAPER = '#fbf6ea';
const COVER = '#a94f3a';
const SHADE = '#3a2a18';
const EASE = Easing.inOut(Easing.cubic);

export default function FlipTest() {
  if (!__DEV__) return <Redirect href="/" />;
  return <FlipTestScreen />;
}

function FlipTestScreen() {
  const { width: screenW } = useWindowDimensions();
  const bookW = Math.min(screenW - 24, 380);
  const pageW = (bookW - 14) / 2; // the cover's 7px either side
  const pageH = Math.round((bookW / 2) * 1.6);

  const [mode, setMode] = useState<Mode>('split');
  const [k, setK] = useState(0); // the spread at rest: pages 2k and 2k+1
  const pos = useSharedValue(0);
  const busy = useSharedValue(false);
  const lastSpread = Math.floor((PAGES - 1) / 2);

  // A new spread has rendered: gestures may start again. (Before this, the
  // leaves on screen still belong to the previous spread.)
  useEffect(() => {
    busy.value = false;
  }, [k, busy]);

  const land = useCallback((to: number) => setK(to), []);

  const start = useSharedValue(0);
  const dir = useSharedValue(0);
  const t0 = useSharedValue(0);

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      start.value = pos.value;
      dir.value = 0;
      t0.value = Date.now();
    })
    .onUpdate((e) => {
      if (busy.value) return;
      // The direction locks on the first update that has actually MOVED.
      // The update that activates the pan can report translationX of exactly
      // 0 (measured in Chromium), and `0 < 0` is false — locking there read
      // every drag as a backward turn, which on the first spread means none.
      if (dir.value === 0) {
        if (Math.abs(e.translationX) < 1) return;
        dir.value = e.translationX < 0 ? 1 : -1;
      }
      const base = start.value;
      if (dir.value > 0 && base >= lastSpread) return; // no next spread
      if (dir.value < 0 && base <= 0) return; // no previous spread
      let p = (dir.value > 0 ? -e.translationX : e.translationX) / (bookW * 0.85);
      p = Math.min(1, Math.max(0, p));
      pos.value = base + dir.value * p;
    })
    .onEnd((e) => {
      if (busy.value || dir.value === 0) return;
      const base = start.value;
      const p = Math.abs(pos.value - base);
      const fast = Date.now() - t0.value < 300 && Math.abs(e.translationX) > 40;
      const commit = p > 0.4 || (fast && p > 0.06);
      if (commit) {
        const to = base + dir.value;
        busy.value = true;
        pos.value = withTiming(to, { duration: (1 - p) * 460 + 140, easing: EASE }, (done) => {
          if (done) runOnJS(land)(to);
        });
      } else {
        pos.value = withTiming(base, { duration: p * 360 + 120, easing: EASE });
      }
    });

  const turn = (d: 1 | -1) => {
    if (busy.value) return;
    const to = k + d;
    if (to < 0 || to > lastSpread) return;
    busy.value = true;
    pos.value = withTiming(to, { duration: 600, easing: EASE }, (done) => {
      if (done) runOnJS(land)(to);
    });
  };

  // Hold the forward leaf at a fraction, to inspect it standing still —
  // 0.49 and 0.51 straddle the 90° crossing where the faces swap.
  const hold = (p: number) => {
    if (busy.value || k >= lastSpread) return;
    pos.value = withTiming(k + p, { duration: 350, easing: EASE });
  };

  // The angle of whichever leaf is moving, for the readout — reported only
  // when the whole degree changes, not every frame.
  const [readout, setReadout] = useState('0°');
  useAnimatedReaction(
    () => {
      const f = pos.value - k;
      return Math.round(f >= 0 ? -180 * Math.min(1, f) : 180 * Math.min(1, -f));
    },
    (deg, prev) => {
      if (deg !== prev) runOnJS(setReadout)(`${deg}°`);
    },
    [k]
  );

  const page = (n: number) => (n >= 0 && n < PAGES ? n : null);
  const L = 2 * k;
  const common = { k, pos, pageW, pageH };

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: 'Page flip test' }} />
      <Text style={styles.h}>Page flip test (development only)</Text>
      <Text style={styles.p}>
        Swipe the book left and right, slowly. Watch for: text showing MIRRORED through a page, a page that
        vanishes or flickers as it passes upright, the page pivoting anywhere but the spine, or a flat squash
        instead of the near edge growing towards you. Try both structures.
      </Text>

      <View style={styles.modes}>
        {(['split', 'nested'] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={[styles.mode, mode === m && styles.modeOn]} testID={`flip-mode-${m}`}>
            <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>{m === 'split' ? 'Split faces' : 'Nested (prototype)'}</Text>
          </Pressable>
        ))}
      </View>

      <GestureDetector gesture={pan}>
        <View style={[styles.cover, { width: bookW }]} testID="flip-book">
          <View style={{ width: pageW * 2, height: pageH }}>
            {/* 1. Underneath: what each turn reveals. Left shows the page
                before this spread (a backward turn lifts page L off it);
                right shows the page after the next one (a forward turn lifts
                L+1 off it). Both are covered at rest. */}
            <PageFace n={page(L - 2)} side="left" style={[styles.slot, { left: 0, width: pageW, height: pageH }]} />
            <PageFace n={page(L + 3)} side="right" style={[styles.slot, { left: pageW, width: pageW, height: pageH }]} />
            {mode === 'split' ? (
              <>
                {/* 2. Backward leaf's front: page L, flat on the left at rest. */}
                <SplitFace {...common} n={page(L)} role="bwd-front" />
                {/* 3. Forward leaf's front: page L+1, flat on the right at rest. */}
                <SplitFace {...common} n={page(L + 1)} role="fwd-front" />
                {/* 4. Forward leaf's back: page L+2, falls onto the left page
                    in the second half of a forward turn — so it must paint
                    above (2). */}
                <SplitFace {...common} n={page(L + 2)} role="fwd-back" />
                {/* 5. Backward leaf's back: page L−1, falls onto the right in
                    the second half of a backward turn — so it must paint
                    above (3). Last. */}
                <SplitFace {...common} n={page(L - 1)} role="bwd-back" />
              </>
            ) : (
              <>
                <NestedLeaf {...common} front={page(L)} back={page(L - 1)} dirSign={-1} />
                <NestedLeaf {...common} front={page(L + 1)} back={page(L + 2)} dirSign={1} />
              </>
            )}
            <View pointerEvents="none" style={[styles.spine, { left: pageW - 8, height: pageH }]} />
          </View>
        </View>
      </GestureDetector>

      <View style={styles.row}>
        <Pressable onPress={() => turn(-1)} style={styles.btn} testID="flip-prev"><Text style={styles.btnText}>‹</Text></Pressable>
        <Text style={styles.readout} testID="flip-readout">
          {mode} · spread {k + 1}/{lastSpread + 1} · {readout}
        </Text>
        <Pressable onPress={() => turn(1)} style={styles.btn} testID="flip-next"><Text style={styles.btnText}>›</Text></Pressable>
      </View>
      <Text style={styles.p}>Hold the next page part-turned, to look at it standing still:</Text>
      <View style={styles.row}>
        {[0, 0.25, 0.49, 0.51, 0.75].map((p) => (
          <Pressable key={p} onPress={() => hold(p)} style={styles.chip} testID={`flip-hold-${p}`}>
            <Text style={styles.chipText}>{p === 0 ? 'flat' : `${Math.round(p * 180)}°`}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.meta}>
        {Platform.OS} {String(Platform.Version)} · book {Math.round(bookW)}px · page {Math.round(pageW)}×{pageH}
      </Text>
    </View>
  );
}

/** How far through a turn the leaves of spread `k` are: forward 0→1 as
 *  pos goes k→k+1, backward 0→1 as it goes k→k−1. */
function progress(pos: number, k: number, role: 'fwd' | 'bwd'): number {
  'worklet';
  const f = role === 'fwd' ? pos - k : k - pos;
  return Math.min(1, Math.max(0, f));
}

function SplitFace({
  n,
  role,
  k,
  pos,
  pageW,
  pageH,
}: {
  n: number | null;
  role: 'fwd-front' | 'fwd-back' | 'bwd-front' | 'bwd-back';
  k: number;
  pos: SharedValue<number>;
  pageW: number;
  pageH: number;
}) {
  const fwd = role.startsWith('fwd');
  const front = role.endsWith('front');
  // Which half of the spread this face lies on when flat, and so which edge
  // is the spine it hinges on. A forward leaf's front is a right-hand page,
  // its back a left-hand one; a backward leaf is the mirror image.
  const onRight = fwd === front;
  const style = useAnimatedStyle(() => {
    const p = progress(pos.value, k, fwd ? 'fwd' : 'bwd');
    // Front: flat (0°) → upright (±90°). Back: upright → flat on the other
    // side. Each is one rotation about the spine, never nested.
    const sign = onRight ? -1 : 1;
    const deg = front ? sign * 180 * p : sign * 180 * (1 - p);
    const shown = front ? p < 0.5 : p >= 0.5;
    return {
      opacity: shown ? 1 : 0,
      transform: [{ perspective: 1600 }, { rotateY: `${deg}deg` }],
    };
  });
  const shade = useAnimatedStyle(() => {
    const p = progress(pos.value, k, fwd ? 'fwd' : 'bwd');
    const s = Math.sin(Math.PI * p) * 0.3;
    return { opacity: front ? (p < 0.5 ? s : 0) : p >= 0.5 ? s : 0 };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.slot,
        { left: onRight ? pageW : 0, width: pageW, height: pageH, transformOrigin: onRight ? '0% 50%' : '100% 50%' },
        style,
      ]}
      testID={`flip-${role}`}
    >
      <PageFace n={n} side={onRight ? 'right' : 'left'} style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SHADE }, shade]} />
    </Animated.View>
  );
}

function NestedLeaf({
  front,
  back,
  dirSign,
  k,
  pos,
  pageW,
  pageH,
}: {
  front: number | null;
  back: number | null;
  dirSign: 1 | -1;
  k: number;
  pos: SharedValue<number>;
  pageW: number;
  pageH: number;
}) {
  const fwd = dirSign > 0;
  const leaf = useAnimatedStyle(() => {
    const p = progress(pos.value, k, fwd ? 'fwd' : 'bwd');
    return { transform: [{ perspective: 1600 }, { rotateY: `${(fwd ? -180 : 180) * p}deg` }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.slot,
        { left: fwd ? pageW : 0, width: pageW, height: pageH, transformOrigin: fwd ? '0% 50%' : '100% 50%' },
        leaf,
      ]}
      testID={`flip-nested-${fwd ? 'fwd' : 'bwd'}`}
    >
      <View style={[StyleSheet.absoluteFill, { backfaceVisibility: 'hidden' }]}>
        <PageFace n={front} side={fwd ? 'right' : 'left'} style={StyleSheet.absoluteFill} />
      </View>
      <View style={[StyleSheet.absoluteFill, { backfaceVisibility: 'hidden', transform: [{ rotateY: '180deg' }] }]}>
        <PageFace n={back} side={fwd ? 'left' : 'right'} style={StyleSheet.absoluteFill} />
      </View>
    </Animated.View>
  );
}

/** A page built to make a mirror obvious: the number, text that reads left
 *  to right, an arrow, and a block in one corner only. */
function PageFace({ n, side, style }: { n: number | null; side: 'left' | 'right'; style: object }) {
  const edge = side === 'left' ? { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 } : { borderTopRightRadius: 4, borderBottomRightRadius: 4 };
  if (n === null) {
    return (
      <View style={[style, styles.page, edge]}>
        <View style={styles.blank}>
          <Text style={styles.blankPlus}>+</Text>
          <Text style={styles.blankText}>Room for one more</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[style, styles.page, edge]}>
      <View style={styles.corner} />
      <Text style={styles.num}>{n + 1}</Text>
      <Text style={styles.word}>READ ME →</Text>
      <Text style={styles.small}>Page {n + 1}. If this reads backwards, the flip is mirroring.</Text>
      <View style={[styles.spineShadow, side === 'left' ? { right: 0 } : { left: 0 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 12, gap: 12, alignItems: 'center', paddingBottom: 60 },
  h: { fontSize: 18, fontWeight: '700', alignSelf: 'flex-start' },
  p: { fontSize: 13, lineHeight: 18, color: '#5c4d3c', alignSelf: 'flex-start' },
  meta: { fontSize: 11, color: '#8a7a66', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  modes: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  mode: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#c4ae88', alignItems: 'center', justifyContent: 'center' },
  modeOn: { backgroundColor: '#2a2118', borderColor: '#2a2118' },
  modeText: { fontSize: 14, color: '#2a2118' },
  modeTextOn: { color: '#fff', fontWeight: '600' },
  cover: { backgroundColor: COVER, borderRadius: 10, paddingTop: 7, paddingHorizontal: 7, paddingBottom: 9, alignItems: 'center' },
  slot: { position: 'absolute', top: 0 },
  page: { backgroundColor: PAPER, padding: 10, overflow: 'hidden' },
  corner: { position: 'absolute', top: 0, left: 0, width: 22, height: 22, backgroundColor: '#e3b75a' },
  num: { fontSize: 44, fontWeight: '700', color: '#2a2118', marginTop: 14 },
  word: { fontSize: 15, fontWeight: '700', color: '#a94f3a', marginTop: 6 },
  small: { fontSize: 11, lineHeight: 15, color: '#5c4d3c', marginTop: 8 },
  spineShadow: { position: 'absolute', top: 0, bottom: 0, width: 14, backgroundColor: 'rgba(60,40,20,0.08)' },
  spine: { position: 'absolute', top: 0, width: 16, backgroundColor: 'rgba(60,40,20,0.10)' },
  blank: { flex: 1, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#d6c8ad', borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 6 },
  blankPlus: { fontSize: 26, color: '#a8977f' },
  blankText: { fontSize: 12, color: '#a8977f' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  btn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: '#dccfb4', backgroundColor: '#fffdf7', alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 22, color: '#5c4d3c' },
  readout: { minWidth: 170, textAlign: 'center', fontSize: 12, color: '#5c4d3c' },
  chip: { minHeight: 44, minWidth: 56, paddingHorizontal: 10, borderRadius: 22, borderWidth: 1, borderColor: '#dccfb4', alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, color: '#2a2118' },
});
