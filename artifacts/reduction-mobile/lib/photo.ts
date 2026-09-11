/**
 * lib/photo.ts — getting a photo of a recipe page from the phone to the
 * extraction route.
 *
 * Two sources (camera, library), one preparation: the picked image is shrunk
 * to the model's sweet spot and re-encoded as JPEG with base64 attached
 * (lib/photoSize.ts has the numbers and why), then posted as
 * `{ file: { data, mediaType } }` — the exact body the web's photo upload
 * sends, so the server needed nothing.
 *
 * PERMISSIONS ARE ASKED FOR AT THE TAP, never at boot, and a refusal is a
 * sentence with a way forward: "Open Settings" when the OS will no longer
 * ask (iOS asks exactly once). The purpose strings the OS shows live in
 * app.json under the expo-image-picker plugin; Expo Go shows its own generic
 * ones, so the real wording is only seen in a development or store build.
 */

import { Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { base64Bytes, fitLongEdge, JPEG_QUALITY, MAX_UPLOAD_BYTES } from './photoSize';

export type PhotoSource = 'camera' | 'library';

export interface PreparedPhoto {
  /** Base64 JPEG, no data: prefix — what the route wants. */
  base64: string;
  mediaType: 'image/jpeg';
  /** A local uri for the preview. */
  uri: string;
  width: number;
  height: number;
  bytes: number;
}

export class PhotoError extends Error {
  constructor(
    message: string,
    /** What the user can do about it: nothing, open Settings, or use the
     *  other source (no camera on this device). */
    public readonly remedy: 'none' | 'settings' | 'library' = 'none'
  ) {
    super(message);
  }
}

/** Opens the app's own page in Settings, where a refused permission lives. */
export const openSettings = () => Linking.openSettings().catch(() => {});

async function ensurePermission(source: PhotoSource): Promise<void> {
  // The web picker is a file input: the browser asks, not us.
  if (Platform.OS === 'web') return;
  const ask =
    source === 'camera' ? ImagePicker.requestCameraPermissionsAsync : ImagePicker.requestMediaLibraryPermissionsAsync;
  const res = await ask();
  if (res.granted) return;
  // iOS 14+ "limited" library access still lets the picker show what the
  // user chose to share, which is enough.
  if (source === 'library' && (res as ImagePicker.MediaLibraryPermissionResponse).accessPrivileges === 'limited') return;
  const what = source === 'camera' ? 'the camera' : 'your photos';
  if (res.canAskAgain) throw new PhotoError(`Reduction needs ${what} to read a recipe page. Allow it and try again.`, 'none');
  throw new PhotoError(`Access to ${what} is turned off for Reduction. You can turn it on in Settings.`, 'settings');
}

/** Picks from the chosen source. Null when the user backed out. */
async function pick(source: PhotoSource): Promise<ImagePicker.ImagePickerAsset | null> {
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // Full quality here; the shrink below is the compression that matters.
    quality: 1,
    exif: false,
  };
  let result: ImagePicker.ImagePickerResult;
  try {
    result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  } catch (e) {
    if (source === 'camera') {
      // A simulator, or a device with no camera: not a refusal, a fact.
      throw new PhotoError('There is no camera on this device. Choose a photo instead.', 'library');
    }
    throw new PhotoError((e as Error).message || 'Could not open your photos.', 'none');
  }
  if (result.canceled || !result.assets?.length) return null;
  return result.assets[0];
}

/** The whole path: permission, pick, shrink, encode, bound. */
export async function takePhoto(source: PhotoSource): Promise<PreparedPhoto | null> {
  await ensurePermission(source);
  const asset = await pick(source);
  if (!asset) return null;
  const resize = fitLongEdge(asset.width, asset.height);
  const out = await manipulateAsync(asset.uri, resize ? [{ resize }] : [], {
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) throw new PhotoError('Could not read that photo.', 'none');
  const bytes = base64Bytes(out.base64);
  // Unreachable for a photograph at 1568px, kept so a pathological image
  // fails here with a sentence rather than at the model with a 500.
  if (bytes > MAX_UPLOAD_BYTES) throw new PhotoError('That photo is too large to send, even shrunk. Try a smaller one.', 'none');
  return { base64: out.base64, mediaType: 'image/jpeg', uri: out.uri, width: out.width, height: out.height, bytes };
}
