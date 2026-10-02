/**
 * The person's own notes on a recipe — "less salt, double the garlic" (user
 * feedback item 1, Oct 2). One free-text box in a Sheet, opened from ⋮ ›
 * Notes, from the strip at the top of the diagram, and from the notes row
 * under it.
 *
 * Saved when the sheet closes, never per keystroke: every keystroke would be
 * a versioned PATCH, and a sheet is closed by Done, the scrim or the back
 * gesture alike, all of which come through `onClose`. The text goes through
 * `cleanNotes`, so a box emptied out clears the note rather than storing "".
 * Entry-level, never the tree (recipe-model notes.ts says why).
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { NOTE_MAX, cleanNotes, notesText, type RecipeNotes } from '@/shared/notes';

export function NotesSheet({
  open,
  notes,
  onSave,
  onClose,
}: {
  open: boolean;
  notes: RecipeNotes | null;
  /** Called on close, only when the cleaned text differs from `notes`. */
  onSave: (next: RecipeNotes | null) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [draft, setDraft] = useState(notesText(notes));
  // Each opening starts from the stored note — another device may have
  // changed it since the last time this sheet was up.
  useEffect(() => {
    if (open) setDraft(notesText(notes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    const next = cleanNotes(draft);
    if (notesText(next) !== notesText(notes)) onSave(next);
    onClose();
  };

  return (
    <Sheet open={open} title="Notes" onClose={close} avoidKeyboard>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        multiline
        autoFocus={!notesText(notes)}
        maxLength={NOTE_MAX}
        placeholder="Your changes and reminders: less salt, a swap, how long it really took…"
        placeholderTextColor={colors.faint}
        textAlignVertical="top"
        accessibilityLabel="Your notes on this recipe"
        testID="notes-input"
      />
      <View style={styles.meta}>
        <Text style={styles.metaText}>Only you see your notes.</Text>
        {draft.length > NOTE_MAX * 0.8 ? (
          <Text style={styles.metaText}>
            {draft.length} / {NOTE_MAX}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    // The editor's field (EditSheet's input): 16px is the input floor.
    input: {
      minHeight: 140,
      maxHeight: 260,
      fontSize: 16,
      lineHeight: 22,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.background,
      color: colors.foreground,
    },
    meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, gap: 12 },
    metaText: { fontFamily: fonts.mono, fontSize: 11, color: colors.faint },
  });
}
