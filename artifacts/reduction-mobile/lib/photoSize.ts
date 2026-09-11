/**
 * lib/photoSize.ts — how big a photo may be before it is sent.
 *
 * PURE (no react-native, no expo), so photoSize.test.ts runs under node.
 *
 * The extraction route accepts an 8 MB file and hands the image straight to
 * the model, which refuses anything over 5 MB or 8000px on a side and
 * downscales anything whose long edge is over 1568px anyway. A phone camera
 * produces 12–24 megapixel JPEGs, so the phone shrinks before it uploads:
 * the long edge to LONG_EDGE_PX, JPEG at JPEG_QUALITY. That is both the
 * model's sweet spot and a 6–10x smaller upload on a kitchen's wifi.
 */

export const LONG_EDGE_PX = 1568;
export const JPEG_QUALITY = 0.8;
/** The model's own bound, which the server's 8 MB check sits above. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** The size to resize to, or null when the photo is already small enough.
 *  Only one dimension is given so the aspect ratio is the resizer's. */
export function fitLongEdge(width: number, height: number, max = LONG_EDGE_PX): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (width <= max && height <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

/** Bytes a base64 string decodes to, without decoding it. */
export function base64Bytes(b64: string): number {
  const clean = b64.replace(/^data:[^;]+;base64,/, '');
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
