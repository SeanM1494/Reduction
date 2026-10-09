/**
 * components/TitleWindow.tsx — naming a recipe: "Rename" in a saved
 * recipe's ⋮ menu, and the title in an unsaved preview. A centered window,
 * because it asks something (CLAUDE.md, "A dialog that asks something is a
 * centered WINDOW").
 *
 * The rule is recipe-model `title.ts`, the same one the editor's Title field
 * and the Add New fields use: trimmed, whitespace runs collapsed, never
 * empty, at most TITLE_MAX. The field cannot take more than that, so the
 * only refusal anyone meets is the empty one — and it takes no space, like
 * every field error (it replaces the hint line rather than pushing Save).
 *
 * What the caller does with the title is the caller's: a saved recipe writes
 * it through the sync engine (offline-safe), a preview keeps it in the
 * draft. Neither reaches the extraction cache.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { Window } from '@/components/Window';
import { TITLE_MAX, cleanTitle, titleProblem } from '@/shared/title';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

interface Props {
  open: boolean;
  /** The title as it stands, filled into the field on each open. */
  title: string;
  heading?: string;
  onSave: (title: string) => void;
  onClose: () => void;
}

export function TitleWindow({ open, title, heading = 'Rename recipe', onSave, onClose }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [value, setValue] = useState(title);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValue(title);
    setTried(false);
    // Fill on OPEN only: a sync landing while the window is up must not
    // overwrite what the person is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const problem = titleProblem(value);
  const save = () => {
    setTried(true);
    if (problem) return;
    const next = cleanTitle(value);
    if (next !== title) onSave(next);
    onClose();
  };

  return (
    <Window open={open} onClose={onClose} maxWidth={400} avoidKeyboard testID="title-window">
      <Text style={styles.heading} accessibilityRole="header">
        {heading}
      </Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={setValue}
        onSubmitEditing={save}
        maxLength={TITLE_MAX}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        autoCapitalize="sentences"
        placeholder="Recipe title"
        placeholderTextColor={colors.faint}
        accessibilityLabel="Recipe title"
        testID="title-input"
      />
      <Text
        style={[styles.hint, tried && problem ? styles.problem : null]}
        accessibilityLiveRegion="polite"
        testID="title-hint"
      >
        {tried && problem ? problem : 'Only your copy changes.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={save}
        style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
        testID="title-save"
      >
        <Text style={styles.primaryText}>Save</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [styles.secondary, pressed && { borderColor: colors.borderStrong }]}
        testID="title-cancel"
      >
        <Text style={styles.secondaryText}>Cancel</Text>
      </Pressable>
    </Window>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    heading: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 25, textAlign: 'center', color: colors.foreground },
    // 16px: the input floor (CLAUDE.md).
    input: {
      marginTop: 16,
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.foreground,
      backgroundColor: colors.background,
    },
    // One line, always there: the refusal replaces it rather than being
    // inserted, so nothing under a finger moves.
    hint: { marginTop: 6, minHeight: 18, fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
    problem: { color: colors.dangerInk },
    primary: { marginTop: 12, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
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
  });
}
