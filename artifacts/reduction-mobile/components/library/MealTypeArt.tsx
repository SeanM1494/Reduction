/**
 * components/library/MealTypeArt.tsx — the no-photo card face: a kitchen
 * sketch (lib/sketchData.ts) in the colour of the recipe's book on a pale
 * wash of it. Fills whatever box it is put in; `size` is the sketch's
 * nominal size and the drawing is a little larger than that.
 *
 * `seed` (the recipe's id) picks one of the meal type's two sketches and
 * `color` is the book's; a face with no book (the starter reel's cards) omits
 * `color` and gets the meal type's own tint.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { mealTypeArt, sketchColors, sketchKeyFor } from '@/lib/mealTypeArt';
import { SKETCHES, type SketchShape } from '@/lib/sketchData';
import { useColors } from '@/hooks/useColors';
import type { MealType } from '@/shared/mealTypes';

const STROKE = 2.4;

export function MealTypeArt({
  type,
  size = 36,
  tone: fixed,
  color,
  seed = '',
}: {
  type: MealType | null;
  size?: number;
  /** Force a tone instead of following the theme — the Recipe Box's pages
   *  stay cream in dark mode, and a dark tile on cream paper reads badly. */
  tone?: 'light' | 'dark';
  /** The recipe's book colour. */
  color?: string;
  /** The recipe's id: which of the two sketches. */
  seed?: string;
}) {
  const colors = useColors();
  const tone = fixed ?? colors.scheme;
  const art = mealTypeArt(type);
  const tint = tone === 'dark' ? art.dark : art.light;
  const { bg, ink } = color ? sketchColors(color, tone) : { bg: tint.bg, ink: tint.ink };
  const paper = bg;
  const shapes = SKETCHES[sketchKeyFor(type, seed)] ?? [];
  const px = Math.round(size * 1.6);
  return (
    <View style={[styles.box, { backgroundColor: bg }]} testID="card-art" accessibilityElementsHidden>
      <Svg width={px} height={px} viewBox="0 0 64 64">
        {shapes.map((s, i) => drawShape(s, i, ink, paper))}
      </Svg>
    </View>
  );
}

function drawShape(s: SketchShape, key: number, ink: string, paper: string) {
  const fill = s.fill === 'soft' ? ink : s.fill === 'paper' ? paper : s.fill === 'solid' ? ink : 'none';
  const common = {
    key,
    fill,
    fillOpacity: s.fill === 'soft' ? 0.2 : 1,
    stroke: s.stroke === false ? 'none' : ink,
    strokeWidth: STROKE,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    opacity: s.opacity ?? 1,
    transform: s.transform,
  };
  switch (s.t) {
    case 'path':
      return <Path {...common} d={s.d ?? ''} />;
    case 'circle':
      return <Circle {...common} cx={s.cx} cy={s.cy} r={s.r} />;
    case 'ellipse':
      return <Ellipse {...common} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} />;
    default:
      return <Rect {...common} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} />;
  }
}

const styles = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
