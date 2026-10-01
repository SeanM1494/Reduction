/**
 * components/demo/GuideCard.tsx — the guided demo's instruction card, pinned
 * under the recipe. Presentational: DemoScreen owns the guide (lib/
 * demoGuide.ts) and hands this what to say and what each button does.
 *
 * Its size is held still on purpose. The instruction reserves two lines and
 * the nudge reserves its own line whether or not it is showing, so a nudge
 * appearing, or Show me arriving, never moves a button under a finger
 * (CLAUDE.md, "Nothing may resize under a fingertip"). The instruction is
 * 17pt and follows Dynamic Type to 1.4x, where it can still fit an SE.
 */

import React, { useEffect } from 'react';
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
        <Text style={styles.text} maxFontSizeMultiplier={1.4} testID="guide-text">
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
        <View style={styles.top}>
          <Text style={styles.counter} maxFontSizeMultiplier={1.4} testID="guide-counter">
            Watching · {counter(props.index)}
          </Text>
          <Pressable accessibilityRole="button" onPress={props.onTry} style={styles.link} testID="guide-try">
            <Text style={styles.linkText} maxFontSizeMultiplier={1.4}>
              Try it yourself
            </Text>
          </Pressable>
        </View>
        <Text
          style={styles.text}
          maxFontSizeMultiplier={1.4}
          accessibilityLiveRegion="polite"
          accessibilityRole="header"
          testID="guide-text"
        >
          {step.text}
        </Text>
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
      <View style={styles.top}>
        <Text style={styles.counter} maxFontSizeMultiplier={1.4} testID="guide-counter">
          {counter(props.index)}
        </Text>
        {finish ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={props.onWatch}
            style={styles.link}
            testID="guide-watch"
          >
            <Text style={styles.linkText} maxFontSizeMultiplier={1.4}>
              Watch instead
            </Text>
          </Pressable>
        )}
      </View>
      <Text
        style={styles.text}
        maxFontSizeMultiplier={1.4}
        accessibilityLiveRegion="polite"
        accessibilityRole="header"
        testID="guide-text"
      >
        {step.text}
      </Text>
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
    counter: { fontFamily: fonts.mono, fontSize: 13, letterSpacing: 0.4, color: colors.mutedForeground },
    link: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
    linkText: { fontFamily: fonts.headingMedium, fontSize: 15, color: colors.foreground, textDecorationLine: 'underline' },
    text: { fontFamily: fonts.headingMedium, fontSize: 17, lineHeight: 23, minHeight: 46, color: colors.foreground },
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
