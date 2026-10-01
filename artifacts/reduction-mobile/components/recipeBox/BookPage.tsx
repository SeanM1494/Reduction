/**
 * components/recipeBox/BookPage.tsx — one page of a book in the Recipe Box:
 * the recipe's photo (or its meal-type art), a rating badge only when rated,
 * the title, the stated time (or no line at all), serves and steps, the
 * first few ingredients, and when it was last cooked. Or, as the last right-
 * hand page of an odd book, the blank "Room for one more".
 *
 * Presentational only. It never handles a touch: the book owns the gestures
 * (a page is often a face of the turning leaf, and a Pressable inside a pan
 * is how the card stack came to ignore swipes — CLAUDE.md). What a page SAYS
 * is decided in lib/recipeBox.ts, under test.
 *
 * Cream paper in both themes: a book is a physical object. In dark mode the
 * paper is a step darker (`paper`, Cocoa, Oct 1) so it does not glare off
 * the page; its inks are the same except the greys (`paperMuted`,
 * `paperFaint`), darkened there to keep 4.5:1. The paper darkens a little
 * toward the spine on each side (`paperSpine`).
 */

import React, { memo } from 'react';
import { Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { sanitizeMealTypes } from '@/shared/mealTypes';
import { useRecipePhoto } from '@/lib/recipePhoto';
import { cookedLabel, keyIngredients, notCookedLabel, pageFit, RATING_EMOJI, stepCount, timeLine, type Book } from '@/lib/recipeBox';
import type { Entry } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { PageFace, faceStyles } from './PageFace';

export type PageContent = { kind: 'recipe'; entry: Entry; number: number } | { kind: 'blank' } | { kind: 'empty' };

interface Props {
  content: PageContent;
  side: 'left' | 'right';
  book: Book;
  width: number;
  height: number;
}

export const BookPage = memo(function BookPage({ content, side, book, width, height }: Props) {
  const outer = side === 'left'
    ? { borderTopLeftRadius: 4, borderBottomLeftRadius: 4 }
    : { borderTopRightRadius: 4, borderBottomRightRadius: 4 };
  const colors = useColors();
  return (
    <View style={[styles.page, outer, { width, height, backgroundColor: colors.paper }]}>
      {/* The paper, darkening toward the spine: right on a left page, left on
          a right page. */}
      {/* Half the prototype's warmth (#ece2cc), over the inner 12% rather
          than 22%: the fold should read as a fold, not a shadow. */}
      <LinearGradient
        colors={[colors.paper, colors.paper, colors.paperSpine]}
        locations={[0, 0.88, 1]}
        start={{ x: side === 'left' ? 0 : 1, y: 0 }}
        end={{ x: side === 'left' ? 1 : 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {content.kind === 'recipe' ? (
        <RecipeFace entry={content.entry} number={content.number} side={side} book={book} width={width} height={height} />
      ) : content.kind === 'blank' ? (
        <View style={styles.blank} testID="book-blank-page">
          <Text style={[styles.blankPlus, { color: colors.paperFaint }]}>+</Text>
          <Text style={[styles.blankText, { color: colors.paperFaint }]}>Room for one more</Text>
        </View>
      ) : null}
    </View>
  );
});

function RecipeFace({ entry, number, side, book, width, height }: { entry: Entry; number: number; side: 'left' | 'right'; book: Book; width: number; height: number }) {
  const recipe = entry.recipe;
  const colors = useColors();
  const photo = useRecipePhoto(entry);
  const time = timeLine(recipe);
  // What fits is decided by the page's size AND the person's text size
  // (lib/recipeBox.ts pageFit, under test): rows give way in a fixed order
  // rather than overlapping, and Dynamic Type is capped only past that.
  const { fontScale } = useWindowDimensions();
  const cooked = cookedLabel(entry.cooked);
  const pill = cooked
    ? { long: cooked, short: cookedLabel(entry.cooked, true) ?? cooked }
    : { long: notCookedLabel(false), short: notCookedLabel(true) };
  const fit = pageFit(width, height, { title: recipe.title, time, pill }, fontScale);
  const cap = fit.maxFontScale ?? undefined;
  const rating = entry.rating;
  return (
    <PageFace
      testID={`book-page-${entry.id}`}
      photo={photo}
      mealType={sanitizeMealTypes(recipe.mealTypes)[0] ?? null}
      photoHeight={fit.photoHeight}
      badge={
        rating === 1 || rating === 0 || rating === -1 ? (
          <View style={styles.badge} testID="book-page-rating">
            <Text style={styles.badgeText} maxFontSizeMultiplier={BADGE_MAX_SCALE}>{RATING_EMOJI[String(rating)]}</Text>
          </View>
        ) : null
      }
      title={recipe.title}
      time={time}
      servings={recipe.servings || null}
      steps={stepCount(recipe)}
      showServes={fit.showServes}
      ingredients={keyIngredients(recipe)}
      ingredientLines={fit.ingredientLines}
      paddingBottom={fit.paddingBottom}
      maxFontSizeMultiplier={cap}
      timeMaxFontSizeMultiplier={fit.timeMaxFontScale ?? undefined}
      titleMaxFontSizeMultiplier={fit.titleMaxFontScale ?? undefined}
      footer={
        <View
          style={[faceStyles.pill, cooked ? { backgroundColor: `${book.color}1f` } : { backgroundColor: colors.paperPill }]}
          testID="book-page-cooked"
        >
          <Text
            style={[faceStyles.pillText, { color: cooked ? book.color : colors.paperMuted }]}
            numberOfLines={1}
            // Sized to fit by pageFit; shrinking a hair is the native safety
            // net if the system font is wider than the model.
            adjustsFontSizeToFit
            minimumFontScale={0.85}
            maxFontSizeMultiplier={fit.pillMaxFontScale ?? cap}
          >
            {fit.pill}
          </Text>
        </View>
      }
      corner={
        <Text style={[styles.number, { color: colors.paperFaint }, side === 'left' ? { left: 11 } : { right: 11 }]} maxFontSizeMultiplier={cap}>
          {number}
        </Text>
      }
    />
  );
}

/** The rating emoji sits on the picture, which can shrink to
 *  PAGE_METRICS.minPhoto (36): 6 + 6 + 16 × 1.35 ≈ 34, inside it. */
const BADGE_MAX_SCALE = 1.35;

const styles = StyleSheet.create({
  page: { overflow: 'hidden' },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(255,253,247,0.94)',
    borderRadius: 99,
    paddingVertical: 3,
    paddingHorizontal: 6,
    shadowColor: '#28190a',
    shadowOpacity: 0.18,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  badgeText: { fontSize: 13, lineHeight: 16 },
  number: {
    position: 'absolute',
    bottom: 6,
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  blank: {
    flex: 1,
    margin: 11,
    marginBottom: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#d6c8ad',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  blankPlus: { fontSize: 26, lineHeight: 28 },
  blankText: { fontSize: 12 },
});
