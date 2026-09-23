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
 * Cream paper in both themes, like the diagram's pages: a book is a physical
 * object. The paper darkens a little toward the spine on each side.
 */

import React, { memo } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { sanitizeMealTypes } from '@/shared/mealTypes';
import { MealTypeArt } from '@/components/library/MealTypeArt';
import { useRecipePhoto } from '@/lib/recipePhoto';
import { cookedLabel, keyIngredients, pageLayout, RATING_EMOJI, stepCount, timeLine, type Book } from '@/lib/recipeBox';
import { fonts } from '@/constants/colors';
import type { Entry } from '@/lib/api';

export const PAPER = '#fbf6ea';
const PAPER_SPINE = '#ece2cc';
const INK = '#2a2118';
const INK_SOFT = '#5c4d3c';
const MUTED = '#8a7a66';
const FAINT = '#a8977f';
const RULE = '#dccfb4';

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
  return (
    <View style={[styles.page, outer, { width, height }]}>
      {/* The paper, darkening toward the spine: right on a left page, left on
          a right page. */}
      <LinearGradient
        colors={[PAPER, PAPER, PAPER_SPINE]}
        locations={[0, 0.78, 1]}
        start={{ x: side === 'left' ? 0 : 1, y: 0 }}
        end={{ x: side === 'left' ? 1 : 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {content.kind === 'recipe' ? (
        <RecipeFace entry={content.entry} number={content.number} side={side} book={book} width={width} height={height} />
      ) : content.kind === 'blank' ? (
        <View style={styles.blank} testID="book-blank-page">
          <Text style={styles.blankPlus}>+</Text>
          <Text style={styles.blankText}>Room for one more</Text>
        </View>
      ) : null}
    </View>
  );
});

function RecipeFace({ entry, number, side, book, width, height }: { entry: Entry; number: number; side: 'left' | 'right'; book: Book; width: number; height: number }) {
  const recipe = entry.recipe;
  const photo = useRecipePhoto(entry);
  const primary = sanitizeMealTypes(recipe.mealTypes)[0] ?? null;
  const time = timeLine(recipe);
  const layout = pageLayout(width, time !== null);
  const { names, more } = keyIngredients(recipe);
  const steps = stepCount(recipe);
  const cooked = cookedLabel(entry.cooked, layout.shortPill);
  const rating = entry.rating;
  const serves = recipe.servings ? `Serves ${recipe.servings} · ` : '';
  // The prototype's photo is 34% of the page's content box.
  const photoH = Math.round((height - PAD_TOP - PAD_BOTTOM) * 0.34);
  return (
    <View style={styles.content} testID={`book-page-${entry.id}`}>
      <View style={[styles.photo, { height: photoH }]}>
        {photo ? (
          <Image source={photo} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <MealTypeArt type={primary} size={Math.round(photoH * 0.4)} tone="light" />
        )}
        {rating === 1 || rating === 0 || rating === -1 ? (
          <View style={styles.badge} testID="book-page-rating">
            <Text style={styles.badgeText}>{RATING_EMOJI[String(rating)]}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {recipe.title}
      </Text>
      {time ? (
        <Text style={styles.time} numberOfLines={1} testID="book-page-time">
          {time}
        </Text>
      ) : null}
      <Text style={styles.serves} numberOfLines={1}>
        {serves}
        {steps} {steps === 1 ? 'step' : 'steps'}
      </Text>
      {names.length ? (
        <Text style={styles.ingredients} numberOfLines={layout.ingredientLines}>
          {names.join(', ')}
          {more > 0 ? <Text style={styles.more}> +{more} more</Text> : null}
        </Text>
      ) : null}
      <View
        style={[styles.pill, cooked ? { backgroundColor: `${book.color}1f` } : styles.pillNever]}
        testID="book-page-cooked"
      >
        <Text style={[styles.pillText, { color: cooked ? book.color : MUTED }]} numberOfLines={1}>
          {cooked ?? 'Not cooked yet'}
        </Text>
      </View>
      <Text style={[styles.number, side === 'left' ? { left: 11 } : { right: 11 }]}>{number}</Text>
    </View>
  );
}

const PAD_TOP = 12;
const PAD_BOTTOM = 20;

const styles = StyleSheet.create({
  page: { backgroundColor: PAPER, overflow: 'hidden' },
  content: { flex: 1, paddingTop: PAD_TOP, paddingHorizontal: 11, paddingBottom: PAD_BOTTOM },
  photo: { borderRadius: 6, overflow: 'hidden' },
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
  title: { marginTop: 8, fontFamily: fonts.heading, fontSize: 14.5, lineHeight: 18, color: INK },
  time: { marginTop: 5, fontFamily: fonts.mono, fontSize: 11, lineHeight: 14, color: MUTED },
  serves: {
    marginTop: 7,
    paddingTop: 6,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: RULE,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    lineHeight: 14,
    color: MUTED,
  },
  ingredients: { marginTop: 3, fontSize: 11.5, lineHeight: 15.5, color: INK_SOFT },
  more: { color: FAINT },
  pill: { marginTop: 'auto', alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 99, paddingVertical: 3, paddingHorizontal: 8 },
  pillNever: { backgroundColor: '#ece3d0' },
  pillText: { fontSize: 10.5, lineHeight: 13, fontWeight: '600' },
  number: {
    position: 'absolute',
    bottom: 6,
    fontSize: 10,
    color: FAINT,
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
  blankPlus: { fontSize: 26, lineHeight: 28, color: FAINT },
  blankText: { fontSize: 12, color: FAINT },
});
