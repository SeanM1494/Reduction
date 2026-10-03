/**
 * app/(tabs)/index.tsx — Find: three folder tabs over one pane.
 *
 *   My Recipes — search the person's own box (components/find/MyRecipesPane)
 *   Add New    — a link, a photo or the recipe's text (AddNewPane)
 *   Browse     — the in-app browser (BrowsePane)
 *
 * Add New is where Find opens when the app starts, because it is what Find
 * is mostly for. Coming back to Find later keeps whichever tab was up: all
 * three panes stay mounted and only the chosen one is shown, so a half-typed
 * paste, a search and the page open in Browse are all where they were left.
 * Nothing about the tabs is remembered once the app closes. A hand-off wins
 * over that: the Recipe Box's "nothing matched" opens My Recipes with its
 * query (?q=), a blocked link opens Browse on that page, and a recipe
 * shared from another app opens Add New, already reading it.
 *
 * No navigator header: the tabs and each pane's heading say where you are,
 * and on an iPhone SE the 44pt a header costs is the Browse page's. So the
 * screen pays the top inset itself — which is also what the iOS 26 native
 * tab layout, which has no header at all, needs (CLAUDE.md, "There are TWO
 * tab layouts").
 *
 * The wall: one predicate for the whole screen, the web's isWalled
 * (`allowed && enforced`, read from the same `entitlementFor` the server's
 * `checkAccess` decides with). Add New shows it in place of its controls, as
 * the Find tab always did.
 */

import React, { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { FolderTabs, type FindTab } from '@/components/find/FolderTabs';
import { MyRecipesPane } from '@/components/find/MyRecipesPane';
import { AddNewPane } from '@/components/find/AddNewPane';
import { BrowsePane } from '@/components/find/BrowsePane';
import { onShare, takeShare, type SharedItem } from '@/lib/sharedPage';
import { useColors } from '@/hooks/useColors';

/** The tab bar is absolutely positioned ((tabs)/_layout.tsx); each pane
 *  pads itself past it. */
const TAB_BAR = 84;

export default function FindScreen() {
  const colors = useColors();
  const { entitlement } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomInset = TAB_BAR + insets.bottom;

  const [tab, setTab] = useState<FindTab>('add');
  const choose = (next: FindTab) => {
    Keyboard.dismiss();
    setTab(next);
  };

  // Hand-offs arrive as params, are taken once and cleared, so coming back
  // to this tab later does not act on them again. A fresh token acts even
  // on the same words or the same page.
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [minePrefill, setMinePrefill] = useState<{ query: string; token: string } | null>(null);
  useEffect(() => {
    if (!q) return;
    setMinePrefill({ query: q, token: `${Date.now()}` });
    setTab('mine');
    router.setParams({ q: undefined });
  }, [q]);

  // A recipe shared from another app (lib/sharedPage.ts): taken once, here,
  // and read by Add New. The root layout has already brought Find forward.
  const [shared, setShared] = useState<{ item: SharedItem; token: string } | null>(null);
  useEffect(() => {
    const take = () => {
      const got = takeShare();
      if (!got) return;
      Keyboard.dismiss();
      setShared(got);
      setTab('add');
    };
    take();
    return onShare(take);
  }, []);

  const [browseRequest, setBrowseRequest] = useState<{ url: string; token: string } | null>(null);
  const openBrowse = (url: string | null) => {
    if (url) setBrowseRequest({ url, token: `${Date.now()}` });
    choose('browse');
  };

  // The same predicate as the web's isWalled: the wall bites only when the
  // allowance is exhausted AND enforcement is on (CLAUDE.md, "The wall is off
  // by default").
  const blocked = entitlement !== null && !entitlement.allowed && entitlement.enforced;

  const shown = (t: FindTab) => [styles.pane, { display: tab === t ? ('flex' as const) : ('none' as const) }];

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <FolderTabs tab={tab} onChange={choose} />
      <View style={shown('mine')}>
        <MyRecipesPane prefill={minePrefill} blocked={blocked} onOpenBrowse={openBrowse} bottomInset={bottomInset} />
      </View>
      <View style={shown('add')}>
        <AddNewPane blocked={blocked} onOpenBrowse={openBrowse} bottomInset={bottomInset} active={tab === 'add'} shared={shared} />
      </View>
      <View style={shown('browse')}>
        <BrowsePane request={browseRequest} blocked={blocked} bottomInset={bottomInset} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pane: { flex: 1 },
});
