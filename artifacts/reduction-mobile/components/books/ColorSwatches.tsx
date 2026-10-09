/**
 * components/books/ColorSwatches.tsx — the twelve book colours, as 44pt
 * swatches. A fixed set rather than a colour wheel (recipe-model
 * BOOK_COLORS): every one keeps a tab's white text readable, which a free
 * choice could not promise. Each reads its name to VoiceOver ("Plum,
 * selected"), and the chosen one carries a check, not only an outline.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BOOK_COLORS } from '@/shared/books';
import { useColors } from '@/hooks/useColors';

export function ColorSwatches({ value, onChange, testID = 'book-colors' }: { value: string; onChange: (hex: string) => void; testID?: string }) {
  const colors = useColors();
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Book color" testID={testID}>
      {BOOK_COLORS.map((c) => {
        const on = c.hex.toLowerCase() === value.toLowerCase();
        return (
          <Pressable
            key={c.hex}
            accessibilityRole="radio"
            accessibilityLabel={c.name}
            aria-checked={on}
            onPress={() => onChange(c.hex)}
            style={({ pressed }) => [
              styles.swatch,
              { backgroundColor: c.hex, borderColor: on ? colors.foreground : 'transparent' },
              pressed && { opacity: 0.85 },
            ]}
            testID={`${testID}-${c.name.toLowerCase()}`}
          >
            {on ? <Feather name="check" size={20} color="#fff" /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
});
