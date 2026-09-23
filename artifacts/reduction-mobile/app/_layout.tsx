import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Platform, View } from 'react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ThemeProvider } from '@/lib/theme-context';
import { LibraryProvider } from '@/lib/library-context';
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
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { configureNotifications, onNotificationTap } from '@/lib/push';
import { notificationTarget } from '@/lib/pushPolicy';
import { setPurchaseHandler } from '@/lib/purchase';
import { startStoreKitReconciler, storeKitHandler } from '@/lib/storeKit';

// Prevent the splash screen from auto-hiding before asset loading is complete.
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
    </Stack>
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

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
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
      {/* Around the navigator, so a snackbar outlives the screen that raised
          it — a removed recipe's Undo waits in the library it lands in. */}
      <ToastProvider>
        <RootLayoutNav />
      </ToastProvider>
    </LibraryProvider>
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

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

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
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
