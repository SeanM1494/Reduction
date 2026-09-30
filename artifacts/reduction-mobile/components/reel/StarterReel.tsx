/**
 * components/reel/StarterReel.tsx — "Try one of these": a horizontal reel of
 * recipes for someone with none of their own yet, on Find › Add New and the
 * empty library. WHAT is in it is the server's (GET /api/reel: pages other
 * people cooked, then the owner's list, the search suggestions' privacy
 * rules); this draws it (lib/reelView.ts).
 *
 * It scrolls sideways INSIDE itself, never the page. It is absent — not an
 * empty box — when nothing qualifies, while the keyboard is up and while an
 * extraction runs, and the server sends nothing to a walled account. Cards
 * are our meal-type art, never a site's photo. With Reduce Motion the
 * scroll does not snap.
 *
 * Fetched once an hour at most per app session (the server builds it once
 * an hour too), and "shown" is counted once a session, anonymously.
 */

import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchReel, reportCounter } from '@/lib/api';
import { EMPTY_REEL, reelA11yLabel, reelMeta, reelVisible, type ReelCard, type ReelResponse } from '@/lib/reelView';
import { MealTypeArt } from '@/components/library/MealTypeArt';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

const CARD_W = 140;
const CARD_GAP = 10;
const FETCH_EVERY_MS = 60 * 60 * 1000;

// Per app session: one fetch an hour, one "shown" count.
let memo: { at: number; reel: ReelResponse } | null = null;
let shownCounted = false;

function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return up;
}

export function StarterReel({
  busy,
  onPick,
  openingUrl,
  testID = 'starter-reel',
}: {
  /** An extraction is running on this screen. */
  busy: boolean;
  onPick: (card: ReelCard) => void;
  /** The card being opened, which shows a spinner. */
  openingUrl: string | null;
  testID?: string;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [reel, setReel] = useState<ReelResponse>(() => (memo && Date.now() - memo.at < FETCH_EVERY_MS ? memo.reel : EMPTY_REEL));
  const [reduceMotion, setReduceMotion] = useState(false);
  const keyboardUp = useKeyboardUp();

  useEffect(() => {
    let live = true;
    if (memo && Date.now() - memo.at < FETCH_EVERY_MS) return;
    void fetchReel().then((r) => {
      memo = { at: Date.now(), reel: r };
      if (live) setReel(r);
    });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((r) => live && setReduceMotion(r));
    return () => {
      live = false;
    };
  }, []);

  const visible = reelVisible(reel, { keyboardUp, busy: busy || !!openingUrl });
  useEffect(() => {
    if (visible && !shownCounted) {
      shownCounted = true;
      reportCounter('reel_shown');
    }
  }, [visible]);

  if (!visible) return null;
  return (
    <View style={styles.wrap} testID={testID}>
      <Text style={styles.heading} accessibilityRole="header" maxFontSizeMultiplier={1.4} testID={`${testID}-heading`}>
        {reel.heading}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={styles.row}
        style={styles.scroller}
        decelerationRate={reduceMotion ? 'normal' : 'fast'}
        snapToInterval={reduceMotion ? undefined : CARD_W + CARD_GAP}
        snapToAlignment="start"
        testID={`${testID}-scroller`}
      >
        {reel.cards.map((c) => (
          <Pressable
            key={c.url}
            accessibilityRole="button"
            accessibilityLabel={reelA11yLabel(c)}
            onPress={() => onPick(c)}
            disabled={!!openingUrl}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            testID="starter-card"
          >
            <View style={styles.art}>
              <MealTypeArt type={c.mealType} size={26} />
              {openingUrl === c.url ? (
                <View style={styles.spinner}>
                  <ActivityIndicator color={colors.foreground} />
                </View>
              ) : null}
            </View>
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                {c.title}
              </Text>
              <Text style={styles.meta} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {reelMeta(c)}
              </Text>
              {c.usage ? (
                <Text style={styles.usage} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {c.usage}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // Stretch, whatever the parent's alignment: a reel is as wide as the
    // screen, never as wide as its cards.
    wrap: { gap: 8, marginTop: 4, alignSelf: 'stretch' },
    heading: { fontFamily: fonts.heading, fontSize: 17, color: colors.foreground },
    // Edge to edge inside the padded pane, so a card can scroll off the
    // screen's edge rather than the padding's.
    scroller: { marginHorizontal: -16 },
    row: { paddingHorizontal: 16, gap: CARD_GAP },
    card: {
      width: CARD_W,
      minHeight: 150,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    pressed: { opacity: 0.8 },
    art: { height: 64 },
    spinner: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.08)' },
    text: { padding: 10, gap: 3 },
    title: { fontFamily: fonts.heading, fontSize: 15, lineHeight: 19, color: colors.foreground },
    meta: { fontSize: 12.5, color: colors.mutedForeground },
    usage: { fontSize: 12, color: colors.coolInk },
  });
}
