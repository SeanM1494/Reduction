/**
 * components/settings/AccountId.tsx — your account id, copyable.
 *
 * The web's AccountId ported, and its reasoning holds here more, not less:
 * `users.id` is a v4 UUID — 36 characters, not memorable, and not something
 * anyone will read down a phone. "Support asked for my account id" is a
 * copy-and-paste job, and a button removes the only real difficulty: a
 * one-character transcription error, invisible until the lookup fails.
 *
 * The id is always rendered as selectable text and the button is an
 * accelerator rather than the only way to get at it. The clipboard is
 * expo-clipboard, a native module: a development build made before it was
 * added does not have it, and requiring it then throws. So it is required
 * lazily inside the tap, and a build without it falls back to the share
 * sheet — which on iOS carries "Copy" as its first action — rather than
 * crashing Settings. The next EAS build picks the module up.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

type Clipboard = { setStringAsync: (s: string) => Promise<boolean> };

function loadClipboard(): Clipboard | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-clipboard') as Clipboard;
  } catch {
    return null;
  }
}

export function AccountId({ id }: { id: string }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(async () => {
    const clipboard = loadClipboard();
    if (clipboard) {
      try {
        await clipboard.setStringAsync(id);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        // Reverts rather than latching: a button that says "Copied" for ever
        // stops telling you whether the NEXT tap worked.
        timer.current = setTimeout(() => setCopied(false), 1600);
        return;
      } catch {
        // Fall through to the share sheet.
      }
    }
    await Share.share({ message: id }).catch(() => {});
  }, [id]);

  return (
    <View style={styles.wrap} testID="account-id">
      <Text style={styles.label}>ACCOUNT ID</Text>
      <View style={styles.row}>
        <Text style={styles.value} selectable numberOfLines={2} testID="account-id-value">
          {id}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy account ID"
          onPress={copy}
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
          testID="account-id-copy"
        >
          <Text style={styles.btnText}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    wrap: { marginTop: 10, gap: 4 },
    label: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.44, color: colors.faint },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    // .rd-accountid-value: mono, small, wraps to two lines on a 320 phone.
    value: { flex: 1, fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 16, color: colors.mutedForeground },
    // .rd-btn, at the 44px floor.
    btn: {
      minHeight: 44,
      minWidth: 64,
      paddingHorizontal: 13,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
    },
    btnPressed: { borderColor: colors.borderStrong },
    btnText: { fontSize: 13, color: colors.foreground, fontFamily: fonts.headingMedium },
  });
}
