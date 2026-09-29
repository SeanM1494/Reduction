/**
 * components/BrandLogo.tsx — the Reduction mark: the pot, the shaker and the
 * vinegar bottle, on a transparent background so it sits on either theme.
 *
 * An image of the supplied artwork (`brand/reduction-mark-1024.png`, resized
 * to 384px by `scripts/brand-icons.mjs`: 128pt at 3x), never a hand port of
 * its paths. The last mark was redrawn here as react-native-svg primitives,
 * which is a second copy of the artwork that has to be kept in step by hand;
 * a new mark is a new file in brand/ and one script run.
 *
 * The artwork has its own margin inside the square (it spans about 70% of
 * the width), so `size` is the square, not the drawing.
 */

import React from 'react';
import { Image } from 'react-native';

const MARK = require('@/assets/images/brand-mark.png');

export function BrandLogo({ size = 64 }: { size?: number }) {
  return (
    <Image
      source={MARK}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="Reduction"
    />
  );
}
