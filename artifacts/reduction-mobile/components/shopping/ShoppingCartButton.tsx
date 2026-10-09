/**
 * components/shopping/ShoppingCartButton.tsx — the way to the shopping list
 * from the screens people live on (Sean, Oct 9: after "View list" he could
 * not find it again). A 44pt cart with the number of lines still to buy.
 * Always drawn, empty or not, so it can be found before there is a list;
 * the badge appears only when something is left to buy.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useShoppingList } from '@/lib/shopping-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export function ShoppingCartButton({ testID = 'shopping-cart' }: { testID?: string }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { view } = useShoppingList();
  const open = view.items.filter((i) => !i.checked).length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open > 0 ? `Shopping list, ${open} to buy` : 'Shopping list'}
      onPress={() => router.push('/shopping-list')}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.6 }]}
      testID={testID}
    >
      <Feather name="shopping-cart" size={21} color={colors.foreground} />
      {open > 0 ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText} maxFontSizeMultiplier={1.1}>
            {open > 99 ? '99+' : open}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    btn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    badge: {
      position: 'absolute',
      top: 4,
      right: 1,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 4,
      backgroundColor: colors.warmLine,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: { color: '#fff', fontSize: 11, lineHeight: 14, fontFamily: fonts.headingBold },
  });
}
