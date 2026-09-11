import React, { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { LibraryProvider } from '@/lib/library-context';
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
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const colors = useColors();
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
