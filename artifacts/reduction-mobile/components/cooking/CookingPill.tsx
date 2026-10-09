/**
 * components/cooking/CookingPill.tsx — the bar above the tab bar while
 * something is being cooked, and the tray it opens (lib/cookingTray.ts has
 * the rules for what is in it).
 *
 * Tapping a row opens that recipe in Step-by-Step, which lands on its first
 * step not ticked — the place is never stored, it is derived. The ✕ on a
 * row and "Clear all" take recipes out of the tray only: ticks and timers
 * are left alone, so reopening the recipe finds its place.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Sheet } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { useCooking } from '@/lib/cooking-context';
import { useLibrary } from '@/lib/library-context';
import { cookProgress } from '@/lib/cookingTray';
import type { Entry } from '@/lib/api';

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function stepLabel(e: Entry, stepId: string | null): string | null {
  if (!stepId) return null;
  for (const s of e.recipe.sections) for (const n of s.nodes) if (n.id === stepId) return n.label;
  return null;
}

/** Where it sits above the bar: the classic bar is 49pt plus the home
 *  indicator; the iOS 26 glass bar floats a little higher. Neither is
 *  measurable from the Chromium sweep — a phone has to confirm this. */
const CLASSIC_BAR = 56;
const GLASS_BAR = 72;

export function CookingPill({ glass }: { glass: boolean }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { cooking, clearOneFromTray, clearTray } = useCooking();
  const { update } = useLibrary();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const anyTimer = cooking.some((e) => e.timer && e.timer.endsAt > now);

  useEffect(() => {
    if (!anyTimer) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyTimer]);

  // The tray closing because its last recipe was cleared.
  useEffect(() => {
    if (open && cooking.length === 0) setOpen(false);
  }, [open, cooking.length]);

  if (cooking.length === 0 && !open) return null;

  const first = cooking[0];
  const firstP = first ? cookProgress(first) : null;
  const firstTimer = first?.timer && first.timer.endsAt > now ? first.timer : null;
  // Soonest running timer across the tray, so the pill shows what rings first.
  const soonest = cooking
    .filter((e) => e.timer && e.timer.endsAt > now)
    .sort((a, b) => a.timer!.endsAt - b.timer!.endsAt)[0];

  const openRecipe = (e: Entry) => {
    setOpen(false);
    if (e.mode !== 'steps') update(e.id, { mode: 'steps' });
    router.push(`/recipe/${e.id}`);
  };

  return (
    <>
      {cooking.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Cooking ${cooking.length} recipe${cooking.length === 1 ? '' : 's'}. Open the list.`}
          onPress={() => (cooking.length === 1 && first ? openRecipe(first) : setOpen(true))}
          style={[styles.pill, { bottom: insets.bottom + (glass ? GLASS_BAR : CLASSIC_BAR) }]}
          testID="cooking-pill"
        >
          <View style={styles.count}>
            <Text style={styles.countText}>{cooking.length}</Text>
          </View>
          <View style={styles.pillBody}>
            <Text style={styles.pillTitle} numberOfLines={1}>
              {cooking.length === 1 && first ? first.recipe.title : 'Cooking now'}
            </Text>
            <Text style={styles.pillSub} numberOfLines={1}>
              {cooking.length === 1 && first && firstP
                ? `Step ${Math.min(firstP.doneSteps + 1, firstP.total)} of ${firstP.total}${firstTimer ? ` · ${fmt(firstTimer.endsAt - now)}` : ''}`
                : soonest?.timer
                  ? `${soonest.recipe.title} · ${fmt(soonest.timer.endsAt - now)}`
                  : cooking.map((e) => e.recipe.title).join(' · ')}
            </Text>
          </View>
          <Text style={styles.chev}>›</Text>
        </Pressable>
      ) : null}

      <Sheet open={open} title="Cooking now" onClose={() => setOpen(false)}>
        <View style={styles.list}>
          {cooking.map((e) => {
            const p = cookProgress(e);
            const label = stepLabel(e, p.currentStepId);
            const t = e.timer && e.timer.endsAt > now ? e.timer : null;
            return (
              <View key={e.id} style={styles.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${e.recipe.title}`}
                  onPress={() => openRecipe(e)}
                  style={styles.rowMain}
                  testID={`cooking-row-${e.id}`}
                >
                  <Text style={styles.rowTitle} numberOfLines={2}>{e.recipe.title}</Text>
                  <Text style={styles.rowSub} numberOfLines={2}>
                    {`Step ${Math.min(p.doneSteps + 1, p.total)} of ${p.total}`}
                    {label ? ` · ${label}` : ''}
                  </Text>
                  {t ? <Text style={styles.rowTimer}>{`Timer ${fmt(t.endsAt - now)}`}</Text> : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${e.recipe.title} from the list`}
                  onPress={() => clearOneFromTray(e.id)}
                  style={styles.x}
                  testID={`cooking-clear-${e.id}`}
                >
                  <Text style={styles.xText}>✕</Text>
                </Pressable>
              </View>
            );
          })}
          <Pressable
            accessibilityRole="button"
            onPress={clearTray}
            style={styles.clearAll}
            testID="cooking-clear-all"
          >
            <Text style={styles.clearAllText}>Clear all</Text>
          </Pressable>
          <Text style={styles.fine}>
            Clearing only takes a recipe off this list. Its ticked steps and timer stay.
          </Text>
        </View>
      </Sheet>
    </>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    pill: {
      position: 'absolute',
      left: 12,
      right: 12,
      minHeight: 52,
      borderRadius: 16,
      backgroundColor: c.foreground,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 10,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 6,
    },
    count: {
      minWidth: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.destructive,
      alignItems: 'center',
      justifyContent: 'center',
    },
    countText: { color: c.destructiveForeground, fontFamily: fonts.headingBold, fontSize: 14 },
    pillBody: { flex: 1, minWidth: 0 },
    pillTitle: { color: c.background, fontFamily: fonts.heading, fontSize: 15 },
    pillSub: { color: c.background, opacity: 0.8, fontFamily: fonts.heading, fontSize: 13, fontVariant: ['tabular-nums'] },
    chev: { color: c.background, fontSize: 24, paddingHorizontal: 4 },
    list: { gap: 10, paddingBottom: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: c.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
    },
    rowMain: { flex: 1, minHeight: 64, paddingVertical: 12, paddingLeft: 14, gap: 2 },
    rowTitle: { color: c.foreground, fontFamily: fonts.heading, fontSize: 16 },
    rowSub: { color: c.mutedForeground, fontFamily: fonts.heading, fontSize: 14 },
    rowTimer: { color: c.destructive, fontFamily: fonts.headingBold, fontSize: 14, fontVariant: ['tabular-nums'] },
    x: { width: 52, alignItems: 'center', justifyContent: 'center' },
    xText: { color: c.mutedForeground, fontSize: 18 },
    clearAll: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    clearAllText: { color: c.destructive, fontFamily: fonts.heading, fontSize: 16 },
    fine: { color: c.mutedForeground, fontFamily: fonts.heading, fontSize: 13, textAlign: 'center' },
  });
