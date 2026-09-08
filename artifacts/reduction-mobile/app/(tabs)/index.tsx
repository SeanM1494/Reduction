/**
 * app/(tabs)/index.tsx — Find: paste a URL or text, extract a recipe.
 *
 * Gated by entitlement before the request is even attempted, same reasoning
 * as the web app's Paywall (see components/Paywall.tsx) — a search someone
 * cannot use costs their attention and our extraction budget for nothing.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import { extractFromUrl, extractFromText, ApiError } from '@/lib/api';
import { Paywall } from '@/components/Paywall';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export default function FindScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { entitlement, refresh } = useAuth();
  const { setDraft } = useLibrary();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = entitlement !== null && !entitlement.allowed;

  const looksLikeUrl = /^https?:\/\//i.test(input.trim());

  const submit = async () => {
    const value = input.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = looksLikeUrl ? await extractFromUrl(value) : await extractFromText(value);
      setDraft({ recipe: result.recipe, sourceUrl: looksLikeUrl ? value : null });
      setInput('');
      await refresh();
      router.push('/recipe/draft');
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 402 || err.code === 'trial_spent') {
        await refresh();
      } else {
        setError(err.message || 'Could not extract that recipe.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Add a recipe</Text>
      <Text style={styles.hint}>Paste a link, or paste the recipe text itself.</Text>

      {blocked ? (
        <Paywall context="extract" />
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder="https://example.com/recipe or paste recipe text"
            placeholderTextColor={colors.faint}
            value={input}
            onChangeText={setInput}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, (!input.trim() || busy) && styles.buttonDisabled]}
            onPress={submit}
            disabled={!input.trim() || busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.buttonText}>{looksLikeUrl ? 'Extract from link' : 'Extract recipe'}</Text>
            )}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 14 },
    heading: { fontFamily: fonts.headingBold, fontSize: 26, color: colors.foreground },
    hint: { fontSize: 14, color: colors.mutedForeground, marginBottom: 8 },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      padding: 14,
      fontSize: 15,
      color: colors.foreground,
      minHeight: 110,
      textAlignVertical: 'top',
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: 'center',
    },
    buttonDisabled: { opacity: 0.5 },
    buttonText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 16 },
    error: {
      color: colors.destructiveForeground,
      backgroundColor: colors.destructive,
      padding: 10,
      borderRadius: colors.radius,
      fontSize: 13,
    },
  });
}
