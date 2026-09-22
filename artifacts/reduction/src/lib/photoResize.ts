/**
 * client/src/lib/photoResize.ts — shrink a picked image file on a canvas to
 * the size the server stores (long edge 1024, JPEG at 0.8), the web twin of
 * the mobile app's lib/photo.ts. The server re-encodes regardless; this is
 * what keeps a 12MB camera file from crossing the wire.
 */

export const PHOTO_LONG_EDGE = 1024;
export const PHOTO_JPEG_QUALITY = 0.8;

export interface ResizedPhoto {
  /** Base64, no data: prefix. */
  base64: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not an image this browser can read."));
    };
    img.src = url;
  });
}

export async function resizePhoto(file: File): Promise<ResizedPhoto> {
  const img = await loadImage(file);
  const scale = Math.min(1, PHOTO_LONG_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not prepare the photo.");
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL("image/jpeg", PHOTO_JPEG_QUALITY);
  return { base64: dataUrl.replace(/^data:[^;]+;base64,/, ""), mediaType: "image/jpeg", width, height };
}
