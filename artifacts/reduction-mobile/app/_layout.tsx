import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-context';
import { LibraryProvider, useLibrary } from '@/lib/library-context';
import { BooksProvider } from '@/lib/books-context';
import { ToastProvider } from '@/components/Toast';
import { SignInScreen } from '@/components/SignInScreen';
import { DemoScreen } from '@/components/DemoScreen';
import { useColors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { Stack, router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { configureNotifications, onNotificationTap } from '@/lib/push';
import { notificationTarget } from '@/lib/pushPolicy';
import { setPurchaseHandler } from '@/lib/purchase';
import { startStoreKitReconciler, storeKitHandler } from '@/lib/storeKit';
import { OpeningHost } from '@/components/opening/OpeningHost';
import { bootLandingPending, markAppReady, noteAuthSettled, takeBootLanding } from '@/lib/opening/launch';

// The splash stays up until the launch is decided: OpeningHost hides it,
// either at once or on the opening sequence's first frame.
SplashScreen.preventAutoHideAsync();

// How a timer notification presents while the app is open (lib/push.ts).
configureNotifications();
// Who sells a subscription on this host: the App Store on an iPhone, nobody
// anywhere else (lib/purchase.ts). Registered once, before any screen asks.
if (Platform.OS === 'ios') setPurchaseHandler(storeKitHandler);

const queryClient = new QueryClient();

function RootLayoutNav() {
  const colors = useColors();
  const { refresh } = useAuth();
  const { settled } = useLibrary();
  const pathname = usePathname();
  // A signed-in cold start lands on the Recipe Box (lib/opening/destination.ts).
  // This tree mounting is the Gate's answer "signed in"; the first answer
  // in the process is the one that counts (a sign-in later in the session
  // lands nowhere new). Recorded in a lazy initializer — once, before this
  // tree's effects, and not a side effect the React Compiler may memoize.
  // The navigator mounts on Find first, so a cover the page colour hides
  // that one frame until the move is made; a notification or a link has
  // already gone where it points, and is never moved.
  const [covered, setCovered] = useState(() => {
    noteAuthSettled(true);
    return bootLandingPending();
  });
  const [landed, setLanded] = useState(!covered);
  useEffect(() => {
    let live = true;
    takeBootLanding().then((land) => {
      if (!live) return;
      if (land && (pathname === '/' || pathname === '')) router.replace('/library');
      setLanded(true);
      requestAnimationFrame(() => live && setCovered(false));
    });
    return () => {
      live = false;
    };
    // Once, on the first mount: a later route change is the person's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The opening sequence reveals the app when there is something true to
  // show: the landing made, and the library read (cache or network).
  useEffect(() => {
    if (landed && settled) markAppReady();
  }, [landed, settled]);
  // Whatever the store delivers outside a purchase — a renewal, an Ask to
  // Buy approval, a transaction left unfinished last time — is verified
  // and recorded, and the entitlement refreshed. Signed-in tree only:
  // verifying needs the session.
  useEffect(() => startStoreKitReconciler(() => void refresh()), [refresh]);
  // A tapped timer notification opens its recipe. Registered here, inside
  // the signed-in tree, because a timer belongs to an account's recipe and
  // there is nothing to open before sign-in.
  useEffect(() => {
    return onNotificationTap((data) => {
      const target = notificationTarget(data);
      if (target) router.push(`/recipe/${target.recipeId}`);
    });
  }, []);
  return (
    <>
      <Stack
        screenOptions={{
          headerBackTitle: 'Back',
          // The navigator's default header is a white bar with the system
          // font — nothing on the web is white. Set once here; every pushed
          // screen inherits it, including the ones not written yet.
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerTitleStyle: { fontFamily: fonts.heading, color: colors.foreground, fontSize: 17 },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="recipe/[id]" options={{ title: '' }} />
        <Stack.Screen name="removed" options={{ title: 'Removed recipes' }} />
        <Stack.Screen name="books" options={{ title: 'Manage books' }} />
        <Stack.Screen name="demo" options={{ title: '' }} />
        <Stack.Screen name="original/[id]" options={{ title: 'Original recipe' }} />
      </Stack>
      {covered ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
      ) : null}
    </>
  );
}


/**
 * The demo gate. No token: the guacamole demo is the first screen, fully
 * explorable, with sign-in one tap away — the settled first-run decision
 * (ROADMAP, mobile section), which replaced the Phase 0 spike's one-route
 * pass-through here. A token: the real app. No anonymous mode exists on
 * mobile (see lib/auth-context.tsx for why), so the demo talks to no API.
 */
function Gate() {
  const { loading, token } = useAuth();
  const colors = useColors();
  const [signingIn, setSigningIn] = useState(false);
  // Signed out: the first answer in this process (so a sign-in later in
  // the session lands nowhere new), and the demo is the destination,
  // ready as soon as it is here. Signed in is recorded by RootLayoutNav.
  useEffect(() => {
    if (loading || token) return;
    noteAuthSettled(false);
    markAppReady();
  }, [loading, token]);

  if (loading) return <Loading />;
  if (!token) {
    // The demo stays mounted behind the sign-in screen rather than
    // unmounting, so someone who checked off four ingredients, went to look
    // at sign-in and came back finds it where they left it.
    return (
      <>
        <View style={{ flex: 1, display: signingIn ? 'none' : 'flex' }}>
          <DemoScreen onSignIn={() => setSigningIn(true)} />
        </View>
        {signingIn ? <SignInScreen onBack={() => setSigningIn(false)} /> : null}
      </>
    );
  }
  return (
    <LibraryProvider>
      {/* Signed in only: the demo and sign-in never load books. */}
      <BooksProvider>
        {/* Around the navigator, so a snackbar outlives the screen that raised
            it — a removed recipe's Undo waits in the library it lands in. */}
        <ToastProvider>
          <RootLayoutNav />
        </ToastProvider>
      </BooksProvider>
    </LibraryProvider>
  );
}

/** Before sign-in is known, which can wait on the network: the page colour,
 *  and a spinner only once the wait is long enough to notice (300ms), so a
 *  quick launch never flashes one. Never a blank screen after the reveal. */
function Loading() {
  const colors = useColors();
  const [spin, setSpin] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSpin(true), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }} testID="app-loading">
      {spin ? <ActivityIndicator color={colors.mutedForeground} accessibilityLabel="Loading" /> : null}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              {/* Outside the auth gate: the demo is themed too. */}
              <ThemeProvider>
                <AuthProvider>
                  <Gate />
                </AuthProvider>
              </ThemeProvider>
              {/* Last, so it draws over everything; it is gone once it ends. */}
              <OpeningHost />
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
