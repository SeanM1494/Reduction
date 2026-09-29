/**
 * app/books.tsx — Manage books: the person's recipe books, from Settings
 * and from the Recipe Box header.
 *
 * Every book in shelf order, with its colour and how many recipes are in
 * it, and for each: up and down (so reordering needs no drag, and reads to
 * VoiceOver as "Move Dinner up"), and Edit — the name, the colour, and
 * "Delete or merge…". Then "Add a book", which stops at twelve and says
 * why. The rules are recipe-model books.ts; the writes go through
 * lib/booksQueue.ts, where add, rename, recolour and reorder wait out an
 * offline spell and delete/merge do not.
 *
 * DELETING IS MERGING. A book with recipes asks where they go first — any
 * other book, a new book made there and then, or Other — and the book it
 * goes into can be renamed in the same step; nothing is deleted until that
 * is answered. An empty book goes at once. Other can be renamed and
 * recoloured and never deleted. Offline, delete and merge change nothing
 * and say "Connect to the internet to delete or merge books."
 *
 * Dialogs are centred windows, and the next one opens from the previous
 * one's onClosed (CLAUDE.md: iOS can refuse a Modal presented while another
 * is dismissing).
 */

import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBooks } from '@/lib/books-context';
import { useLibrary } from '@/lib/library-context';
import { bookOf } from '@/lib/recipeBox';
import { newEntryId } from '@/lib/api';
import { Window } from '@/components/Window';
import { ColorSwatches } from '@/components/books/ColorSwatches';
import {
  BOOK_NAME_MAX,
  MAX_BOOKS,
  OTHER_BOOK_ID,
  addBook,
  bookLimitMessage,
  bookNameProblem,
  cleanBookName,
  deleteBook,
  deleteIntoNewBook,
  moveBook,
  nextBookColor,
  recolorBook,
  renameBook,
  type BookDef,
} from '@/shared/books';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

const countLabel = (n: number) => (n === 0 ? 'Empty' : n === 1 ? '1 recipe' : `${n} recipes`);

type Form = { mode: 'add' } | { mode: 'edit'; id: string };

export default function ManageBooksScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { books, live, available, queued, edit, failure, clearFailure } = useBooks();
  const { entries } = useLibrary();

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      const id = bookOf(e, books);
      m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [entries, books]);

  const [form, setForm] = useState<Form | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // "Delete or merge…" closes the edit window and opens this one only once
  // the first is gone.
  const deleteNext = useRef<string | null>(null);

  const full = live.length >= MAX_BOOKS;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
      testID="books-screen"
    >
      <Stack.Screen options={{ title: 'Manage books' }} />

      {available === false ? (
        <Text style={styles.note} testID="books-unavailable">
          Recipe books aren’t available yet. Your recipes stay in their usual books.
        </Text>
      ) : available === null ? (
        <Text style={styles.note}>Loading your books…</Text>
      ) : (
        <>
          <Text style={styles.intro}>
            Every recipe is in one book. Rename, recolour and reorder them here; deleting a book asks where its recipes go.
          </Text>
          {queued ? (
            <Text style={styles.queued} accessibilityLiveRegion="polite" testID="books-queued">
              No connection. Your changes are kept and will save when it returns.
            </Text>
          ) : null}
          {failure ? (
            <View style={styles.failure} accessibilityRole="alert">
              <Text style={styles.failureText}>{failure}</Text>
              <Pressable accessibilityRole="button" onPress={clearFailure} style={styles.dismiss} testID="books-failure-dismiss">
                <Text style={styles.dismissText}>Dismiss</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.list}>
            {live.map((b, i) => (
              <View key={b.id} style={styles.row} testID={`book-row-${b.id}`}>
                <View style={[styles.swatch, { backgroundColor: b.color }]} />
                <View style={styles.rowText}>
                  {/* Two lines: beside four 44pt controls an SE leaves a
                      30-character name about 100pt. */}
                  <Text style={styles.rowName} numberOfLines={2}>
                    {b.name}
                  </Text>
                  <Text style={styles.rowCount}>{countLabel(counts.get(b.id) ?? 0)}</Text>
                </View>
                <IconButton
                  label={`Move ${b.name} up`}
                  disabled={i === 0}
                  onPress={() => edit((all) => moveBook(all, b.id, -1))}
                  testID={`book-up-${b.id}`}
                  colors={colors}
                  icon="chevron-up"
                />
                <IconButton
                  label={`Move ${b.name} down`}
                  disabled={i === live.length - 1}
                  onPress={() => edit((all) => moveBook(all, b.id, 1))}
                  testID={`book-down-${b.id}`}
                  colors={colors}
                  icon="chevron-down"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${b.name}`}
                  onPress={() => setForm({ mode: 'edit', id: b.id })}
                  style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
                  testID={`book-edit-${b.id}`}
                >
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
              </View>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: full }}
            disabled={full}
            onPress={() => setForm({ mode: 'add' })}
            style={({ pressed }) => [styles.add, full && styles.disabled, pressed && styles.pressed]}
            testID="books-add"
          >
            <Feather name="plus" size={18} color={colors.primaryForeground} />
            <Text style={styles.addText}>Add a book</Text>
          </Pressable>
          {full ? <Text style={styles.note}>{bookLimitMessage}</Text> : null}
        </>
      )}

      <BookForm
        form={form}
        books={books}
        onClose={() => setForm(null)}
        onClosed={() => {
          const id = deleteNext.current;
          deleteNext.current = null;
          if (id) setDeleting(id);
        }}
        onDelete={(id) => {
          deleteNext.current = id;
          setForm(null);
        }}
      />
      <DeleteWindow id={deleting} count={deleting ? (counts.get(deleting) ?? 0) : 0} onClose={() => setDeleting(null)} />
    </ScrollView>
  );
}

function IconButton({ label, disabled, onPress, testID, colors, icon }: { label: string; disabled: boolean; onPress: () => void; testID: string; colors: Colors; icon: 'chevron-up' | 'chevron-down' }) {
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.icon, disabled && styles.iconDisabled, pressed && styles.pressed]}
      testID={testID}
    >
      <Feather name={icon} size={22} color={colors.foreground} />
    </Pressable>
  );
}

/** New book, or an existing one's name and colour (and the way to delete it). */
function BookForm({ form, books, onClose, onClosed, onDelete }: { form: Form | null; books: BookDef[]; onClose: () => void; onClosed: () => void; onDelete: (id: string) => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { edit } = useBooks();
  const book = form?.mode === 'edit' ? books.find((b) => b.id === form.id) ?? null : null;
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const opened = useRef<Form | null>(null);
  if (form && opened.current !== form) {
    opened.current = form;
    setName(book?.name ?? '');
    setColor(book?.color ?? nextBookColor(books));
    setProblem(null);
  }

  const save = () => {
    if (!form) return;
    const p = bookNameProblem(books, name, book?.id);
    if (p) return setProblem(p);
    const now = Date.now();
    const err =
      form.mode === 'add'
        ? edit((all) => addBook(all, { id: newEntryId(), name, color, now }))
        : edit((all) => {
            let next = all;
            if (cleanBookName(name) !== book!.name) next = renameBook(next, form.id, name);
            if (color !== book!.color) next = recolorBook(next, form.id, color);
            return next;
          });
    if (err) return setProblem(err);
    onClose();
  };

  return (
    <Window open={!!form} onClose={onClose} onClosed={onClosed} maxWidth={420} avoidKeyboard testID="book-form">
      <Text style={styles.windowHeading} accessibilityRole="header">
        {form?.mode === 'add' ? 'New book' : 'Edit book'}
      </Text>
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={(t) => {
          setName(t);
          setProblem(null);
        }}
        maxLength={BOOK_NAME_MAX}
        autoCapitalize="words"
        placeholder="Soups, Weeknight, Grandma’s…"
        placeholderTextColor={colors.faint}
        accessibilityLabel="Book name"
        testID="book-form-name"
      />
      <Text style={[styles.hint, problem ? styles.problem : null]} accessibilityLiveRegion="polite" testID="book-form-hint">
        {problem ?? `Up to ${BOOK_NAME_MAX} characters.`}
      </Text>
      <Text style={styles.fieldLabel}>Colour</Text>
      <ColorSwatches value={color} onChange={setColor} testID="book-form-colors" />
      <Pressable accessibilityRole="button" onPress={save} style={({ pressed }) => [styles.primary, pressed && styles.pressed]} testID="book-form-save">
        <Text style={styles.primaryText}>{form?.mode === 'add' ? 'Add book' : 'Save'}</Text>
      </Pressable>
      {book && book.id !== OTHER_BOOK_ID ? (
        <Pressable accessibilityRole="button" onPress={() => onDelete(book.id)} style={({ pressed }) => [styles.danger, pressed && styles.pressed]} testID="book-form-delete">
          <Text style={styles.dangerText}>Delete or merge…</Text>
        </Pressable>
      ) : book ? (
        <Text style={styles.hint}>Other can’t be deleted: it’s where recipes go when their book does.</Text>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} testID="book-form-cancel">
        <Text style={styles.secondaryText}>Cancel</Text>
      </Pressable>
    </Window>
  );
}

/** Delete — which is merge: where do its recipes go? Nothing goes until
 *  that is answered; an empty book asks only to confirm. */
function DeleteWindow({ id, count, onClose }: { id: string | null; count: number; onClose: () => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { books, live, editOnline } = useBooks();
  const book = id ? books.find((b) => b.id === id) ?? null : null;
  const [dest, setDest] = useState<string | 'new' | null>(null);
  const [rename, setRename] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opened = useRef<string | null>(null);
  if (id && opened.current !== id) {
    opened.current = id;
    setDest(null);
    setRename('');
    setNewName('');
    setNewColor(nextBookColor(books));
    setMessage(null);
  }
  if (!id && opened.current) opened.current = null;

  const others = live.filter((b) => b.id !== id);
  const target = dest && dest !== 'new' ? live.find((b) => b.id === dest) : null;

  const go = async () => {
    if (!book || busy) return;
    const now = Date.now();
    setBusy(true);
    setMessage(null);
    const msg =
      count === 0
        ? await editOnline((all) => deleteBook(all, book.id, { into: null, now }))
        : dest === 'new'
          ? await editOnline((all) => deleteIntoNewBook(all, book.id, { newId: newEntryId(), name: newName, color: newColor, now }))
          : await editOnline((all) =>
              deleteBook(all, book.id, { into: dest!, rename: cleanBookName(rename) ? rename : undefined, now })
            );
    setBusy(false);
    if (msg) setMessage(msg);
    else onClose();
  };

  const ready = count === 0 || (dest === 'new' ? !!cleanBookName(newName) : !!dest);

  return (
    <Window open={!!id} onClose={onClose} maxWidth={420} avoidKeyboard testID="book-delete">
      <Text style={styles.windowHeading} accessibilityRole="header">
        Delete {book?.name}?
      </Text>
      {count === 0 ? (
        <Text style={styles.windowBody}>It has no recipes.</Text>
      ) : (
        <>
          <Text style={styles.windowBody}>
            Where should its {count === 1 ? 'recipe' : `${count} recipes`} go?
          </Text>
          <View accessibilityRole="radiogroup" style={styles.options}>
            {others.map((b) => (
              <Option key={b.id} label={b.name} color={b.color} on={dest === b.id} onPress={() => setDest(b.id)} testID={`book-dest-${b.id}`} />
            ))}
            <Option label="A new book…" on={dest === 'new'} onPress={() => setDest('new')} testID="book-dest-new" />
          </View>
          {dest === 'new' ? (
            <>
              <Text style={styles.fieldLabel}>New book’s name</Text>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                maxLength={BOOK_NAME_MAX}
                autoCapitalize="words"
                accessibilityLabel="New book's name"
                testID="book-dest-new-name"
              />
              <ColorSwatches value={newColor} onChange={setNewColor} testID="book-dest-new-colors" />
            </>
          ) : target ? (
            <>
              <Text style={styles.fieldLabel}>Rename {target.name} (optional)</Text>
              <TextInput
                style={styles.input}
                value={rename}
                onChangeText={setRename}
                maxLength={BOOK_NAME_MAX}
                autoCapitalize="words"
                placeholder={target.name}
                placeholderTextColor={colors.faint}
                accessibilityLabel={`New name for ${target.name}, optional`}
                testID="book-dest-rename"
              />
            </>
          ) : null}
        </>
      )}
      {message ? (
        <Text style={styles.windowError} accessibilityRole="alert" testID="book-delete-message">
          {message}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready || busy }}
        disabled={!ready || busy}
        onPress={go}
        style={({ pressed }) => [styles.dangerSolid, (!ready || busy) && styles.disabled, pressed && styles.pressed]}
        testID="book-delete-confirm"
      >
        <Text style={styles.dangerSolidText}>{busy ? 'Deleting…' : count === 0 ? 'Delete book' : 'Move recipes and delete'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} testID="book-delete-cancel">
        <Text style={styles.secondaryText}>Cancel</Text>
      </Pressable>
    </Window>
  );
}

function Option({ label, color, on, onPress, testID }: { label: string; color?: string; on: boolean; onPress: () => void; testID: string }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={on}
      onPress={onPress}
      style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && styles.pressed]}
      testID={testID}
    >
      {color ? <View style={[styles.optionSwatch, { backgroundColor: color }]} /> : <Feather name="plus" size={16} color={colors.foreground} />}
      <Text style={styles.optionText} numberOfLines={1}>
        {label}
      </Text>
      {on ? <Feather name="check" size={18} color={colors.coolInk} /> : null}
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 12 },
    intro: { fontSize: 14.5, lineHeight: 21, color: colors.mutedForeground },
    note: { fontSize: 14, lineHeight: 20, color: colors.mutedForeground },
    queued: { fontSize: 13.5, lineHeight: 19, color: colors.foreground, backgroundColor: colors.muted, borderRadius: 9, padding: 10 },
    failure: { gap: 6, backgroundColor: colors.dangerBg, borderColor: colors.dangerLine, borderWidth: 1, borderRadius: 9, padding: 10 },
    failureText: { fontSize: 13.5, lineHeight: 19, color: colors.dangerInk },
    dismiss: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    dismissText: { fontSize: 14, fontWeight: '600', color: colors.dangerInk },
    list: { gap: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 60,
      paddingLeft: 12,
      paddingRight: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    swatch: { width: 22, height: 22, borderRadius: 11 },
    rowText: { flex: 1, minWidth: 0, marginLeft: 4 },
    rowName: { fontFamily: fonts.heading, fontSize: 16, color: colors.foreground },
    rowCount: { fontSize: 12.5, color: colors.mutedForeground, marginTop: 1 },
    icon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    iconDisabled: { opacity: 0.25 },
    editBtn: { minHeight: 44, minWidth: 52, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    editText: { fontSize: 15, fontWeight: '600', color: colors.coolInk },
    pressed: { opacity: 0.8 },
    disabled: { opacity: 0.45 },
    add: {
      flexDirection: 'row',
      gap: 8,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: colors.radiusButton,
      backgroundColor: colors.primary,
      marginTop: 4,
    },
    addText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 16 },
    windowHeading: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, textAlign: 'center', color: colors.foreground, marginBottom: 6 },
    windowBody: { fontSize: 15, lineHeight: 21, textAlign: 'center', color: colors.foreground, marginBottom: 10 },
    windowError: { marginTop: 10, fontSize: 14, lineHeight: 19, color: colors.dangerInk, textAlign: 'center' },
    fieldLabel: { marginTop: 12, marginBottom: 6, fontFamily: fonts.headingMedium, fontSize: 14, color: colors.foreground },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 12,
      paddingHorizontal: 12,
      fontSize: 16,
      color: colors.foreground,
      backgroundColor: colors.background,
      marginBottom: 8,
    },
    hint: { minHeight: 18, fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
    problem: { color: colors.dangerInk },
    options: { gap: 6 },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    optionOn: { borderColor: colors.coolLine, backgroundColor: colors.coolBg },
    optionSwatch: { width: 18, height: 18, borderRadius: 9 },
    optionText: { flex: 1, fontSize: 15.5, color: colors.foreground },
    primary: { marginTop: 16, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
    primaryText: { fontSize: 15, fontWeight: '600', color: colors.primaryForeground },
    secondary: {
      marginTop: 8,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    secondaryText: { fontSize: 15, fontWeight: '600', color: colors.foreground },
    danger: {
      marginTop: 8,
      minHeight: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.dangerLine,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.card,
    },
    dangerText: { fontSize: 15, fontWeight: '600', color: colors.dangerInk },
    // A fixed dark red in both themes, as the recipe screen's delete.
    dangerSolid: { marginTop: 16, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#92351b' },
    dangerSolidText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  });
}
