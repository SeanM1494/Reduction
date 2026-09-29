/**
 * components/books/BookPicker.tsx — choosing a recipe's book: from the
 * unsaved preview's Save bar (which book it will be saved into) and from a
 * saved recipe's ⋮ › Move to another book ("Move to…").
 *
 * A sheet, because it is a list of choices (CLAUDE.md: a dialog that asks
 * one thing is a Window; a list or a form is a Sheet). Every live book with
 * its colour, the current one ticked, and "Create a new book" — a name and
 * a colour, made and chosen in one tap. Making a book is an ordinary books
 * edit (lib/booksQueue.ts), so it works offline and syncs later; the choice
 * itself is the caller's: the preview keeps it until Save, a move writes it
 * through the sync engine.
 *
 * Nothing about a book choice ever reaches the extraction cache or anyone
 * else: it is this account's placement of this account's recipe.
 */

import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Sheet, SheetButton } from '@/components/Sheet';
import { ColorSwatches } from '@/components/books/ColorSwatches';
import { useBooks } from '@/lib/books-context';
import { newEntryId } from '@/lib/api';
import { BOOK_NAME_MAX, MAX_BOOKS, addBook, bookLimitMessage, bookNameProblem, cleanBookName, nextBookColor } from '@/shared/books';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export function BookPicker({
  open,
  title,
  current,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  /** The book now chosen (ticked). */
  current: string | null;
  /** A book was chosen — an existing one, or one just made here. */
  onPick: (bookId: string, name: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { books, live, edit } = useBooks();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    wasOpen.current = true;
    setCreating(false);
    setName('');
    setColor(nextBookColor(books));
    setProblem(null);
  }
  if (!open && wasOpen.current) wasOpen.current = false;

  const full = live.length >= MAX_BOOKS;

  const create = () => {
    const p = bookNameProblem(books, name);
    if (p) return setProblem(p);
    const id = newEntryId();
    const err = edit((all) => addBook(all, { id, name, color, now: Date.now() }));
    if (err) return setProblem(err);
    onPick(id, cleanBookName(name));
  };

  return (
    <Sheet open={open} title={title} onClose={onClose} closeLabel="Cancel" avoidKeyboard>
      <View accessibilityRole="radiogroup" style={styles.list} testID="book-picker">
        {live.map((b) => {
          const on = b.id === current;
          return (
            <Pressable
              key={b.id}
              accessibilityRole="radio"
              aria-checked={on}
              onPress={() => onPick(b.id, b.name)}
              style={({ pressed }) => [styles.row, on && styles.rowOn, pressed && styles.pressed]}
              testID={`book-pick-${b.id}`}
            >
              <View style={[styles.swatch, { backgroundColor: b.color }]} />
              <Text style={styles.rowText} numberOfLines={1}>
                {b.name}
              </Text>
              {on ? <Feather name="check" size={18} color={colors.coolInk} /> : null}
            </Pressable>
          );
        })}
      </View>

      {creating ? (
        <View style={styles.create} testID="book-pick-create-form">
          <Text style={styles.label}>New book’s name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(t) => {
              setName(t);
              setProblem(null);
            }}
            maxLength={BOOK_NAME_MAX}
            autoFocus
            autoCapitalize="words"
            placeholder="Soups, Weeknight, Grandma’s…"
            placeholderTextColor={colors.faint}
            accessibilityLabel="New book's name"
            testID="book-pick-new-name"
          />
          <Text style={[styles.hint, problem ? styles.problem : null]} accessibilityLiveRegion="polite" testID="book-pick-hint">
            {problem ?? `Up to ${BOOK_NAME_MAX} characters.`}
          </Text>
          <ColorSwatches value={color} onChange={setColor} testID="book-pick-colors" />
          <View style={styles.createActions}>
            <SheetButton label="Create and choose" onPress={create} testID="book-pick-create" />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: full }}
          disabled={full}
          onPress={() => setCreating(true)}
          style={({ pressed }) => [styles.row, styles.newRow, full && styles.disabled, pressed && styles.pressed]}
          testID="book-pick-new"
        >
          <Feather name="plus" size={18} color={colors.foreground} />
          <Text style={styles.rowText}>Create a new book</Text>
        </Pressable>
      )}
      {full && !creating ? <Text style={styles.hint}>{bookLimitMessage}</Text> : null}
    </Sheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    list: { gap: 6 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    rowOn: { borderColor: colors.coolLine, backgroundColor: colors.coolBg },
    newRow: { marginTop: 10, borderStyle: 'dashed', borderColor: colors.borderStrong },
    swatch: { width: 18, height: 18, borderRadius: 9 },
    rowText: { flex: 1, fontSize: 16, color: colors.foreground, fontFamily: fonts.headingMedium },
    pressed: { opacity: 0.85 },
    disabled: { opacity: 0.45 },
    create: { marginTop: 12, gap: 6 },
    label: { fontFamily: fonts.headingMedium, fontSize: 14, color: colors.foreground },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 12,
      paddingHorizontal: 12,
      fontSize: 16,
      color: colors.foreground,
      backgroundColor: colors.background,
    },
    hint: { minHeight: 18, fontSize: 13, lineHeight: 18, color: colors.mutedForeground, marginTop: 4 },
    problem: { color: colors.dangerInk },
    createActions: { marginTop: 10, flexDirection: 'row' },
  });
}
