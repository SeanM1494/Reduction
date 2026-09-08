/**
 * lib/secure-storage.ts — token storage that also works in the web preview.
 *
 * expo-secure-store's web shim does not implement getValueWithKeyAsync in
 * this SDK version, so the Replit preview (which renders the app via
 * react-native-web) crashes on load. Native iOS/Android keep using the real
 * Keychain/Keystore-backed SecureStore; only the web platform falls back to
 * AsyncStorage, which is an acceptable trade for a browser tab (there is no
 * OS-level secure enclave to fall back to anyway).
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
  return SecureStore.setItemAsync(key, value);
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (Platform.OS === 'web') return AsyncStorage.removeItem(key);
  return SecureStore.deleteItemAsync(key);
}
