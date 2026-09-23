/**
 * components/recipeBox/FinishPrompt.tsx — the two questions a recipe can
 * ask when you are done with it, in ONE window:
 *
 *   'rate'   — "How was {title}?", when a cook is stamped (the finish that
 *              stampCooked counts, so never twice inside six hours). Three
 *              answers and "Skip for now"; the current rating pre-selected.
 *   'remove' — "Take it out of your box?", after a 👎 — chosen here, or in
 *              the recipe's own rating control.
 *
 * One window moving between two stages rather than two windows in a row:
 * iOS will not present a Modal while another is still dismissing, and a
 * 👎 is exactly the moment the first would be fading out.
 *
 * Nothing here writes. It reports the choice; the recipe route writes it,
 * navigates, and raises the toast. The words are lib/recipeBox.ts's.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Window } from '@/components/Window';
import { RATING_CHOICES, ratingPromptCopy, removePromptCopy } from '@/lib/recipeBox';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export type FinishStage = 'rate' | 'remove';

interface Props {
  stage: FinishStage | null;
  title: string;
  bookName: string;
  rating: number | null | undefined;
  /** Close without fading: Remove navigates away. */
  instant?: boolean;
  onRate: (rating: -1 | 0 | 1) => void;
  onSkip: () => void;
  onRemove: () => void;
  onKeep: () => void;
}

export function FinishPrompt({ stage, title, bookName, rating, instant, onRate, onSkip, onRemove, onKeep }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  // The scrim and the back button mean "not now": skip a rating, keep a 👎.
  const dismiss = stage === 'remove' ? onKeep : onSkip;
  return (
    <Window open={stage !== null} onClose={dismiss} instant={instant} maxWidth={400} testID="finish-prompt">
      {stage === 'remove' ? (
        <RemoveStage title={title} bookName={bookName} onRemove={onRemove} onKeep={onKeep} styles={styles} />
      ) : (
        <RateStage title={title} rating={rating} onRate={onRate} onSkip={onSkip} styles={styles} />
      )}
    </Window>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function RateStage({ title, rating, onRate, onSkip, styles }: { title: string; rating: number | null | undefined; onRate: Props['onRate']; onSkip: () => void; styles: Styles }) {
  const copy = ratingPromptCopy(title, rating);
  return (
    <View testID="finish-rate">
      <Text style={styles.party} accessibilityElementsHidden importantForAccessibility="no">
        🎉
      </Text>
      <Text style={styles.heading} accessibilityRole="header">
        {copy.heading}
      </Text>
      <Text style={styles.sub}>{copy.sub}</Text>
      <View style={styles.choices}>
        {RATING_CHOICES.map((c) => {
          const on = rating === c.value;
          return (
            <Pressable
              key={c.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={c.label}
              onPress={() => onRate(c.value)}
              style={({ pressed }) => [styles.choice, on && styles.choiceOn, pressed && styles.choicePressed]}
              testID={`finish-rate-${c.value}`}
            >
              <Text style={styles.choiceEmoji}>{c.emoji}</Text>
              <Text style={[styles.choiceLabel, on && styles.choiceLabelOn]} numberOfLines={2}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable accessibilityRole="button" onPress={onSkip} style={styles.ghost} testID="finish-skip">
        <Text style={styles.ghostText}>Skip for now</Text>
      </Pressable>
    </View>
  );
}

function RemoveStage({ title, bookName, onRemove, onKeep, styles }: { title: string; bookName: string; onRemove: () => void; onKeep: () => void; styles: Styles }) {
  const copy = removePromptCopy(title, bookName);
  return (
    <View testID="finish-remove">
      <Text style={styles.heading} accessibilityRole="header">
        {copy.heading}
      </Text>
      <Text style={styles.body}>{copy.body}</Text>
      <Text style={styles.note}>{copy.note}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRemove}
        style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
        testID="finish-remove-it"
      >
        <Text style={styles.primaryText}>Remove it</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onKeep}
        style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
        testID="finish-keep-it"
      >
        <Text style={styles.secondaryText}>Keep it at the back</Text>
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    party: { fontSize: 34, textAlign: 'center' },
    heading: { marginTop: 6, fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, textAlign: 'center', color: colors.foreground },
    sub: { marginTop: 6, fontSize: 14, lineHeight: 20, textAlign: 'center', color: colors.mutedForeground },
    body: { marginTop: 10, fontSize: 15, lineHeight: 21, textAlign: 'center', color: colors.foreground },
    note: { marginTop: 10, fontSize: 13, lineHeight: 18, textAlign: 'center', color: colors.mutedForeground },
    choices: { flexDirection: 'row', gap: 8, marginTop: 18 },
    choice: {
      flex: 1,
      minHeight: 76,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 4,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    choiceOn: { borderColor: colors.foreground, borderWidth: 2, backgroundColor: colors.card },
    choicePressed: { borderColor: colors.borderStrong },
    choiceEmoji: { fontSize: 26 },
    choiceLabel: { fontSize: 13, textAlign: 'center', color: colors.mutedForeground },
    choiceLabelOn: { color: colors.foreground, fontWeight: '600' },
    ghost: { marginTop: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    ghostText: { fontSize: 15, color: colors.mutedForeground },
    primary: {
      marginTop: 18,
      minHeight: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    primaryPressed: { opacity: 0.85 },
    primaryText: { fontSize: 15, fontWeight: '600', color: colors.primaryForeground },
    secondary: {
      marginTop: 8,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    secondaryPressed: { borderColor: colors.borderStrong },
    secondaryText: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  });
}
