/**
 * components/shopping/AddToListSheet.tsx — the add-to-list popup (Sean,
 * Oct 5): one recipe's ingredients, all ticked; untick what you have, set
 * the servings, then "Add to list". Opened for a recipe already on the list
 * it shows the earlier choices and the button says "Update list".
 *
 * Servings here are the LIST'S, never the recipe's: changing them writes
 * nothing to the library row (the recipe.servings / entry.servings rule in
 * CLAUDE.md, applied once more). They start from tonight's servings.
 *
 * Every rule is lib/shoppingList.ts; this only renders it. Mounted once, by
 * ShoppingListProvider.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Sheet } from '@/components/Sheet';
import { useToast } from '@/components/Toast';
import { useLibrary } from '@/lib/library-context';
import {
  listRecipe,
  popupLines,
  putRecipe,
  removeRecipe,
  servingsStep,
  togglePopupLine,
  type ShoppingListState,
} from '@/lib/shoppingList';
import { useColors, type Colors } from '@/hooks/useColors';
import { AMOUNT_COLUMN_MAX } from '@/lib/shoppingList';
import { fonts } from '@/constants/colors';

interface Props {
  entryId: string | null;
  onClose: () => void;
  state: ShoppingListState;
  change: (fn: (s: ShoppingListState) => ShoppingListState) => void;
}

export function AddToListSheet({ entryId, onClose, state, change }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { getEntry } = useLibrary();
  const toast = useToast();
  const pathname = usePathname();
  const entry = entryId ? getEntry(entryId) : undefined;
  const recipe = entry?.recipe ?? null;
  const existing = entryId ? listRecipe(state, entryId) : null;

  const [servings, setServings] = useState<number | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  // Seeded each time the sheet opens for a recipe: its earlier choices if it
  // is on the list, otherwise everything ticked at tonight's servings.
  useEffect(() => {
    if (!entryId || !entry) return;
    const prior = listRecipe(state, entryId);
    setServings(prior?.servings ?? entry.servings ?? entry.recipe.servings ?? null);
    setSkip(new Set(prior?.skip ?? []));
    // Only on open: the list changing underneath must not reset the ticks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const lines = useMemo(() => (recipe ? popupLines(recipe, servings, skip) : []), [recipe, servings, skip]);
  const ticked = lines.filter((l) => l.ticked).length;
  const base = recipe?.servings ?? null;
  const step = servingsStep(base);

  const commit = () => {
    if (!entryId || !recipe) return onClose();
    if (ticked === 0) {
      change((s) => removeRecipe(s, entryId));
      onClose();
      if (existing) toast({ message: 'Removed from your shopping list' });
      return;
    }
    // Store null when the servings are the recipe's own, so a later
    // correction of what the recipe makes is followed.
    const chosen = servings && base && servings === base ? null : servings;
    change((s) => putRecipe(s, { entryId, servings: chosen, skip: [...skip] }));
    onClose();
    const onList = pathname === '/shopping-list';
    toast({
      message: existing ? 'Shopping list updated' : 'Added to your shopping list',
      ...(onList ? {} : { action: { label: 'View list', onPress: () => router.push('/shopping-list') } }),
    });
  };

  const footer = recipe ? (
    <View style={styles.footer}>
      <Pressable
        accessibilityRole="button"
        onPress={commit}
        style={({ pressed }) => [styles.primary, ticked === 0 && !existing && styles.disabled, pressed && { opacity: 0.85 }]}
        disabled={ticked === 0 && !existing}
        testID="add-to-list-commit"
      >
        <Text style={styles.primaryText}>
          {ticked === 0
            ? existing
              ? 'Remove from list'
              : 'Nothing ticked'
            : existing
              ? 'Update list'
              : `Add ${ticked} ${ticked === 1 ? 'item' : 'items'} to list`}
        </Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <Sheet open={entryId !== null} title={recipe?.title ?? 'Shopping list'} onClose={onClose} closeLabel="Cancel" footer={footer}>
      {recipe ? (
        <View testID="add-to-list">
          {base ? (
            <View style={styles.servings}>
              <Text style={styles.servingsLabel}>Servings</Text>
              <View style={styles.stepper}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fewer servings"
                  onPress={() => setServings((v) => Math.max(step, (v ?? base) - step))}
                  disabled={(servings ?? base) <= step}
                  style={({ pressed }) => [styles.stepBtn, (servings ?? base) <= step && styles.disabled, pressed && styles.stepBtnPressed]}
                  testID="add-to-list-fewer"
                >
                  <Feather name="minus" size={18} color={colors.foreground} />
                </Pressable>
                <Text style={styles.servingsValue} testID="add-to-list-servings">
                  {servings ?? base}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="More servings"
                  onPress={() => setServings((v) => (v ?? base) + step)}
                  style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
                  testID="add-to-list-more"
                >
                  <Feather name="plus" size={18} color={colors.foreground} />
                </Pressable>
              </View>
            </View>
          ) : null}
          {lines.length === 0 ? (
            <Text style={styles.empty}>This recipe has no ingredients to add.</Text>
          ) : (
            <Text style={styles.hint}>Untick anything you already have.</Text>
          )}
          {lines.map((l) => (
            <Pressable
              key={l.key}
              accessibilityRole="checkbox"
              aria-checked={l.ticked}
              accessibilityLabel={`${l.name}${l.amount ? `, ${l.amount}` : ''}`}
              onPress={() => setSkip((s) => togglePopupLine(s, l))}
              style={styles.row}
              testID="add-to-list-line"
            >
              <View style={[styles.box, l.ticked ? styles.boxOn : styles.boxOff]}>
                {l.ticked ? <Feather name="check" size={15} color={colors.primaryForeground} /> : null}
              </View>
              {l.amount.length > AMOUNT_COLUMN_MAX ? (
                // A worded amount goes under the name, as on the list.
                <View style={styles.nameCol}>
                  <Text style={[styles.name, !l.ticked && styles.off]}>{l.name}</Text>
                  <Text style={[styles.amountUnder, !l.ticked && styles.off]}>{l.amount}</Text>
                </View>
              ) : (
                <>
                  <Text style={[styles.name, !l.ticked && styles.off]}>{l.name}</Text>
                  {l.amount ? <Text style={[styles.amount, !l.ticked && styles.off]}>{l.amount}</Text> : null}
                </>
              )}
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>This recipe is no longer in your library.</Text>
      )}
    </Sheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    servings: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radiusButton,
      backgroundColor: colors.muted,
      paddingLeft: 14,
      paddingRight: 6,
      paddingVertical: 4,
      marginBottom: 12,
    },
    servingsLabel: { fontSize: 15, color: colors.foreground },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    stepBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepBtnPressed: { borderColor: colors.borderStrong },
    servingsValue: { minWidth: 34, textAlign: 'center', fontFamily: fonts.heading, fontSize: 18, color: colors.foreground },
    hint: { fontSize: 13, color: colors.mutedForeground, marginBottom: 4 },
    empty: { fontSize: 15, color: colors.mutedForeground, paddingVertical: 12 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 48,
      paddingVertical: 6,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: colors.coolInk, borderColor: colors.coolInk },
    boxOff: { borderColor: colors.borderStrong },
    name: { flex: 1, fontSize: 16, color: colors.foreground },
    nameCol: { flex: 1 },
    amountUnder: { fontFamily: fonts.mono, fontSize: 13, color: colors.foreground, marginTop: 2 },
    amount: { fontFamily: fonts.mono, fontSize: 14, color: colors.foreground, textAlign: 'right', maxWidth: '45%' },
    off: { color: colors.mutedForeground, textDecorationLine: 'line-through' },
    footer: {},
    primary: { minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
    primaryText: { fontSize: 16, fontWeight: '600', color: colors.primaryForeground },
    disabled: { opacity: 0.4 },
  });
}
