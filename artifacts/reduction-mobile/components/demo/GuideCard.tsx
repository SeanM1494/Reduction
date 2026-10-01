/**
 * components/demo/GuideCard.tsx — the guided demo's instruction card, pinned
 * under the recipe. Presentational: DemoScreen owns the guide (lib/
 * demoGuide.ts) and hands this what to say and what each button does.
 *
 * The instruction is the thing to read, so it is set like a Step-by-Step
 * card's heading (Oct 1): the heading face, bold, 22pt — the size that
 * fits an SE — following Dynamic Type to 1.5x, under a green "Demo" label
 * and "Step 2 of 6".
 *
 * Its size is held still on purpose. The instruction's box is as tall as
 * the LONGEST instruction would be at this width and text size (measured
 * from an unseen copy of each), and the nudge reserves its own line
 * whether or not it is showing, so a new step, a nudge or Show me arriving
 * never moves a button under a finger (CLAUDE.md, "Nothing may resize
 * under a fingertip").
 */

import React, { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { counter, GUIDE_STEPS, NUDGE } from '@/lib/demoGuide';

export type GuideCardProps =
  | { phase: 'idle'; onStart: () => void; onWatch: () => void }
  | {
      phase: 'watching';
      index: number;
      paused: boolean;
      /** VoiceOver on: the tour does each step and waits for Next. */
      screenReader: boolean;
      onBack: () => void;
      onNext: () => void;
      onPause: () => void;
      onResume: () => void;
      onTry: () => void;
    }
  | {
      phase: 'guided';
      index: number;
      nudge: boolean;
      showMe: boolean;
      signedIn: boolean;
      onBack: () => void;
      onSkip: () => void;
      onNext: () => void;
      onShowMe: () => void;
      onWatch: () => void;
      onFinish: () => void;
      onReplay: () => void;
    };

const IDLE_TEXT = 'New here? Learn to read a recipe in six short steps.';

export function announce(text: string) {
  // RN-web's AccessibilityInfo is a stub; a live region carries it there.
  if (Platform.OS !== 'web') AccessibilityInfo.announceForAccessibility(text);
}

export function GuideCard(props: GuideCardProps) {
  const colors = useColors();
  const styles = makeStyles(colors);

  const index = props.phase === 'guided' || props.phase === 'watching' ? props.index : -1;
  const nudge = props.phase === 'guided' && props.nudge;
  // VoiceOver hears each step as it arrives, and the nudge when it appears:
  // nothing else on the screen changes to tell them.
  useEffect(() => {
    if (index >= 0) announce(`Step ${index + 1} of ${GUIDE_STEPS.length}. ${GUIDE_STEPS[index].text}`);
  }, [index]);
  useEffect(() => {
    if (nudge) announce(NUDGE);
  }, [nudge]);

  if (props.phase === 'idle') {
    return (
      <View style={styles.card} testID="guide-card">
        <Text style={styles.idleText} maxFontSizeMultiplier={1.4} testID="guide-text">
          {IDLE_TEXT}
        </Text>
        <View style={styles.row}>
          <Primary label="Start the demo" onPress={props.onStart} testID="guide-start" styles={styles} />
          <Secondary label="Watch instead" onPress={props.onWatch} testID="guide-watch" styles={styles} />
        </View>
      </View>
    );
  }

  if (props.phase === 'watching') {
    // The step's own instruction stays up for the whole step; the pointer
    // does the tapping. Pause, Back and Next so nobody is rushed.
    const step = GUIDE_STEPS[props.index];
    return (
      <View style={styles.card} testID="guide-card">
        <Header index={props.index} styles={styles}>
          <Pressable accessibilityRole="button" onPress={props.onTry} style={styles.link} testID="guide-try">
            <Text style={styles.linkText} maxFontSizeMultiplier={1.3}>
              Try it yourself
            </Text>
          </Pressable>
        </Header>
        <Instruction text={step.text} styles={styles} />
        <View style={styles.nudgeSlot}>
          {props.screenReader ? (
            <Text style={styles.hint} maxFontSizeMultiplier={1.2}>
              Each step plays, then waits for Next.
            </Text>
          ) : null}
        </View>
        <View style={styles.row}>
          <Secondary label="Back" onPress={props.onBack} testID="guide-back" styles={styles} />
          <Primary
            label={props.paused ? 'Resume' : 'Pause'}
            onPress={props.paused ? props.onResume : props.onPause}
            testID="guide-pause"
            styles={styles}
          />
          <Secondary label="Next" onPress={props.onNext} testID="guide-next" styles={styles} />
        </View>
      </View>
    );
  }

  const step = GUIDE_STEPS[props.index];
  const finish = step.kind === 'finish';
  return (
    <View style={styles.card} testID="guide-card">
      <Header index={props.index} styles={styles}>
        {finish ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={props.onWatch}
            style={styles.link}
            testID="guide-watch"
          >
            <Text style={styles.linkText} maxFontSizeMultiplier={1.3}>
              Watch instead
            </Text>
          </Pressable>
        )}
      </Header>
      <Instruction text={step.text} styles={styles} />
      <View style={styles.nudgeSlot}>
        {props.nudge ? (
          <Text style={styles.nudge} maxFontSizeMultiplier={1.2} testID="guide-nudge">
            {NUDGE}
          </Text>
        ) : null}
      </View>
      <View style={styles.row}>
        <Secondary label="Back" onPress={props.onBack} testID="guide-back" styles={styles} />
        {finish ? (
          <>
            <Secondary label="Replay" onPress={props.onReplay} testID="guide-replay" styles={styles} />
            <Primary
              label={props.signedIn ? 'Find a recipe' : 'Sign in'}
              onPress={props.onFinish}
              testID="guide-finish"
              styles={styles}
            />
          </>
        ) : (
          <>
            <Secondary label="Skip" onPress={props.onSkip} testID="guide-skip" styles={styles} />
            {step.kind === 'read' ? (
              <Primary label="Next" onPress={props.onNext} testID="guide-next" styles={styles} />
            ) : props.showMe ? (
              <Primary label="Show me" onPress={props.onShowMe} testID="guide-show-me" styles={styles} />
            ) : (
              <View style={styles.primarySpacer} />
            )}
          </>
        )}
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/** The green "Demo" label and "Step 2 of 6", with a link on the right. */
function Header({ index, styles, children }: { index: number; styles: Styles; children?: ReactNode }) {
  return (
    <View style={styles.top}>
      <View style={styles.badges}>
        <View style={styles.demo}>
          <Text style={styles.demoText} maxFontSizeMultiplier={1.5}>
            Demo
          </Text>
        </View>
        <Text style={styles.counter} maxFontSizeMultiplier={1.5} testID="guide-counter">
          Step {counter(index)}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** The instruction, in a box as tall as the longest one at this width and
 *  text size, so the card never changes height from one step to the next. */
function Instruction({ text, styles }: { text: string; styles: Styles }) {
  const [tallest, setTallest] = useState(0);
  return (
    <View style={{ minHeight: tallest }}>
      <View style={styles.measure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {GUIDE_STEPS.map((s) => (
          <Text
            key={s.id}
            style={[styles.text, styles.measureText]}
            maxFontSizeMultiplier={1.5}
            onLayout={(e) => {
              const h = Math.ceil(e.nativeEvent.layout.height);
              setTallest((t) => (h > t ? h : t));
            }}
          >
            {s.text}
          </Text>
        ))}
      </View>
      <Text style={styles.text} maxFontSizeMultiplier={1.5} accessibilityLiveRegion="polite" accessibilityRole="header" testID="guide-text">
        {text}
      </Text>
    </View>
  );
}

function Primary({ label, onPress, testID, styles }: { label: string; onPress: () => void; testID: string; styles: Styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.primaryText} maxFontSizeMultiplier={1.3} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Secondary({ label, onPress, testID, styles }: { label: string; onPress: () => void; testID: string; styles: Styles }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.secondaryText} maxFontSizeMultiplier={1.3} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    card: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 12,
    },
    top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginTop: -6 },
    badges: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
    // Green: the cool "done" tint, the app's word for "all good here".
    demo: { borderRadius: 99, borderWidth: 1, borderColor: colors.coolLine, backgroundColor: colors.coolBg, paddingVertical: 2, paddingHorizontal: 9 },
    demoText: { fontFamily: fonts.headingBold, fontSize: 13, lineHeight: 17, letterSpacing: 0.3, color: colors.coolInk },
    counter: { fontFamily: fonts.headingMedium, fontSize: 14, color: colors.mutedForeground, flexShrink: 1 },
    link: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
    linkText: { fontFamily: fonts.headingMedium, fontSize: 15, color: colors.foreground, textDecorationLine: 'underline' },
    // Like a Step-by-Step card's heading (StepsMode's `label`, 26pt), at
    // the size that fits an SE in three lines.
    text: { fontFamily: fonts.headingBold, fontSize: 22, lineHeight: 27, letterSpacing: -0.3, color: colors.foreground },
    measure: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
    measureText: { position: 'absolute', top: 0, left: 0, right: 0 },
    // The line before the guide starts, at its old size.
    idleText: { fontFamily: fonts.headingMedium, fontSize: 17, lineHeight: 23, minHeight: 46, color: colors.foreground },
    nudgeSlot: { minHeight: 22, justifyContent: 'center' },
    nudge: { fontSize: 14, lineHeight: 19, color: colors.warmInk },
    hint: { fontSize: 14, lineHeight: 19, color: colors.mutedForeground },
    row: { flexDirection: 'row', gap: 8, marginTop: 4 },
    primary: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
      borderRadius: colors.radiusButton,
      backgroundColor: colors.primary,
    },
    primarySpacer: { flex: 1, minHeight: 44 },
    primaryText: { fontFamily: fonts.heading, fontSize: 16, color: colors.primaryForeground },
    secondary: {
      minHeight: 44,
      minWidth: 64,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
      borderRadius: colors.radiusButton,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    secondaryText: { fontFamily: fonts.headingMedium, fontSize: 16, color: colors.foreground },
    pressed: { opacity: 0.7 },
  });
}
