/**
 * components/BrandLogo.tsx — the Reduction pot mark, ported from the web
 * app's `public/brand/reduction-icon-transparent.svg` (same paths, same
 * viewBox) so mobile and web show the same logo. Kept as inline
 * react-native-svg primitives rather than a rasterized asset: the source SVG
 * is transparent, so this renders correctly on both light and dark
 * backgrounds without shipping a PNG per theme.
 */

import React from 'react';
import Svg, { G, Path, Rect } from 'react-native-svg';

export function BrandLogo({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" role="img" aria-label="Reduction">
      <G fill="#C8362B">
        <Path
          transform="translate(89.5 38) scale(1.41667) rotate(-45) translate(-12 -12)"
          d="M0 24V12A12 12 0 0 1 12 0A12 12 0 0 1 24 12A12 12 0 0 1 12 24Z"
        />
        <Path
          transform="translate(135.5 42) scale(1.08333) rotate(-45) translate(-12 -12)"
          d="M0 24V12A12 12 0 0 1 12 0A12 12 0 0 1 24 12A12 12 0 0 1 12 24Z"
        />
        <Path
          transform="translate(174 45.5) scale(0.79167) rotate(-45) translate(-12 -12)"
          d="M0 24V12A12 12 0 0 1 12 0A12 12 0 0 1 24 12A12 12 0 0 1 12 24Z"
        />
        <Rect x={11} y={140} width={32} height={16} rx={8} />
        <Rect x={213} y={140} width={32} height={16} rx={8} />
        <Path d="M34 131A12 12 0 0 1 46 119H210A12 12 0 0 1 222 131V178A51 51 0 0 1 171 229H85A51 51 0 0 1 34 178Z" />
      </G>
      <Rect x={74} y={155} width={19.5} height={51} rx={9.75} fill="#F5ECD9" />
      <Rect x={103.5} y={167} width={19.5} height={39} rx={9.75} fill="#EFD2AE" />
      <Rect x={133} y={178} width={19.5} height={28} rx={9.75} fill="#E5AB86" />
      <Rect x={162.5} y={186.5} width={19.5} height={19.5} rx={9.75} fill="#DB7F5F" />
    </Svg>
  );
}
