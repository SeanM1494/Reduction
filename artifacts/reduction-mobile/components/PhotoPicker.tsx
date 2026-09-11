/**
 * components/PhotoPicker.tsx — the Find tab's third way in: a photo of a
 * cookbook page or a handwritten card.
 *
 * Two 44px buttons (camera, library), a preview of what was picked with its
 * shrunk dimensions and size, and the extract button. Failures are
 * sentences with a way forward — see lib/photo.ts for the three remedies.
 */

import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SheetButton } from '@/components/Sheet';
import { openSettings, PhotoError, takePhoto, type PhotoSource, type PreparedPhoto } from '@/lib/photo';
import { formatBytes } from '@/lib/photoSize';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

interface Props {
  photo: PreparedPhoto | null;
  onPhoto: (photo: PreparedPhoto | null) => void;
  onExtract: () => void;
  busy: boolean;
}

export function PhotoPicker({ photo, onPhoto, onExtract, busy }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [picking, setPicking] = useState<PhotoSource | null>(null);
  const [problem, setProblem] = useState<PhotoError | null>(null);

  const choose = async (source: PhotoSource) => {
    if (picking || busy) return;
    setPicking(source);
    setProblem(null);
    try {
      const next = await takePhoto(source);
      if (next) onPhoto(next);
    } catch (e) {
      setProblem(e instanceof PhotoError ? e : new PhotoError((e as Error).message || 'Could not read that photo.'));
    } finally {
      setPicking(null);
    }
  };

  return (
    <View style={styles.wrap} testID="photo-picker">
      <Text style={styles.label}>Or photograph a page</Text>
      <Text style={styles.note}>A photo of a cookbook page or a handwritten card works. No typing needed.</Text>

      {photo ? (
        <View style={styles.preview} testID="photo-preview">
          <Image source={{ uri: photo.uri }} style={styles.thumb} resizeMode="cover" accessibilityLabel="The photo you chose" />
          <View style={styles.previewText}>
            <Text style={styles.previewMeta} testID="photo-meta">
              {photo.width}×{photo.height} · {formatBytes(photo.bytes)}
            </Text>
            <Pressable accessibilityRole="button" onPress={() => onPhoto(null)} disabled={busy} style={styles.remove} testID="photo-remove">
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.row}>
        <SourceButton icon="camera" label={picking === 'camera' ? 'Opening…' : 'Take a photo'} onPress={() => choose('camera')} disabled={!!picking || busy} colors={colors} testID="photo-camera" />
        <SourceButton icon="image" label={picking === 'library' ? 'Opening…' : 'Choose a photo'} onPress={() => choose('library')} disabled={!!picking || busy} colors={colors} testID="photo-library" />
      </View>

      {problem ? (
        <View style={styles.problem} accessibilityRole="alert" testID="photo-problem">
          <Text style={styles.problemText}>{problem.message}</Text>
          {problem.remedy === 'settings' ? <SheetButton label="Open Settings" onPress={openSettings} testID="photo-open-settings" /> : null}
          {problem.remedy === 'library' ? <SheetButton label="Choose a photo" onPress={() => choose('library')} /> : null}
        </View>
      ) : null}

      {photo ? (
        <Pressable
          accessibilityRole="button"
          style={[styles.extract, busy && styles.extractDisabled]}
          onPress={onExtract}
          disabled={busy}
          testID="photo-extract"
        >
          {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={styles.extractText}>Extract from photo</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

function SourceButton({
  icon,
  label,
  onPress,
  disabled,
  colors,
  testID,
}: {
  icon: 'camera' | 'image';
  label: string;
  onPress: () => void;
  disabled: boolean;
  colors: Colors;
  testID: string;
}) {
  const styles = makeStyles(colors);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.source, pressed && styles.sourcePressed, disabled && styles.sourceDisabled]} testID={testID}>
      <Feather name={icon} size={18} color={colors.foreground} />
      <Text style={styles.sourceText}>{label}</Text>
    </Pressable>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { gap: 10, marginTop: 8, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border },
    label: { fontFamily: fonts.heading, fontSize: 16, color: colors.foreground },
    note: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
    row: { flexDirection: 'row', gap: 10 },
    source: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      minHeight: 48,
      paddingHorizontal: 12,
      borderRadius: colors.radiusButton,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    sourcePressed: { backgroundColor: colors.muted },
    sourceDisabled: { opacity: 0.5 },
    sourceText: { fontFamily: fonts.headingMedium, fontSize: 15, color: colors.foreground },
    preview: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 10,
      borderRadius: colors.radiusCard,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      ...cardShadow,
    },
    thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: colors.muted },
    previewText: { flex: 1, gap: 6 },
    previewMeta: { fontFamily: fonts.mono, fontSize: 12, color: colors.mutedForeground },
    remove: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    removeText: { fontSize: 14, color: colors.coolInk, textDecorationLine: 'underline' },
    problem: {
      gap: 10,
      padding: 12,
      borderRadius: 9,
      backgroundColor: colors.dangerBg,
      borderWidth: 1,
      borderColor: colors.dangerLine,
    },
    problemText: { fontSize: 13.5, lineHeight: 19, color: colors.dangerInk },
    extract: { backgroundColor: colors.primary, borderRadius: colors.radiusButton, minHeight: 48, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
    extractDisabled: { opacity: 0.5 },
    extractText: { color: colors.primaryForeground, fontFamily: fonts.headingMedium, fontSize: 16 },
  });
}
