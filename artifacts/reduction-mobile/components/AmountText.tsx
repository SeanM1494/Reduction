/**
 * components/AmountText.tsx — an ingredient amount with its fraction glyphs
 * drawn at 1.5× the amount's size (shared/amounts.ts `fractionRuns`).
 *
 * A vulgar fraction is ONE character cell: in Space Mono the digits inside
 * "¼" are about 40% of the "2" beside it, which at the amounts' 13pt is a
 * 5pt numeral — unreadable across a counter (Sep 26, a real phone). At 1.5×
 * the fraction's digits come to roughly 60% of a whole number's, the usual
 * proportion for a set fraction. `fontSize` is passed explicitly because the
 * nested run needs a number, and a style array does not give one back.
 */

import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { fractionRuns } from '@/shared/amounts';

export const FRACTION_SCALE = 1.5;

export function AmountText({
  text,
  fontSize,
  style,
  testID,
}: {
  text: string;
  fontSize: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const runs = fractionRuns(text);
  if (!runs.some((r) => r.fraction)) return <Text style={style} testID={testID}>{text}</Text>;
  return (
    <Text style={style} testID={testID}>
      {runs.map((r, i) =>
        r.fraction ? (
          <Text key={i} style={{ fontSize: fontSize * FRACTION_SCALE }}>
            {r.text}
          </Text>
        ) : (
          r.text
        )
      )}
    </Text>
  );
}
