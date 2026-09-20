/**
 * components/ExtractionProgress.tsx — the wait for an extraction, in words.
 *
 * The web's ExtractionProgress ported (ROADMAP #9): while an extraction
 * runs, one line under the button walks the five stages in
 * lib/extractionStage.ts, one every STAGE_MS, and rests on the last. The
 * phrases and the pace are the web's, verbatim — see that module's header
 * for why the copy is load-bearing.
 *
 * THE LINE IS A FIXED HEIGHT. It appears when the extraction starts and
 * vanishes when it ends — that is one layout shift, at the moment the
 * person tapped, which is not a shift "as the message changes". The
 * message changing moves nothing: `minHeight` on the row and a single line
 * of text (`numberOfLines={1}`) hold it still, because the thing that must
 * never happen is the photo section walking down the screen every three
 * seconds under a thumb.
 *
 * ANNOUNCED, NOT ONLY SHOWN. For someone who cannot see it this is the
 * only signal that anything is happening at all. Android and RN-web read
 * `accessibilityLiveRegion`; iOS has no live regions, so each stage is
 * announced through AccessibilityInfo when the platform is iOS. Five
 * announcements over a wait is chatty; silence is worse (the web's call,
 * kept).
 *
 * Nothing rendered when idle: a permanently reserved slot would cost the
 * Find tab a line that is absent most of the time.
 */

import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { advance, STAGE_MS, STAGES } from '@/lib/extractionStage';
import { useColors, type Colors } from '@/hooks/useColors';

/**
 * Which message to show. Null when nothing is running.
 *
 * Resets to the start whenever `active` goes false, so a second extraction
 * begins at "Reading the recipe" rather than wherever the last one stopped.
 * setInterval rather than a chain of timeouts, cleared on the last stage
 * so nothing keeps ticking through a wait that outlasts the sequence.
 */
export function useReductionStage(active: boolean): string | null {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!active) {
      setI(0);
      return;
    }
    const id = setInterval(() => {
      setI((n) => {
        const { next, done } = advance(n);
        if (done) clearInterval(id);
        return next;
      });
    }, STAGE_MS);
    return () => clearInterval(id);
  }, [active]);

  return active ? STAGES[i] : null;
}

export function ExtractionProgress({ active, testID = 'extraction-progress' }: { active: boolean; testID?: string }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const stage = useReductionStage(active);

  // iOS has no live region; say each stage as it arrives.
  useEffect(() => {
    if (stage && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(stage);
  }, [stage]);

  if (!stage) return null;
  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLiveRegion="polite" testID={testID}>
      <ActivityIndicator size="small" color={colors.mutedForeground} />
      <Text style={styles.text} numberOfLines={1} testID={`${testID}-text`}>
        {stage}…
      </Text>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // .rd-extracting: 40px including its margin on the web; the same slot
    // here, held by minHeight rather than by the text.
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 28,
      marginTop: 4,
    },
    text: { flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.mutedForeground },
  });
}
