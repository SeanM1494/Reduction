/**
 * app/shopping-list.tsx — the shopping list, in two tabs (Sean, Oct 5):
 *
 *  - List: every line, merged across recipes. Tap to check it off in the
 *    store, ✕ to take it off. Share hands the lines not yet checked off to
 *    the phone's share sheet (Reminders, Notes, Messages), and a share that
 *    went through asks whether to clear the list.
 *  - Recipes: what was added, each with "4/5 ingredients added to list".
 *    Tapping one reopens its popup; "Add a recipe" picks another.
 *
 * Reached from the "View list" note after adding, and from "Shopping list"
 * in a recipe's ⋮ menu. Kept on this phone (lib/shopping-context.tsx).
 */

import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShoppingList } from '@/lib/shopping-context';
import { useLibrary } from '@/lib/library-context';
import { searchLibrary } from '@/lib/libraryView';
import { AMOUNT_COLUMN_MAX, addedLabel, emptyList, removeItem, shareText, toggleChecked } from '@/lib/shoppingList';
import { Sheet } from '@/components/Sheet';
import { Window } from '@/components/Window';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

type Tab = 'list' | 'recipes';

export default function ShoppingListScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { view, change, openAddToList } = useShoppingList();
  const { entries } = useLibrary();
  const [tab, setTab] = useState<Tab>('list');
  const [picking, setPicking] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [askClear, setAskClear] = useState<'shared' | 'button' | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const open = view.items.filter((i) => !i.checked).length;
  const onList = useMemo(() => new Set(view.recipes.map((r) => r.entryId)), [view.recipes]);
  // Newest first with nothing typed; searchLibrary answers only a query.
  const candidates = useMemo(
    () => (pickQuery.trim() ? searchLibrary(entries, pickQuery) : [...entries].sort((a, b) => b.savedAt - a.savedAt)),
    [entries, pickQuery]
  );

  const share = async () => {
    setShareError(null);
    try {
      const result = await Share.share({ message: shareText(view) });
      // iOS says whether it went anywhere; a cancelled share asks nothing.
      // (Android reports sharedAction either way; the app ships on iOS.)
      if (result.action === Share.sharedAction) setAskClear('shared');
    } catch {
      setShareError(Platform.OS === 'web' ? 'Sharing is not available here.' : 'Could not open the share sheet.');
    }
  };

  const tabs = (
    <View style={styles.tabs} accessibilityRole="tablist">
      {(['list', 'recipes'] as const).map((t) => {
        const on = tab === t;
        const label = t === 'list' ? `List (${view.items.length})` : `Recipes (${view.recipes.length})`;
        return (
          <Pressable
            key={t}
            accessibilityRole="tab"
            aria-selected={on}
            onPress={() => setTab(t)}
            style={[styles.tab, on && styles.tabOn]}
            testID={`shopping-tab-${t}`}
          >
            <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={styles.screen}>
      {tabs}
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        testID="shopping-list"
      >
        {tab === 'list' ? (
          view.items.length === 0 ? (
            <Text style={styles.empty}>
              Your list is empty. Open a recipe and tap Add to shopping list, or add one from the Recipes tab.
            </Text>
          ) : (
            <>
              <View style={styles.card}>
                {view.items.map((it, i) => {
                  // A worded amount ("1 (15 oz) can") goes under the name;
                  // in the right-hand column it squeezed the name to a word.
                  const long = it.amount.length > AMOUNT_COLUMN_MAX;
                  const from =
                    view.recipes.length > 1
                      ? it.from.map((id) => view.recipes.find((r) => r.entryId === id)?.title).filter(Boolean).join(', ')
                      : '';
                  return (
                  <View key={it.key} style={[styles.itemRow, i > 0 && styles.divider]}>
                    <Pressable
                      accessibilityRole="checkbox"
                      aria-checked={it.checked}
                      accessibilityLabel={`${it.name}${it.amount ? `, ${it.amount}` : ''}`}
                      onPress={() => change((s) => toggleChecked(s, it.key))}
                      style={styles.itemMain}
                      testID="shopping-item"
                    >
                      <View style={[styles.box, it.checked ? styles.boxOn : styles.boxOff]}>
                        {it.checked ? <Feather name="check" size={15} color={colors.primaryForeground} /> : null}
                      </View>
                      <View style={styles.itemText}>
                        <Text style={[styles.itemName, it.checked && styles.done]}>{it.name}</Text>
                        {long ? <Text style={[styles.itemAmountUnder, it.checked && styles.done]}>{it.amount}</Text> : null}
                        {from ? (
                          <Text style={styles.itemFrom} numberOfLines={1}>
                            {from}
                          </Text>
                        ) : null}
                      </View>
                      {it.amount && !long ? <Text style={[styles.itemAmount, it.checked && styles.done]}>{it.amount}</Text> : null}
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${it.name}`}
                      onPress={() => change((s) => removeItem(s, it, entries))}
                      style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}
                      testID="shopping-item-remove"
                    >
                      <Feather name="x" size={18} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                  );
                })}
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={share}
                style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
                testID="shopping-share"
              >
                <Feather name="share" size={18} color={colors.primaryForeground} />
                <Text style={styles.primaryText}>
                  {open && open < view.items.length ? `Share ${open} ${open === 1 ? 'item' : 'items'}` : 'Share list'}
                </Text>
              </Pressable>
              {shareError ? <Text style={styles.error}>{shareError}</Text> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => setAskClear('button')}
                style={styles.clear}
                testID="shopping-clear"
              >
                <Text style={styles.clearText}>Clear list</Text>
              </Pressable>
            </>
          )
        ) : (
          <View style={styles.card}>
            {view.recipes.map((r, i) => (
              <Pressable
                key={r.entryId}
                accessibilityRole="button"
                onPress={() => openAddToList(r.entryId)}
                style={({ pressed }) => [styles.recipeRow, i > 0 && styles.divider, pressed && styles.pressed]}
                testID="shopping-recipe"
              >
                <View style={styles.itemText}>
                  <Text style={styles.recipeTitle}>{r.title}</Text>
                  <Text style={styles.recipeMeta}>
                    {addedLabel(r)}
                    {r.servings ? ` · ${r.servings} servings` : ''}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setPicking(true)}
              style={({ pressed }) => [styles.recipeRow, view.recipes.length > 0 && styles.divider, pressed && styles.pressed]}
              testID="shopping-add-recipe"
            >
              <Feather name="plus" size={18} color={colors.coolInk} />
              <Text style={styles.addText}>Add a recipe</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <Sheet
        open={picking}
        title="Add a recipe"
        closeLabel="Cancel"
        onClose={() => setPicking(false)}
        onClosed={() => {
          setPickQuery('');
          if (picked) {
            openAddToList(picked);
            setPicked(null);
          }
        }}
      >
        <TextInput
          value={pickQuery}
          onChangeText={setPickQuery}
          placeholder="Search your recipes"
          placeholderTextColor={colors.faint}
          style={styles.search}
          autoCorrect={false}
          clearButtonMode="while-editing"
          testID="shopping-pick-search"
        />
        {candidates.length === 0 ? <Text style={styles.empty}>No recipes match.</Text> : null}
        {candidates.map((e) => (
          <Pressable
            key={e.id}
            accessibilityRole="button"
            onPress={() => {
              setPicked(e.id);
              setPicking(false);
            }}
            style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
            testID="shopping-pick"
          >
            <Text style={styles.pickTitle} numberOfLines={2}>
              {e.recipe.title}
            </Text>
            {onList.has(e.id) ? <Text style={styles.pickOn}>On list</Text> : null}
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </Sheet>

      <Window open={askClear !== null} onClose={() => setAskClear(null)} maxWidth={400} testID="shopping-clear-window">
        <Text style={styles.confirmHeading} accessibilityRole="header">
          {askClear === 'shared' ? 'Clear your shopping list?' : 'Clear the whole list?'}
        </Text>
        <Text style={styles.confirmBody}>
          {askClear === 'shared'
            ? 'Your list has been sent. Clearing it here starts the next one fresh.'
            : 'Every item and recipe comes off the list. Your recipes stay in your library.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            change(() => emptyList());
            setAskClear(null);
          }}
          style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.85 }]}
          testID="shopping-clear-confirm"
        >
          <Text style={styles.dangerBtnText}>Clear list</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => setAskClear(null)}
          style={({ pressed }) => [styles.keepBtn, pressed && { borderColor: colors.borderStrong }]}
          testID="shopping-clear-keep"
        >
          <Text style={styles.keepBtnText}>Keep it</Text>
        </Pressable>
      </Window>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    tabs: {
      flexDirection: 'row',
      marginHorizontal: 16,
      marginTop: 8,
      marginBottom: 4,
      padding: 3,
      borderRadius: colors.radiusButton,
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tab: { flex: 1, minHeight: 44, borderRadius: colors.radius, alignItems: 'center', justifyContent: 'center' },
    tabOn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderStrong },
    tabText: { fontSize: 15, color: colors.mutedForeground },
    tabTextOn: { color: colors.foreground, fontWeight: '600' },
    body: { paddingHorizontal: 16, paddingTop: 12, gap: 12 },
    empty: { fontSize: 15, lineHeight: 21, color: colors.mutedForeground, paddingVertical: 12 },
    card: {
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: 12,
    },
    divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    itemRow: { flexDirection: 'row', alignItems: 'center' },
    itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 6 },
    itemText: { flex: 1, minWidth: 0 },
    itemName: { fontSize: 16, color: colors.foreground },
    itemFrom: { fontSize: 12, color: colors.mutedForeground, marginTop: 1 },
    itemAmountUnder: { fontFamily: fonts.mono, fontSize: 13, color: colors.foreground, marginTop: 2 },
    itemAmount: { fontFamily: fonts.mono, fontSize: 14, color: colors.foreground, textAlign: 'right', maxWidth: '40%' },
    done: { color: colors.mutedForeground, textDecorationLine: 'line-through' },
    box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: colors.coolInk, borderColor: colors.coolInk },
    boxOff: { borderColor: colors.borderStrong },
    remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
    primary: {
      flexDirection: 'row',
      gap: 8,
      minHeight: 50,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    primaryText: { fontSize: 16, fontWeight: '600', color: colors.primaryForeground },
    error: { fontSize: 14, color: colors.dangerInk, textAlign: 'center' },
    clear: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    clearText: { fontSize: 15, color: colors.dangerInk },
    recipeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60, paddingVertical: 8 },
    pressed: { opacity: 0.7 },
    recipeTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.foreground },
    recipeMeta: { fontSize: 13, color: colors.mutedForeground, marginTop: 2 },
    addText: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.coolInk },
    search: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      backgroundColor: colors.muted,
      paddingHorizontal: 12,
      fontSize: 16,
      color: colors.foreground,
      marginBottom: 6,
    },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      minHeight: 52,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pickTitle: { flex: 1, fontSize: 16, color: colors.foreground },
    pickOn: { fontSize: 12, color: colors.coolInk },
    confirmHeading: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, textAlign: 'center', color: colors.foreground },
    confirmBody: { marginTop: 10, fontSize: 15, lineHeight: 21, textAlign: 'center', color: colors.foreground },
    // The delete confirmation's red, fixed in both themes.
    dangerBtn: { marginTop: 18, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#92351b' },
    dangerBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
    keepBtn: { marginTop: 8, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    keepBtnText: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  });
}
