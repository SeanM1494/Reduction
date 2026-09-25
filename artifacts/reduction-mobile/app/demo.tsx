/**
 * app/demo.tsx — the guacamole demo, for someone who is already signed in.
 *
 * Signed out, the demo is the whole app (`_layout.tsx`'s Gate); signed in it
 * would otherwise be gone for good, and it is the only place that teaches
 * how to read a diagram. It is the same DemoScreen — same state-only
 * progress, nothing saved — pushed over the tabs, reached from Settings ›
 * How it works and from an empty library.
 *
 * Swipe-back is off for the same reason as on a recipe: the diagram scrolls
 * sideways, and at its left edge a rightward swipe is iOS's pop gesture.
 */

import React from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { DemoScreen } from '@/components/DemoScreen';
import { DemoTag } from '@/components/demo/DemoCoach';
import { DEMO_RECIPE } from '@/data/demoRecipe';

export default function DemoRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          title: DEMO_RECIPE.title,
          gestureEnabled: false,
          headerRight: () => (
            // iOS insets the header's right slot itself; the web header does not.
            <View style={{ marginRight: Platform.OS === 'web' ? 12 : 0 }}>
              <DemoTag />
            </View>
          ),
        }}
      />
      <DemoScreen />
    </>
  );
}
