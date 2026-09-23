/**
 * components/recipeBox/PreviewSheet.tsx — what tapping a page in the Recipe
 * Box opens: a look at the recipe before committing to it, and the two ways
 * in — the diagram, or straight into cooking.
 *
 * The photo (or the meal-type art) with the rating badge, the title and its
 * book, the stat tiles, the key ingredients, when it was last cooked. NO
 * rating controls: the rating is asked when a cook finishes (step 6), and
 * changed from the recipe itself — a preview is for deciding what to cook,
 * not for grading it (ROADMAP "The Recipe Box: books", spec §6).
 *
 * The words and tiles are lib/recipeBox.ts's (`previewStats`,
 * `previewCookedLine`, `keyIngredients`), under test.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { MealTypeArt } from '@/components/library/MealTypeArt';
import { useRecipePhoto } from '@/lib/recipePhoto';
import { sanitizeMealTypes } from '@/shared/mealTypes';
import {
  PREVIEW_INGREDIENTS,
  RATING_EMOJI,
  bookById,
  bookOf,
  keyIngredients,
  previewCookedLine,
  previewStats,
} from '@/lib/recipeBox';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

export type PreviewAction = 'overview' | 'cook';

interface Props {
  /** The recipe to preview; null closes it. */
  entry: Entry | null;
  onClose: () => void;
  onOpen: (entry: Entry, view: PreviewAction) => void;
}

const IN_MS = 220;
const OUT_MS = 160;

/**
 * A WINDOW, not a bottom sheet (decided on the phone, Sep 24): the first cut
 * used the app's Sheet, whose Modal slides the whole layer up from the
 * bottom edge — the dark scrim included, so the shading itself rose up the
 * screen behind the card. Here the Modal does no animation of its own; the
 * scrim FADES where it is and the card fades in from 94% scale, both from
 * one progress value, and the reverse on close. Reduce Motion drops the
 * scale and keeps a short fade.
 *
 * "View diagram" and "Start cooking" close it INSTANTLY: the recipe screen
 * is being pushed underneath, and a card still fading out over it is the
 * same kind of seam this replaced.
 */
export function PreviewSheet({ entry, onClose, onOpen }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const open = entry !== null;
  const [mounted, setMounted] = useState(open);
  // What the card shows while it fades out, after the parent has let go.
  const last = useRef<Entry | null>(entry);
  if (entry) last.current = entry;
  const instant = useRef(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = 0;
      progress.value = withTiming(1, { duration: reduceMotion ? 150 : IN_MS, easing: Easing.out(Easing.cubic) });
    } else if (instant.current) {
      instant.current = false;
      progress.value = 0;
      setMounted(false);
    } else {
      progress.value = withTiming(0, { duration: OUT_MS, easing: Easing.in(Easing.cubic) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: reduceMotion ? 1 : 0.94 + 0.06 * progress.value }],
  }));

  const shown = entry ?? last.current;
  if (!mounted || !shown) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" testID="preview-scrim" />
      </Animated.View>
      <View
        pointerEvents="box-none"
        style={[styles.center, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}
      >
        <Animated.View
          style={[styles.card, { width: Math.min(width - 32, 440), maxHeight: height - insets.top - insets.bottom - 32 }, cardStyle]}
          accessibilityViewIsModal
        >
          <ScrollView bounces={false} contentContainerStyle={styles.cardContent}>
            <PreviewBody
              entry={shown}
              onClose={onClose}
              onOpen={(e, v) => {
                instant.current = true;
                onOpen(e, v);
              }}
            />
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function PreviewBody({ entry, onClose, onOpen }: { entry: Entry; onClose: () => void; onOpen: Props['onOpen'] }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const recipe = entry.recipe;
  const book = bookById(bookOf(entry));
  const photo = useRecipePhoto(entry);
  const primary = sanitizeMealTypes(recipe.mealTypes)[0] ?? null;
  const stats = previewStats(recipe);
  const { names, more } = keyIngredients(recipe, PREVIEW_INGREDIENTS);
  const rating = entry.rating === 1 || entry.rating === 0 || entry.rating === -1 ? entry.rating : null;

  return (
    <View testID="preview-sheet">
      <View style={styles.photo}>
        {photo ? (
          <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <MealTypeArt type={primary} size={56} />
        )}
        {rating !== null ? (
          <View style={styles.badge} testID="preview-rating">
            <Text style={styles.badgeText}>{RATING_EMOJI[String(rating)]}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={4}
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
          testID="preview-close"
        >
          <Feather name="x" size={20} color="#2a2118" />
        </Pressable>
      </View>

      <Text style={styles.title} accessibilityRole="header" testID="preview-title">
        {recipe.title}
      </Text>
      <View style={styles.chipRow}>
        <View style={[styles.bookChip, { backgroundColor: book.color }]} testID="preview-book">
          <Text style={styles.bookChipText}>{book.name}</Text>
        </View>
      </View>

      <View style={styles.tiles} testID="preview-stats">
        {stats.map((s) => (
          <View key={s.label} style={styles.tile}>
            <Text style={styles.tileValue} numberOfLines={1}>
              {s.value}
            </Text>
            <Text style={styles.tileLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {names.length ? (
        <>
          <Text style={styles.sectionLabel}>You'll need</Text>
          <View style={styles.chips} testID="preview-ingredients">
            {names.map((n) => (
              <View key={n} style={styles.chip}>
                <Text style={styles.chipText}>{n}</Text>
              </View>
            ))}
            {more > 0 ? (
              <View style={[styles.chip, styles.chipMore]}>
                <Text style={[styles.chipText, styles.chipMoreText]}>+{more} more</Text>
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      <Text style={styles.cooked} testID="preview-cooked">
        {previewCookedLine(entry.cooked, rating)}
      </Text>

      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpen(entry, 'overview')}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          testID="preview-diagram"
        >
          <Text style={styles.btnText}>View diagram</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpen(entry, 'cook')}
          style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.btnPrimaryPressed]}
          testID="preview-cook"
        >
          <Text style={[styles.btnText, styles.btnPrimaryText]}>Start cooking</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    scrim: { backgroundColor: 'rgba(33, 29, 24, 0.42)' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    card: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      shadowColor: '#3a2418',
      shadowOpacity: 0.22,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    cardContent: { padding: 14 },
    // No centring here: MealTypeArt fills its box with flex, and centring
    // shrank it to a stripe the width of its glyph.
    photo: { height: 150, borderRadius: 12, overflow: 'hidden' },
    badge: {
      position: 'absolute',
      top: 10,
      left: 10,
      backgroundColor: 'rgba(255,253,247,0.94)',
      borderRadius: 99,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    badgeText: { fontSize: 16 },
    // On the photo, so it keeps the paper colours whatever the theme: a
    // dark disc on a dark photo would vanish.
    close: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,253,247,0.9)',
    },
    closePressed: { backgroundColor: 'rgba(255,253,247,1)' },
    title: { marginTop: 14, fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, color: colors.foreground },
    chipRow: { flexDirection: 'row', marginTop: 8 },
    bookChip: { borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 },
    bookChipText: { color: '#fff', fontSize: 11, letterSpacing: 0.7, fontWeight: '600', textTransform: 'uppercase' },
    tiles: { flexDirection: 'row', gap: 8, marginTop: 14 },
    tile: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      paddingVertical: 8,
      paddingHorizontal: 10,
    },
    tileValue: { fontSize: 15, fontWeight: '600', color: colors.foreground },
    tileLabel: { fontSize: 11, color: colors.mutedForeground, marginTop: 1 },
    sectionLabel: {
      marginTop: 16,
      marginBottom: 8,
      fontSize: 11,
      letterSpacing: 0.9,
      textTransform: 'uppercase',
      color: colors.mutedForeground,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      borderRadius: 99,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    chipText: { fontSize: 13, color: colors.foreground },
    chipMore: { borderStyle: 'dashed' },
    chipMoreText: { color: colors.mutedForeground },
    cooked: { marginTop: 14, fontSize: 13, color: colors.mutedForeground },
    buttons: { flexDirection: 'row', gap: 8, marginTop: 16 },
    btn: {
      flex: 1,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    btnPressed: { borderColor: colors.borderStrong },
    btnText: { fontSize: 15, fontWeight: '600', color: colors.foreground },
    btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
    btnPrimaryPressed: { opacity: 0.85 },
    btnPrimaryText: { color: colors.primaryForeground },
  });
}
