/**
 * components/reel/StarterReel.tsx — "Try one of these": a horizontal reel of
 * recipes for someone with none of their own yet, on Find › Add New and the
 * empty library. WHAT is in it is the server's (GET /api/reel: pages other
 * people cooked, then the owner's list, the search suggestions' privacy
 * rules); this draws it (lib/reelView.ts).
 *
 * Each card is a Recipe Box page (PageFace.tsx): the page's picture as our
 * server stored it — never fetched from the site by the phone — or its
 * meal-type art, the title, the stated time, serves and steps, the first
 * ingredients, then the use it has earned and the site it came from.
 *
 * A card is a link preview of somebody else's page (Oct 1): the site line
 * is a link to that page (Safari, as the recipe screen's "From … ↗"), and
 * VoiceOver offers the same as a custom action on the card. A tap anywhere
 * else on the card still opens the recipe.
 *
 * The cards are as tall as the room left on screen, so the reel fits without
 * the page scrolling (`reelCardSize`, measured from where the reel sits and
 * where the screen stops showing; the parent says the second). Below the
 * smallest card that is still a card, the page scrolls instead.
 *
 * It drifts sideways on its own, like a ticker, on the UI thread (one frame
 * callback, `tickerStep`). Any touch on it stops the drift at once; it
 * starts again 5s after the last touch, from wherever it was left. Looping
 * shows the cards twice, the second set hidden from VoiceOver. It never
 * drifts under Reduce Motion or VoiceOver, off screen, or with too few
 * cards to need to — and then the cards are shown once.
 *
 * It scrolls sideways INSIDE itself, never the page. It is absent — not an
 * empty box — when nothing qualifies, while the keyboard is up and while an
 * extraction runs, and the server sends nothing to a walled account.
 *
 * Fetched once an hour at most per app session (the server builds it once
 * an hour too), and "shown" is counted once a session, anonymously.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, { scrollTo, useAnimatedRef, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import { useIsFocused } from 'expo-router';
import { formatMinutes } from '@workspace/recipe-model';
import { fetchReel, reportCounter } from '@/lib/api';
import {
  CARD_METRICS,
  EMPTY_REEL,
  TICKER,
  reelA11yLabel,
  reelCardSize,
  siteLink,
  openSiteActionLabel,
  reelVisible,
  tickerLoops,
  tickerOn,
  tickerStep,
  cookedLine,
  likesBadge,
  type CardSize,
  type ReelCard,
  type ReelResponse,
} from '@/lib/reelView';
import { PageFace } from '@/components/recipeBox/PageFace';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useReelPhoto } from './useReelPhoto';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

const FETCH_EVERY_MS = 60 * 60 * 1000;
/** A plain number for the frame callback to capture. */
const TICKER_SPEED = TICKER.speed;
const HEADING_GAP = 8;
/** Kept clear between the cards and where the screen stops showing. */
const CLEARANCE = 8;
const USAGE_INK = '#8a4b2a';

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

/** Reduce Motion and VoiceOver, kept current: either one stops the ticker
 *  the moment it is switched on, not at the next launch. */
function useA11ySettings(): { reduceMotion: boolean; screenReader: boolean } {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((r) => live && setReduceMotion(r));
    // react-native-web answers `true` here always — a browser cannot know —
    // so only a phone's answer is believed.
    if (Platform.OS !== 'web')
      AccessibilityInfo.isScreenReaderEnabled()
        .catch(() => false)
        .then((r) => live && setScreenReader(r));
    const a = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const b = Platform.OS === 'web' ? null : AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      live = false;
      a?.remove?.();
      b?.remove?.();
    };
  }, []);
  return { reduceMotion, screenReader };
}

type StarterReelProps = {
  /** An extraction is running on this screen. */
  busy: boolean;
  onPick: (card: ReelCard) => void;
  /** The card being opened, which shows a spinner. */
  openingUrl: string | null;
  /** Where the screen stops SHOWING the page — the pane's height less the
   *  tab bar's band — in the same coordinates as this reel's own position
   *  in its parent (the scroll content's). The cards end a little above
   *  it, so the whole reel is seen without scrolling; the pane's padding
   *  below may still scroll, but nothing is under it. Null: the cards
   *  take their full height. */
  viewportBottom?: number | null;
  /** False while the pane holding it is hidden (another Find folder). */
  active?: boolean;
  testID?: string;
};

const Nothing = () => null;
let reportedFailure = false;

/**
 * The reel is decoration on two screens that must work without it (Find ›
 * Add New and the empty library), so it can never take them down (Oct 1,
 * after it closed the app on Find): a render error inside it is caught
 * here and the reel is simply absent. This catches JavaScript errors in
 * render; it CANNOT catch an error on the UI thread, which is why the
 * ticker's frame callback carries its own try/catch below, and why
 * workletRules.test.ts forbids what actually crashed.
 */
export function StarterReel(props: StarterReelProps) {
  return (
    <ErrorBoundary
      FallbackComponent={Nothing}
      onError={(e) => {
        if (reportedFailure) return;
        reportedFailure = true;
        console.warn('[reel] hidden after an error:', e.message);
      }}
    >
      <StarterReelBody {...props} />
    </ErrorBoundary>
  );
}

function StarterReelBody({
  busy,
  onPick,
  openingUrl,
  viewportBottom = null,
  active = true,
  testID = 'starter-reel',
}: StarterReelProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [reel, setReel] = useState<ReelResponse>(() => (memo && Date.now() - memo.at < FETCH_EVERY_MS ? memo.reel : EMPTY_REEL));
  const { reduceMotion, screenReader } = useA11ySettings();
  const keyboardUp = useKeyboardUp();
  const focused = useIsFocused();
  const { width: screenWidth } = useWindowDimensions();

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

  const visible = reelVisible(reel, { keyboardUp, busy: busy || !!openingUrl });
  useEffect(() => {
    if (visible && !shownCounted) {
      shownCounted = true;
      reportCounter('reel_shown');
    }
  }, [visible]);

  // ---- size: the room between the top of the cards and the screen's end.
  const [top, setTop] = useState<number | null>(null);
  const [headingH, setHeadingH] = useState(0);
  const rows = useMemo(
    () => ({ time: reel.cards.some((c) => !!c.totalMinutes), usage: reel.cards.some((c) => cookedLine(c) !== null) }),
    [reel]
  );
  const available =
    viewportBottom === null || top === null ? Number.POSITIVE_INFINITY : viewportBottom - top - headingH - HEADING_GAP - CLEARANCE;
  const size = reelCardSize(available, screenWidth, rows);

  // ---- the ticker.
  const [viewportW, setViewportW] = useState(0);
  const loops = tickerLoops(reel.cards.length, size.width, viewportW);
  const ticking = tickerOn({ reduceMotion, screenReader, focused: focused && active && visible, loops });
  const [held, setHeld] = useState(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    setHeld(true);
  };
  const releaseLater = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      setHeld(false);
    }, TICKER.resumeAfterMs);
  };
  useEffect(
    () => () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    },
    []
  );
  const running = ticking && !held && !openingUrl;

  const scroller = useAnimatedRef<Animated.ScrollView>();
  const offset = useSharedValue(0);
  const period = useSharedValue(0);
  const drifting = useSharedValue(false);
  // Set by the frame callback if a frame ever throws: the ticker stops for
  // good and the reel stays, still, rather than the UI thread taking the
  // app down. An error boundary cannot see the UI thread.
  const broken = useSharedValue(false);
  const setPeriod = reel.cards.length * (size.width + CARD_METRICS.gap);
  useEffect(() => {
    period.value = setPeriod;
  }, [setPeriod, period]);
  const frame = useFrameCallback((info) => {
    'worklet';
    if (broken.value) return;
    try {
      // Every argument passed: a worklet's default parameter is evaluated
      // before its closure exists (workletRules.test.ts).
      const next = tickerStep(offset.value, info.timeSincePreviousFrame ?? 16, period.value, TICKER_SPEED);
      offset.value = next;
      scrollTo(scroller, next, 0, false);
    } catch (_e) {
      broken.value = true;
    }
  }, false);
  useEffect(() => {
    drifting.value = running;
    frame.setActive(running);
  }, [running, frame, drifting]);
  // A hand-scroll moves the ticker's starting point with it.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!drifting.value) offset.value = e.nativeEvent.contentOffset.x;
  };

  if (!visible) return null;
  const onWrapLayout = (e: LayoutChangeEvent) => setTop(e.nativeEvent.layout.y);
  const sets = ticking ? 2 : 1;
  return (
    <View style={styles.wrap} onLayout={onWrapLayout} testID={testID}>
      <Text
        style={styles.heading}
        accessibilityRole="header"
        maxFontSizeMultiplier={1.4}
        onLayout={(e) => setHeadingH(e.nativeEvent.layout.height)}
        testID={`${testID}-heading`}
      >
        {reel.heading}
      </Text>
      <Animated.ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={styles.row}
        style={styles.scroller}
        decelerationRate={reduceMotion ? 'normal' : 'fast'}
        snapToInterval={reduceMotion ? undefined : size.width + CARD_METRICS.gap}
        snapToAlignment="start"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
        // Any touch stops the drift; the last one ending starts the clock.
        onTouchStart={hold}
        onTouchEnd={releaseLater}
        onTouchCancel={releaseLater}
        onScrollBeginDrag={hold}
        onScrollEndDrag={releaseLater}
        onMomentumScrollEnd={releaseLater}
        testID={`${testID}-scroller`}
      >
        {Array.from({ length: sets }, (_, set) =>
          reel.cards.map((c) => (
            <StarterCard
              key={`${set}:${c.url}`}
              card={c}
              size={size}
              copy={set > 0}
              opening={openingUrl === c.url}
              disabled={!!openingUrl}
              onPress={() => onPick(c)}
              styles={styles}
            />
          ))
        )}
      </Animated.ScrollView>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function StarterCard({
  card,
  size,
  copy,
  opening,
  disabled,
  onPress,
  styles,
}: {
  card: ReelCard;
  size: CardSize;
  /** The looping second set: the same card, hidden from VoiceOver. */
  copy: boolean;
  opening: boolean;
  disabled: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  const photo = useReelPhoto(card.photo);
  const cooked = cookedLine(card);
  const likes = likesBadge(card);
  const link = siteLink(card);
  const openSite = () => {
    if (link) Linking.openURL(link).catch(() => {});
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={reelA11yLabel(card)}
      accessibilityActions={link ? [{ name: 'activate' }, { name: 'openSite', label: openSiteActionLabel(card) }] : undefined}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'openSite') openSite();
        else if (e.nativeEvent.actionName === 'activate' && !disabled) onPress();
      }}
      accessibilityElementsHidden={copy}
      importantForAccessibility={copy ? 'no-hide-descendants' : 'auto'}
      aria-hidden={copy || undefined}
      focusable={!copy}
      tabIndex={copy ? -1 : 0}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.card, { width: size.width, height: size.height }, pressed && styles.pressed]}
      testID={copy ? 'starter-card-copy' : 'starter-card'}
    >
      <PageFace
        photo={photo}
        mealType={card.mealType}
        photoHeight={size.photoHeight}
        badge={
          likes ? (
            <View style={styles.badge} testID="starter-card-likes">
              <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
                {likes}
              </Text>
            </View>
          ) : null
        }
        photoOverlay={
          opening ? (
            <View style={styles.spinner}>
              <ActivityIndicator color="#2a2118" />
            </View>
          ) : null
        }
        title={card.title}
        time={card.totalMinutes ? formatMinutes(card.totalMinutes) : null}
        servings={card.servings}
        steps={card.steps ?? 0}
        showServes={size.showServes && card.steps !== null}
        ingredients={{ names: card.ingredients, more: card.moreIngredients }}
        ingredientLines={size.ingredientLines}
        paddingBottom={CARD_METRICS.padBottom}
        maxFontSizeMultiplier={1.2}
        footer={
          <View style={styles.footer}>
            {cooked ? (
              <Text style={styles.cooked} numberOfLines={1} maxFontSizeMultiplier={1.2} testID="starter-card-usage">
                {cooked}
              </Text>
            ) : null}
            {link ? (
              // The line stays 15pt so the card's measured rows hold; the
              // slop (17 + 15 + 12) takes the target to 44pt over the line above it (part
              // of the card, not a control) and the card's bottom padding.
              <Pressable
                onPress={openSite}
                hitSlop={{ top: 17, bottom: CARD_METRICS.padBottom, left: 8, right: 8 }}
                accessible={false}
                testID="starter-card-site"
              >
                <Text style={styles.site} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                  {card.site} ↗
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.site} numberOfLines={1} maxFontSizeMultiplier={1.2}>
                {card.site}
              </Text>
            )}
          </View>
        }
      />
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // Stretch, whatever the parent's alignment: a reel is as wide as the
    // screen, never as wide as its cards.
    wrap: { gap: HEADING_GAP, marginTop: 4, alignSelf: 'stretch' },
    heading: { fontFamily: fonts.heading, fontSize: 17, color: colors.foreground },
    // Edge to edge inside the padded pane, so a card can scroll off the
    // screen's edge rather than the padding's.
    scroller: { marginHorizontal: -16, flexGrow: 0 },
    row: { paddingHorizontal: 16, gap: CARD_METRICS.gap },
    // A page of the book: the box's paper, cream in both themes.
    card: {
      backgroundColor: colors.paper,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: '#e3d6bb',
      overflow: 'hidden',
    },
    pressed: { opacity: 0.85 },
    spinner: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(251,246,234,0.6)',
    },
    footer: { marginTop: 'auto', paddingTop: CARD_METRICS.footerGap, gap: 4 },
    cooked: { fontSize: 11, lineHeight: 15, fontWeight: '600', color: USAGE_INK },
    // The book page's rating badge, carrying the likes.
    badge: {
      position: 'absolute',
      top: 6,
      right: 6,
      backgroundColor: 'rgba(255,253,247,0.94)',
      borderRadius: 99,
      paddingVertical: 3,
      paddingHorizontal: 7,
      shadowColor: '#28190a',
      shadowOpacity: 0.18,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
    },
    badgeText: { fontSize: 12, lineHeight: 15, fontWeight: '600', color: '#2a2118' },
    // The page's muted grey (the time, the serves line): a theme token, darker
    // on the dark paper (Oct 1).
    site: { fontSize: 11, lineHeight: 15, color: colors.paperMuted },
  });
}
