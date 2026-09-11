/**
 * components/recipe/ServingsRow.tsx — how many you are making tonight, and
 * what the recipe says it makes. Ported from the web component of the same
 * name; its header carries the reasoning, and the rule that matters most:
 *
 * TWO NUMBERS THAT MUST NEVER SHARE A CONTROL. `recipe.servings` is what the
 * recipe makes (a correction, edited in the recipe sheet). `entry.servings`
 * is what you are cooking tonight, and `scale` is the second divided by the
 * first. THIS stepper writes `entry.servings` and nothing else. See CLAUDE.md.
 *
 * One slot under the stepper: the recipe's own yield words while they are
 * true (scale 1), the multiplier once they are not — never both.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatQty } from '@/shared/amounts';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

const MIN = 1;
const MAX = 999;

/** Eighths, rounded, floored at 1: a serves-4 dinner steps by 1, a 24-cookie
 *  batch by 3 — see the web component for why 1 is the wrong step. */
const stepFor = (base: number): number => (base <= 8 ? 1 : Math.max(1, Math.round(base / 8)));

export function ServingsRow({
  base,
  entryServings,
  yieldText,
  onChange,
}: {
  /** What the recipe makes. Null when the extraction did not find one. */
  base: number | null;
  /** What you are cooking tonight, or null to mean "same as the recipe". */
  entryServings: number | null;
  yieldText?: string | null;
  onChange: (servings: number | null) => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const yieldLine = yieldText?.trim() || null;

  // No base means no ratio, so a stepper would be a control that does
  // nothing. The recipe's own words are still worth showing if it has any.
  if (typeof base !== 'number' || base <= 0) {
    return yieldLine ? (
      <View style={styles.plainWrap}>
        <Text style={styles.note}>{yieldLine}</Text>
      </View>
    ) : null;
  }

  const current = entryServings ?? base;
  const scale = current / base;
  const step = stepFor(base);
  const set = (n: number) => {
    const next = Math.min(MAX, Math.max(MIN, n));
    // Back to the recipe's own number stores null, so "unchanged" stays
    // distinguishable from "deliberately set to the same".
    onChange(next === base ? null : next);
  };

  return (
    <View style={styles.wrap} testID="servings-row">
      <View style={styles.set}>
        <Text style={styles.label}>MAKING</Text>
        <View style={styles.stepper}>
          <StepButton glyph="−" label={`${step} fewer`} disabled={current <= MIN} onPress={() => set(current - step)} colors={colors} />
          <Text style={styles.value} accessibilityLiveRegion="polite" testID="servings-value">
            {formatQty(current)}
          </Text>
          <StepButton glyph="+" label={`${step} more`} disabled={current >= MAX} onPress={() => set(current + step)} colors={colors} />
        </View>
      </View>
      {scale === 1 ? (
        <Text style={styles.note}>{yieldLine ?? `Recipe makes ${formatQty(base)}`}</Text>
      ) : (
        <Text style={styles.note}>
          <Text style={styles.scale}>×{formatQty(scale)}</Text>
          {' from a recipe for '}
          {formatQty(base)}
          {'   '}
          <Text style={styles.reset} onPress={() => onChange(null)} accessibilityRole="button">
            Reset
          </Text>
        </Text>
      )}
    </View>
  );
}

function StepButton({
  glyph,
  label,
  disabled,
  onPress,
  colors,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
  colors: Colors;
}) {
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.stepBtn, pressed && !disabled && styles.stepBtnPressed, disabled && styles.stepBtnDisabled]}
    >
      <Text style={styles.stepGlyph}>{glyph}</Text>
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { gap: 6, paddingBottom: 12, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    plainWrap: { paddingBottom: 12, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
    set: { flexDirection: 'row', alignItems: 'center', gap: 11, flexWrap: 'wrap' },
    label: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.95, color: colors.mutedForeground },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    stepBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.muted },
    stepBtnPressed: { backgroundColor: colors.border },
    stepBtnDisabled: { opacity: 0.35 },
    stepGlyph: { fontSize: 18, lineHeight: 20, color: colors.foreground },
    value: { fontFamily: fonts.mono, fontSize: 15, minWidth: 44, textAlign: 'center', color: colors.foreground },
    note: { fontSize: 12.5, lineHeight: 18, color: colors.mutedForeground },
    scale: { fontWeight: '600', color: colors.foreground },
    reset: { color: colors.coolInk, textDecorationLine: 'underline' },
  });
}
