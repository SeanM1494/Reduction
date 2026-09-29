/**
 * components/find/NameFields.tsx — the two optional fields beside a pasted
 * recipe or a photo: Title and From.
 *
 * A pasted recipe or a photographed card often has no title the model can
 * find, and never a source; these are the person's to give. Both are
 * applied on the phone to whatever the extraction returned
 * (`withUserFields`, recipe-model title.ts) — a fresh read and a cache hit
 * alike — so a typed title always wins and neither ever reaches the cache.
 * Blank leaves the extraction's own title in place. "From" fills the
 * recipe's source, which the Source sort and search already read.
 *
 * Not for a link: a page names itself, and its site is its source.
 */

import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { FROM_MAX, TITLE_MAX } from '@/shared/title';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export interface NameValues {
  title: string;
  from: string;
}

export const EMPTY_NAMES: NameValues = { title: '', from: '' };

export function NameFields({
  value,
  onChange,
  disabled,
  testID = 'names',
}: {
  value: NameValues;
  onChange: (next: NameValues) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.field}>
        <Text style={styles.label}>
          Title <Text style={styles.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={value.title}
          onChangeText={(title) => onChange({ ...value, title })}
          maxLength={TITLE_MAX}
          editable={!disabled}
          placeholder="Leave blank to use the recipe's own"
          placeholderTextColor={colors.faint}
          autoCapitalize="sentences"
          returnKeyType="next"
          accessibilityLabel="Title, optional"
          testID={`${testID}-title`}
        />
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>
          From <Text style={styles.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={styles.input}
          value={value.from}
          onChangeText={(from) => onChange({ ...value, from })}
          maxLength={FROM_MAX}
          editable={!disabled}
          placeholder="Grandma's card, a cookbook…"
          placeholderTextColor={colors.faint}
          autoCapitalize="sentences"
          returnKeyType="done"
          accessibilityLabel="From, optional: who or where the recipe came from"
          testID={`${testID}-from`}
        />
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { gap: 10 },
    field: { gap: 4 },
    label: { fontFamily: fonts.headingMedium, fontSize: 14, color: colors.foreground },
    optional: { fontFamily: fonts.headingMedium, color: colors.mutedForeground },
    // 16px: the input floor (CLAUDE.md). 44pt: the target floor.
    input: {
      minHeight: 44,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 16,
      color: colors.foreground,
      backgroundColor: colors.card,
    },
  });
}
