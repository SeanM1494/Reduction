import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { LibraryProvider } from '@/lib/library-context';
import { SignInScreen } from '@/components/SignInScreen';
import { useColors } from '@/hooks/useColors';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
  useFonts,
} from '@expo-google-fonts/space-grotesk';
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="recipe/[id]" options={{ title: '' }} />
      <Stack.Screen name="spike" options={{ title: 'Diagram spike' }} />
    </Stack>
  );
}

/** Gates the whole app on sign-in: no anonymous mode exists on mobile (see
 *  lib/auth-context.tsx for why). Shows a blank frame while the stored token
 *  is being checked, the sign-in screen when there is none, and the real app
 *  once a token is present. */
function Gate() {
  const { loading, token } = useAuth();
  const colors = useColors();
  const pathname = usePathname();

  /**
   * The Phase 0 diagram spike is fixture-fed and talks to no API, so it must
   * be reachable without a token — it is how the renderer gets verified on a
   * device before any signed-in screen exists. This is also a preview of the
   * settled first-run decision (the demo is explorable before sign-in; see
   * ROADMAP's mobile section): Phase 1 replaces this one-route exception
   * with the real demo gate.
   */
  if (pathname === '/spike') {
    return <RootLayoutNav />;
  }

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }
  if (!token) {
    return <SignInScreen />;
  }
  return (
    <LibraryProvider>
      <RootLayoutNav />
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
              <AuthProvider>
                <Gate />
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
