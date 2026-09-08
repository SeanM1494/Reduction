/**
 * components/DemoScreen.tsx — the guacamole demo, reachable before sign-in.
 *
 * Rendered directly by SignInScreen instead of through expo-router: while
 * there is no token, `app/_layout.tsx`'s Gate mounts SignInScreen in place
 * of the whole navigator (see its header comment), so there is no Stack to
 * push a route onto yet. RecipeScreen itself needs nothing from that
 * navigator — it's a pure props-in component — so it renders here with
 * local, in-memory `done`/`timer` state and its own minimal header, the same
 * "never persists" shape as the web landing page's demo.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RecipeScreen } from '@/components/RecipeScreen';
import { DEMO_RECIPE } from '@/lib/demo-recipe';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import type { StepTimer } from '@/lib/api';

export function DemoScreen({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  // Pre-checked so the demo never opens flat — mirrors DEMO_PRECHECKED on
  // the web landing page, one step visibly ready before any interaction.
  const [done, setDone] = useState<string[]>(['avocados']);
  const [timer, setTimer] = useState<StepTimer | null>(null);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={onClose} hitSlop={12}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Demo</Text>
        <View style={styles.backSpacer} />
      </View>
      <RecipeScreen
        recipe={DEMO_RECIPE}
        done={done}
        servings={DEMO_RECIPE.servings}
        timer={timer}
        onToggleDone={setDone}
        onSetTimer={setTimer}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    back: { minWidth: 60 },
    backText: { color: colors.foreground, fontFamily: fonts.headingMedium, fontSize: 16 },
    backSpacer: { minWidth: 60 },
    headerTitle: { color: colors.foreground, fontFamily: fonts.headingMedium, fontSize: 16 },
  });
}
