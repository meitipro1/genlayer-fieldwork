/**
 * Normalise a photograph before it is uploaded.
 *
 * Measured on GenLayer Studio: a JPEG whose first bytes are ffd8ffdb - valid,
 * but carrying no JFIF/APP0 header - is rejected outright by the node with
 * `NondetException {'causes': ['INVALID_IMAGE']}`, which surfaces to the worker
 * as an unexplained failure. The same photograph as a standard baseline JFIF
 * (ffd8ffe0) grades fine, at 43KB and at 520KB, so it is the container and not
 * the size that matters.
 *
 * Re-drawing through a canvas and exporting with toBlob('image/jpeg') always
 * produces a baseline JFIF, which removes that entire class of failure. It also
 * strips EXIF (including any GPS the worker did not mean to publish) and bounds
 * the upload.
 */

/** Long edge cap. 1600 keeps a handwritten six character code legible. */
export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.9;

export type Normalised = {
  blob: Blob;
  width: number;
  height: number;
  bytes: number;
  /**
   * The canvas the blob was encoded from, so a caller can measure the exact
   * pixels that will be uploaded without decoding the image a second time.
   *
   * Measuring the camera original instead would grade bytes nobody ever sees:
   * a biro stroke four pixels wide in a 12 megapixel frame is a pixel and a
   * half once this has scaled it to MAX_EDGE.
   */
  canvas: HTMLCanvasElement;
};

/**
 * Give a shipped sample photograph bytes of its own, so it can be submitted
 * more than once across the life of a contract.
 *
 * The contract records the content id of every accepted photograph and refuses
 * a repeat, which is the reuse defence working exactly as intended. But the
 * sample frame is one fixed file, so the second person ever to run the demo
 * would submit byte-identical content and be told their photograph had already
 * been used - a correct refusal that reads as a broken product.
 *
 * Stamping a patch of random colour in the far corner makes each run a
 * genuinely different photograph, which is also what reality does: two shots of
 * the same bins are never identical. A full 16px block rather than a pixel,
 * because anything smaller can be quantised away when the canvas re-encodes to
 * JPEG, and the corner rather than the centre so it can never sit near the
 * paper the code is written on.
 */
export async function uniquifySample(file: Blob): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const w = bitmap.width;
  const h = bitmap.height;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const n = 16;
  ctx.fillStyle = `rgb(${Math.floor(Math.random() * 90)},${Math.floor(
    Math.random() * 90
  )},${Math.floor(Math.random() * 90)})`;
  ctx.fillRect(0, h - n, n, n);

  const out = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  return out ?? file;
}

export async function normalisePhoto(file: Blob): Promise<Normalised> {
  const bitmap = await loadBitmap(file);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("this browser cannot process the photograph");

  // A photograph with transparency would otherwise flatten to black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);

  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );
  if (!blob) throw new Error("the photograph could not be prepared for upload");

  return { blob, width, height, bytes: blob.size, canvas };
}

async function loadBitmap(
  file: Blob
): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap applies EXIF orientation, so a portrait photo is not
  // graded sideways.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, {
        imageOrientation: "from-image",
      } as ImageBitmapOptions);
    } catch {
      // fall through to the <img> path
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("that file is not an image"));
      img.src = url;
    });
    return img;
  } finally {
    // revoked after decode; the bitmap/element already holds the pixels
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
