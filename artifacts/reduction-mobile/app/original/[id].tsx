/**
 * app/original/[id].tsx — the recipe as its source worded it.
 *
 * The diagram is a rewrite; this is what to check it against: the
 * ingredient lines and steps in the source's own words, one line to a row,
 * sub-headings kept, steps numbered across them (recipe-model original.ts).
 * Only the recipe — never the post it sat in — and only for this account.
 *
 * Reached from the recipe's ⋮ menu and the "Original recipe" row under the
 * diagram. `id === "draft"` shows the unsaved preview's wording, which came
 * with the extraction and is held in LibraryContext's draft; any other id
 * is a saved recipe and asks the server (GET /api/library/:id/original).
 *
 * The source is named at the top, with a way to it, because this is its
 * words: attribution is part of showing them, not a footnote. A long
 * recipe arrives truncated and says so, pointing at the rest.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLibrary } from '@/lib/library-context';
import { loadOriginal, type OriginalResponse } from '@/lib/api';
import { originalStepNumbers, type OriginalLine, type OriginalRecipe } from '@/shared/original';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; data: OriginalResponse };

export default function OriginalRecipeScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const id = String(rawId);
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { draft, getEntry } = useLibrary();
  const isDraft = id === 'draft';
  const title = (isDraft ? draft?.recipe.title : getEntry(id)?.recipe.title) || 'Recipe';

  const [state, setState] = useState<State>(() =>
    isDraft
      ? {
          status: 'ready',
          data: {
            original: draft?.original ?? null,
            sourceUrl: draft?.recipe.sourceUrl ?? draft?.sourceUrl ?? null,
            source: draft?.recipe.source ?? null,
          },
        }
      : { status: 'loading' }
  );

  const load = useCallback(() => {
    if (isDraft) return;
    setState({ status: 'loading' });
    loadOriginal(id)
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'failed' }));
  }, [id, isDraft]);
  useEffect(load, [load]);

  return (
    <>
      <Stack.Screen options={{ title: 'Original recipe' }} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        testID="original-screen"
      >
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {state.status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        ) : state.status === 'failed' ? (
          <View style={styles.note}>
            <Text style={styles.noteText}>Could not load the original recipe.</Text>
            <OutlineButton label="Try again" onPress={load} colors={colors} testID="original-retry" />
          </View>
        ) : (
          <Body data={state.data} colors={colors} />
        )}
      </ScrollView>
    </>
  );
}

function Body({ data, colors }: { data: OriginalResponse; colors: Colors }) {
  const styles = makeStyles(colors);
  const { original, sourceUrl } = data;
  const site = data.source || hostOf(sourceUrl);
  const open = sourceUrl ? () => Linking.openURL(sourceUrl).catch(() => {}) : null;

  if (!original) {
    return (
      <View style={styles.note} testID="original-none">
        <Text style={styles.noteText}>
          The original wording wasn't kept for this recipe.
          {site ? ` It is on ${site}.` : ''}
        </Text>
        {open ? <OutlineButton label={`Open ${site} ↗`} onPress={open} colors={colors} testID="original-open" /> : null}
      </View>
    );
  }

  return (
    <View testID="original-body">
      <Attribution original={original} site={site} open={open} colors={colors} />
      {original.ingredients.length ? (
        <>
          <Text style={styles.label}>Ingredients</Text>
          <View style={styles.card}>
            {original.ingredients.map((line, i) => (
              <IngredientLine key={i} line={line} first={i === 0} colors={colors} />
            ))}
          </View>
        </>
      ) : null}
      {original.steps.length ? (
        <>
          <Text style={styles.label}>Steps</Text>
          <View style={styles.card}>
            <StepLines steps={original.steps} colors={colors} />
          </View>
        </>
      ) : null}
      {original.truncated ? (
        <View style={styles.note} testID="original-truncated">
          <Text style={styles.noteText}>
            {original.from === 'page'
              ? `This recipe is long, so it is cut short here. The rest is on ${site || 'the page it came from'}.`
              : original.from === 'photo'
                ? 'This recipe is long, so it is cut short here. The rest is in your photo.'
                : 'This recipe is long, so it is cut short here. The rest is in the text you pasted.'}
          </Text>
          {open && original.from === 'page' ? (
            <OutlineButton label={`Open ${site} ↗`} onPress={open} colors={colors} testID="original-rest" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Whose words these are, first — with the way to the page itself. */
function Attribution({
  original,
  site,
  open,
  colors,
}: {
  original: OriginalRecipe;
  site: string | null;
  open: (() => void) | null;
  colors: Colors;
}) {
  const styles = makeStyles(colors);
  if (original.from === 'page') {
    return (
      <View style={styles.attribution}>
        <Text style={styles.attributionText}>
          As written on <Text style={styles.attributionSite}>{site || 'the source page'}</Text>. The diagram is our reading of it.
        </Text>
        {open ? <OutlineButton label={`Open ${site || 'the page'} ↗`} onPress={open} colors={colors} testID="original-open" /> : null}
      </View>
    );
  }
  return (
    <View style={styles.attribution}>
      <Text style={styles.attributionText}>
        {original.from === 'photo' ? 'As read from your photo.' : 'As you pasted it.'} The diagram is our reading of it.
      </Text>
    </View>
  );
}

function IngredientLine({ line, first, colors }: { line: OriginalLine; first: boolean; colors: Colors }) {
  const styles = makeStyles(colors);
  if (line.heading)
    return (
      <Text style={[styles.subheading, first && { marginTop: 0 }]} accessibilityRole="header" selectable>
        {line.text}
      </Text>
    );
  return (
    <View style={styles.row}>
      <Text style={styles.bullet}>•</Text>
      <Text style={styles.lineText} selectable>
        {line.text}
      </Text>
    </View>
  );
}

function StepLines({ steps, colors }: { steps: OriginalLine[]; colors: Colors }) {
  const styles = makeStyles(colors);
  const numbers = originalStepNumbers(steps);
  return (
    <>
      {steps.map((line, i) =>
        line.heading ? (
          <Text key={i} style={[styles.subheading, i === 0 && { marginTop: 0 }]} accessibilityRole="header" selectable>
            {line.text}
          </Text>
        ) : (
          <View key={i} style={[styles.row, styles.stepRow]}>
            <Text style={styles.stepNumber}>{numbers[i]}</Text>
            <Text style={styles.lineText} selectable>
              {line.text}
            </Text>
          </View>
        )
      )}
    </>
  );
}

function OutlineButton({ label, onPress, colors, testID }: { label: string; onPress: () => void; colors: Colors; testID?: string }) {
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      testID={testID}
    >
      <Text style={styles.buttonText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, gap: 4 },
    center: { paddingVertical: 48, alignItems: 'center' },
    title: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 30, color: colors.foreground, marginBottom: 8 },
    attribution: { gap: 10, marginBottom: 12 },
    attributionText: { fontSize: 15, lineHeight: 22, color: colors.mutedForeground },
    attributionSite: { fontFamily: fonts.headingMedium, color: colors.foreground },
    // The meta label in the app's mono, as in Settings.
    label: {
      fontFamily: fonts.mono,
      fontSize: 12,
      letterSpacing: 0.48,
      color: colors.faint,
      textTransform: 'uppercase',
      marginTop: 16,
      marginBottom: 8,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 14,
      paddingHorizontal: 16,
      gap: 10,
      ...cardShadow,
    },
    subheading: { fontFamily: fonts.heading, fontSize: 16, color: colors.foreground, marginTop: 8 },
    row: { flexDirection: 'row', gap: 10 },
    stepRow: { gap: 12 },
    bullet: { fontSize: 17, lineHeight: 25, color: colors.faint, width: 10 },
    stepNumber: { fontFamily: fonts.mono, fontSize: 15, lineHeight: 25, color: colors.coolInk, minWidth: 22, textAlign: 'right' },
    // Read at arm's length across a counter: body size, generous leading.
    lineText: { flex: 1, fontSize: 17, lineHeight: 25, color: colors.foreground },
    // Information, not a warning: nothing is wrong when a long recipe is
    // cut short, so no warm (alarm) colour.
    note: {
      marginTop: 16,
      gap: 12,
      padding: 16,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
    },
    noteText: { fontSize: 15, lineHeight: 22, color: colors.foreground },
    button: {
      minHeight: 44,
      alignSelf: 'flex-start',
      justifyContent: 'center',
      paddingHorizontal: 16,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      maxWidth: '100%',
    },
    buttonPressed: { borderColor: colors.borderStrong, backgroundColor: colors.muted },
    buttonText: { fontFamily: fonts.headingMedium, fontSize: 15, color: colors.foreground },
  });
}
