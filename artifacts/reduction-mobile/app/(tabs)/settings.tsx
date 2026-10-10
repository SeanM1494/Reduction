/**
 * app/(tabs)/settings.tsx — a list of thin rows, each opening a pop-up card
 * for its action, and the account (name and plan) as the last card.
 *
 * Sign out and Delete account live in the Account pop-up. The plan block,
 * the purchase seam (lib/purchase.ts) and the coupon box are the SAME
 * components as before, moved: an App Store subscription is managed in
 * the App Store's own page, a web one on the website, and only an existing
 * subscriber ever sees a link out (guideline 3.1.1 is about steering
 * someone toward buying elsewhere; managing what they already bought is
 * a different, permitted thing).
 *
 * A pop-up that leads somewhere else (a screen, an Alert) does it from
 * `onClosed`, once the Window is gone: iOS can refuse to present a Modal
 * while another is still dismissing.
 */

import { useTabBarClearance } from '@/hooks/useTabBarClearance';
import React, { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { AccountId } from '@/components/settings/AccountId';
import { AppearanceCard } from '@/components/settings/AppearanceCard';
import { BoxStyleCard } from '@/components/settings/BoxStyleCard';
import { UnitPrefCard } from '@/components/settings/UnitPrefCard';
import { TimersCard } from '@/components/settings/TimersCard';
import { FeedbackRow } from '@/components/settings/FeedbackRow';
import { RateRow } from '@/components/settings/RateRow';
import { SettingGroup, SettingRow, SettingWindow } from '@/components/settings/SettingRow';
import { SheetButton } from '@/components/Sheet';
import { loadRemoved } from '@/lib/api';
import { removedCountLabel } from '@/lib/recipeBox';
import { COUPONS_OFFERED, CouponBox } from '@/components/CouponBox';
import { SubscribeBox } from '@/components/SubscribeBox';
import { LegalLinks } from '@/components/LegalLinks';
import { manageSubscription } from '@/lib/purchase';
import { useColors, type Colors } from '@/hooks/useColors';
import { useBooks } from '@/lib/books-context';
import { useBoxStyle } from '@/lib/boxStyle';
import { useThemeState } from '@/lib/theme-context';
import { THEME_MODES } from '@/lib/themePolicy';
import { UNIT_PREFS } from '@/lib/unitPrefPolicy';
import { useUnitSetting } from '@/lib/unitPref';
import { timerAlertState } from '@/lib/timerAlerts';
import type { AlertState } from '@/lib/timerAlertPolicy';
import { boxSummary, planSummary, timerSummary } from '@/lib/settingsSummary';
import { requestReplay } from '@/lib/opening/launch';
import { isOwner } from '@/lib/opening/owner';
import { IntroTestingSheet } from '@/components/opening/IntroTestingSheet';
import { cardShadow, fonts } from '@/constants/colors';
import Constants from 'expo-constants';
import { versionLine } from '@/lib/updateStatus';
import { channelSuffix } from '@/lib/updateChannel';
import { loadUpdates, updatesUsable } from '@/components/settings/loadUpdates';

// Fixed for the life of the process (a channel switch restarts the app), so
// read once rather than in render. " · preview" only off production.
const updatesModule = loadUpdates();
const versionBase = versionLine(Constants.expoConfig?.version, Constants.nativeBuildVersion);
const version = versionBase ? versionBase + (updatesUsable(updatesModule) ? channelSuffix(updatesModule.channel) : '') : null;

type Pop = 'timers' | 'measure' | 'box' | 'look' | 'how' | 'help' | 'account';

export default function SettingsScreen() {
  const colors = useColors();
  const liveBookCount = useBooks().live.length;
  const styles = makeStyles(colors);
  const { user, entitlement, webUrl, signOut, deleteAccount } = useAuth();
  const owner = isOwner(user);
  const [introTesting, setIntroTesting] = useState(false);
  const { entries } = useLibrary();
  const tabClearance = useTabBarClearance();
  const [manageError, setManageError] = useState<string | null>(null);
  const [pop, setPop] = useState<Pop | null>(null);
  const boxStyle = useBoxStyle();
  const theme = useThemeState();
  const unitPref = useUnitSetting();
  // What a closing pop-up hands on to: run once it has finished closing.
  const afterClose = useRef<(() => void) | null>(null);
  const closeThen = (next: () => void) => {
    afterClose.current = next;
    setPop(null);
  };
  const handleClosed = () => {
    const next = afterClose.current;
    afterClose.current = null;
    readTimers();
    next?.();
  };
  const close = () => setPop(null);

  // The Timers row's value, and the Removed recipes row's count, re-read
  // whenever Settings comes back into view or a pop-up closes. Unknown until
  // read; a failed read shows nothing rather than a wrong value.
  const [timerState, setTimerState] = useState<AlertState | null>(null);
  const readTimers = useCallback(() => {
    timerAlertState()
      .then(setTimerState)
      .catch(() => setTimerState(null));
  }, []);
  const [removedCount, setRemovedCount] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      readTimers();
      loadRemoved()
        .then(({ entries: removed }) => setRemovedCount(removed.length))
        .catch(() => setRemovedCount(null));
    }, [readTimers])
  );

  const confirmSignOut = () => {
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: signOut },
    ]);
  };

  // The one place a subscription's provider is READ: for the sentence in
  // the confirm, because what deletion does to billing differs by who
  // bills. An App Store subscription is the person's to cancel — no server
  // can — so the dialog says so before, and the farewell says so after.
  const storeBilled = !!entitlement?.subscribed && entitlement.provider === 'apple';
  const confirmDeleteAccount = () => {
    const consequence = storeBilled
      ? ' Your App Store subscription is not cancelled by this — cancel it in Settings › Apple Account › Subscriptions, or it keeps billing.'
      : entitlement?.subscribed
        ? ' Your subscription is cancelled.'
        : '';
    Alert.alert(
      'Delete your account?',
      `Your recipes and your account are deleted for good. This cannot be undone.${consequence}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await deleteAccount();
              const remember = [
                result.manual.length ? 'cancel the App Store subscription in Settings › Apple Account › Subscriptions' : null,
                result.appleSignIn === 'manual' ? 'remove Reduction from Settings › Apple Account › Sign in with Apple' : null,
              ].filter(Boolean);
              if (remember.length) {
                Alert.alert('Account deleted', `Remember to ${remember.join(', and ')}.`);
              }
            } catch (e) {
              // Nothing was deleted (routes/account.ts refuses before it
              // touches a row when billing cannot be stopped), so the
              // session is still good and the sentence says to try again.
              Alert.alert('Could not delete your account', (e as Error).message || 'Try again in a moment.');
            }
          },
        },
      ]
    );
  };

  const planLabel = planSummary(entitlement);
  const unitLabel = UNIT_PREFS.find((u) => u.pref === unitPref)?.label ?? 'As written';
  const themeLabel = THEME_MODES.find((m) => m.mode === theme?.mode)?.label ?? 'System';
  const who = user?.name || user?.email || 'Signed in';

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: tabClearance + 24 }]}>
      <SettingGroup title="Cooking">
        <SettingRow label="Timers" value={timerSummary(timerState)} onPress={() => setPop('timers')} testID="settings-timers" />
        <SettingRow label="Measurements" value={unitLabel} onPress={() => setPop('measure')} testID="settings-measure" />
      </SettingGroup>

      <SettingGroup title="Your library">
        <SettingRow label="Recipe box" value={boxSummary(boxStyle, liveBookCount)} onPress={() => setPop('box')} testID="settings-box" />
        <SettingRow
          label="Removed recipes"
          value={removedCount === null ? undefined : removedCountLabel(removedCount)}
          onPress={() => router.push('/removed')}
          testID="settings-removed"
        />
      </SettingGroup>

      <SettingGroup title="App">
        <SettingRow label="Appearance" value={themeLabel} onPress={() => setPop('look')} testID="settings-look" />
        {/* A long press is the owner's intro testing sheet, and nobody else's. */}
        <SettingRow
          label="How it works"
          onPress={() => setPop('how')}
          onLongPress={owner ? () => setIntroTesting(true) : undefined}
          testID="settings-how"
        />
        <SettingRow label="Help and legal" onPress={() => setPop('help')} testID="settings-help" />
      </SettingGroup>
      {owner ? <IntroTestingSheet open={introTesting} onClose={() => setIntroTesting(false)} /> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Account, ${who}, ${planLabel}`}
        onPress={() => setPop('account')}
        style={({ pressed }) => [styles.account, pressed && styles.accountPressed]}
        testID="settings-account"
      >
        <View style={styles.accountText}>
          <Text style={styles.label}>Account</Text>
          <Text style={styles.value} numberOfLines={1}>
            {who}
          </Text>
          <Text style={styles.subvalue} numberOfLines={1} testID="settings-plan-line">
            {planLabel}
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </Pressable>

      {/* The binary, for everyone: what a support email and the App Store
          name (lib/updateStatus.ts). Which over-the-air update is running
          is the owner's testing sheet's to say. */}
      {version ? (
        <Text style={styles.version} selectable testID="settings-version">
          {version}
        </Text>
      ) : null}

      <SettingWindow open={pop === 'timers'} title="Timers" onClose={close} onClosed={handleClosed} testID="pop-timers">
        <TimersCard bare onChange={setTimerState} />
      </SettingWindow>

      <SettingWindow open={pop === 'measure'} title="Measurements" onClose={close} onClosed={handleClosed} testID="pop-measure">
        <UnitPrefCard bare />
      </SettingWindow>

      <SettingWindow open={pop === 'box'} title="Recipe box" onClose={close} onClosed={handleClosed} testID="pop-box">
        <BoxStyleCard bare />
        <SheetButton
          label={`Manage books (${liveBookCount})`}
          onPress={() => closeThen(() => router.push('/books'))}
          testID="settings-books"
        />
      </SettingWindow>

      <SettingWindow open={pop === 'look'} title="Appearance" onClose={close} onClosed={handleClosed} testID="pop-look">
        <AppearanceCard bare />
      </SettingWindow>

      <SettingWindow open={pop === 'how'} title="How it works" onClose={close} onClosed={handleClosed} testID="pop-how">
        <Text style={styles.sub}>Watch the guacamole demo again, or play the opening from the start.</Text>
        <SheetButton label="Replay the demo" onPress={() => closeThen(() => router.push('/demo'))} testID="settings-demo" />
        <SheetButton
          label="Replay the intro"
          onPress={() =>
            closeThen(() => {
              void AccessibilityInfo.isReduceMotionEnabled()
                .catch(() => false)
                .then((reduce) => requestReplay(reduce ? 'static' : 'full'));
            })
          }
          testID="settings-intro"
        />
      </SettingWindow>

      <SettingWindow open={pop === 'help'} title="Help and legal" onClose={close} onClosed={handleClosed} testID="pop-help">
        <FeedbackRow styles={plainRows(colors)} />
        <RateRow styles={plainRows(colors)} />
        <View style={styles.legal}>
          <LegalLinks />
        </View>
      </SettingWindow>

      <SettingWindow open={pop === 'account'} title="Account" onClose={close} onClosed={handleClosed} testID="pop-account">
        <View style={styles.block}>
          <Text style={styles.value}>{who}</Text>
          {user?.email && user?.name ? <Text style={styles.subvalue}>{user.email}</Text> : null}
          <Text style={styles.subvalue} testID="settings-recipe-count">
            {entries.length} {entries.length === 1 ? 'recipe' : 'recipes'} in your library
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.label}>Plan</Text>
          <Text style={styles.value}>{planLabel}</Text>
          {entitlement?.status === 'grace' ? (
            // Grace is the provider's own retry window, not a timer this app
            // runs, so the copy promises no number of days.
            <Text style={styles.subvalue}>
              Your last payment didn't go through. It will be retried, and nothing changes while it is.
            </Text>
          ) : null}
          {entitlement?.subscribed ? (
            entitlement.provider === 'apple' ? (
              // An App Store subscription is managed where it was bought.
              <Pressable
                style={styles.linkRow}
                onPress={async () => {
                  setManageError(null);
                  const out = await manageSubscription();
                  if (out.status === 'error') setManageError(out.message);
                }}
                testID="settings-manage-apple"
              >
                <Text style={styles.link}>Manage your subscription</Text>
              </Pressable>
            ) : (
              // Only shown to an already-active subscriber managing an
              // existing plan — never to someone without one.
              <Pressable style={styles.linkRow} onPress={() => Linking.openURL(webUrl || 'https://recipereduction.com')}>
                <Text style={styles.link}>Manage your plan on the website</Text>
              </Pressable>
            )
          ) : (
            <>
              {/* Nothing on a host that cannot sell; the plans on one that can. */}
              <View style={styles.coupon}>
                <SubscribeBox />
              </View>
              {/* The second place a code can go (the first is the wall):
                  someone given one last week comes here looking for it.
                  Never on an iPhone (CouponBox.tsx says why). */}
              {COUPONS_OFFERED ? (
                <View style={styles.coupon}>
                  <CouponBox />
                </View>
              ) : null}
            </>
          )}
          {manageError ? <Text style={styles.error}>{manageError}</Text> : null}
        </View>

        {user?.id ? <AccountId id={user.id} /> : null}

        <SheetButton label="Sign out" onPress={() => closeThen(confirmSignOut)} testID="settings-sign-out" />

        {/* Apple's 5.1.1(v): an account that can be created in the app can be
            deleted in it. Quiet — plain text, no card — so it is findable
            without being the loudest thing in the pop-up. */}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.deleteRow, pressed && { opacity: 0.6 }]}
          onPress={() => closeThen(confirmDeleteAccount)}
          testID="settings-delete-account"
        >
          <Text style={styles.deleteText}>Delete account</Text>
        </Pressable>
      </SettingWindow>
    </ScrollView>
  );
}

/** FeedbackRow and RateRow take the caller's row styles; inside a pop-up
 *  they are plain rows on the card, split by a hairline. */
function plainRows(colors: Colors) {
  return StyleSheet.create({
    section: { paddingVertical: 0 },
    navRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    navRowPressed: { opacity: 0.6 },
    navText: { flex: 1, gap: 2 },
    label: { fontFamily: fonts.headingMedium, fontSize: 16, color: colors.foreground },
    value: { fontSize: 13, color: colors.mutedForeground },
  });
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 16 },
    // The account card: the one tall element, last on the list.
    account: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 72,
      backgroundColor: colors.card,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 14,
      paddingHorizontal: 18,
      ...cardShadow,
    },
    accountPressed: { borderColor: colors.borderStrong },
    accountText: { flex: 1, gap: 2 },
    block: { gap: 4 },
    // The meta label in the app's mono, tracked and faint — the same voice
    // as .rd-card-meta and .rd-lib-count, not the system sans.
    label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.44, color: colors.faint, textTransform: 'uppercase' },
    value: { fontFamily: fonts.headingMedium, fontSize: 17, color: colors.foreground, marginTop: 2 },
    subvalue: { fontSize: 13, color: colors.mutedForeground },
    sub: { fontSize: 14, lineHeight: 20, color: colors.mutedForeground },
    linkRow: { marginTop: 6, minHeight: 44, justifyContent: 'center' },
    coupon: { marginTop: 12 },
    error: { fontSize: 13.5, lineHeight: 19, color: colors.dangerInk, marginTop: 6 },
    link: { fontSize: 14, color: colors.coolInk, fontFamily: fonts.headingMedium, textDecorationLine: 'underline' },
    legal: { paddingHorizontal: 4 },
    deleteRow: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    version: { color: colors.faint, fontSize: 13, textAlign: 'center', marginTop: 4 },
    deleteText: { color: colors.mutedForeground, fontSize: 14, textDecorationLine: 'underline' },
  });
}
