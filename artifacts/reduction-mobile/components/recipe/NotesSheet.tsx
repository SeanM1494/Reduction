/**
 * The person's own notes — on the recipe ("less salt, double the garlic",
 * user feedback item 1, Oct 2) or on one step ("cast iron, 4 min a side",
 * the same evening). One free-text box in a Sheet; the caller says which
 * note it is and how to store it.
 *
 * Saved when the sheet closes, never per keystroke: every keystroke would be
 * a versioned PATCH, and a sheet is closed by Done, the scrim or the back
 * gesture alike, all of which come through `onClose`. The caller stores the
 * text through `cleanNotes`/`withStepNote`, so a box emptied out clears the
 * note rather than storing "", and the OTHER notes ride along untouched.
 * Entry-level, never the tree (recipe-model notes.ts says why).
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Sheet } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { cleanNoteText } from '@/shared/notes';

export function NotesSheet({
  open,
  title,
  context,
  value,
  maxLength,
  placeholder,
  accessibilityLabel,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  /** A line above the box saying what the note is on, when the title
   *  cannot (a step's label can be a sentence long). */
  context?: string;
  /** The stored note this box edits, or "". */
  value: string;
  maxLength: number;
  placeholder: string;
  accessibilityLabel: string;
  /** Called on close, only when the cleaned text differs from `value`. */
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [draft, setDraft] = useState(value);
  // Each opening starts from the stored note — another device may have
  // changed it since the last time this sheet was up.
  useEffect(() => {
    if (open) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title]);

  const close = () => {
    if (cleanNoteText(draft) !== cleanNoteText(value)) onSave(draft);
    onClose();
  };

  return (
    <Sheet open={open} title={title} onClose={close} avoidKeyboard>
      {context ? (
        <Text style={styles.context} numberOfLines={2}>
          {context}
        </Text>
      ) : null}
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        multiline
        autoFocus={!value}
        maxLength={maxLength}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        textAlignVertical="top"
        accessibilityLabel={accessibilityLabel}
        testID="notes-input"
      />
      <View style={styles.meta}>
        <Text style={styles.metaText}>Only you see your notes.</Text>
        {draft.length > maxLength * 0.8 ? (
          <Text style={styles.metaText}>
            {draft.length} / {maxLength}
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
    context: { fontSize: 14, lineHeight: 19, color: colors.mutedForeground, marginBottom: 8 },
    meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, gap: 12 },
    metaText: { fontFamily: fonts.mono, fontSize: 11, color: colors.faint },
  });
}
