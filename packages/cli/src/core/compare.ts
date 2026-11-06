import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

/** A decoded 8-bit RGB image. */
export interface RawImage {
  /** Interleaved R, G, B bytes, row by row, three bytes per pixel and no alpha. */
  data: Buffer;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/**
 * `psnr` is in dB over RGB 0–255, and `null` when the images are identical (infinite PSNR). `sharpness` is the
 * gradient energy of the test image relative to the reference: 1 is equally sharp, below 1 is blurrier (for example
 * temporal accumulation) and above 1 has extra edges (aliasing or noise). It is `null` when the reference is flat.
 */
export interface ImageMetrics {
  /** Peak signal-to-noise ratio in dB, or `null` when the images are identical. */
  psnr: number | null;
  /** Gradient energy of the test image relative to the reference, or `null` when the reference is flat. */
  sharpness?: number | null;
}

/** Sharp AVIF options for committed result images: near-lossless (worst render ~40 dB PSNR vs PNG), full-res chroma so noise and false colour survive. */
export const RESULT_AVIF = {
  /** AVIF quality, 0 to 100. */
  quality: 90,
  /** Chroma subsampling mode; `4:4:4` keeps full-resolution colour. */
  chromaSubsampling: '4:4:4',
} as const;

/** Sharp WebP options for delta heatmaps. They trade minor visual differences for smaller files at modest encoding cost. */
export const DELTA_WEBP = {
  /** WebP quality, 0 to 100. */
  quality: 85,
  /** Encoder effort, 0 (fastest) to 6 (smallest). */
  effort: 4,
} as const;

/** Result of {@link compareRgb}. */
export interface RgbComparison {
  /** Quality metrics of the test image. */
  metrics: ImageMetrics;
  /** Heat-map of per-pixel error; black pixels are identical. */
  delta: RawImage;
}

/** Result of {@link measureImages}. */
export interface ImageMeasurement {
  /** Quality metrics of the test image. */
  metrics: ImageMetrics;
  /** Width of the compared images in pixels. */
  width: number;
  /** Height of the compared images in pixels. */
  height: number;
}

/** Result of {@link compareImages}. */
export interface ImageComparison extends ImageMeasurement {
  /** The delta heat-map encoded as WebP. */
  deltaImage: Buffer;
}

/**
 * Decodes an image to 8-bit sRGB, dropping alpha.
 *
 * @param input - A file path or an encoded image buffer (AVIF, WebP, PNG or JPEG).
 * @returns The decoded pixels and dimensions.
 */
export async function readRgb(input: string | Buffer): Promise<RawImage> {
  // Decode an in-memory snapshot so libvips cannot retain a Windows file lock
  // after processing, or reuse cached pixels after the source is replaced.
  const encoded = typeof input === 'string' ? await readFile(input) : input;
  const { data, info } = await sharp(encoded)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

// Inferno colormap, polynomial fit by Matt Zucker (CC0). inferno(0) clamps to black.
const INFERNO = [
  [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
  [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
  [11.60249308247187, -3.972853965665698, -15.9423941062914],
  [-41.70399613139459, 17.43639888205313, 44.35414519872813],
  [77.162935699427, -33.40235894210092, -81.80730925738993],
  [-71.31942824499214, 32.62606426397723, 73.20951985803202],
  [25.13112622477341, -12.24266895238567, -23.07032500287172],
] as const;

function inferno(t: number): [number, number, number] {
  const rgb: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    let v = 0;
    for (let i = INFERNO.length - 1; i >= 0; i -= 1) v = v * t + INFERNO[i]![c]!;
    rgb[c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return rgb;
}

// Max-channel error e (0–255) → t = min(1, 2·sqrt(e/255)): 1/255 error is already visible, ≥25% error saturates.
const DELTA_LUT = Array.from({ length: 256 }, (_, e) => inferno(Math.min(1, 2 * Math.sqrt(e / 255))));

/**
 * Sum of absolute horizontal and vertical neighbour differences over all RGB channels.
 *
 * @param image - The decoded image to measure.
 * @returns The total gradient energy; larger means more edges and detail.
 */
export function gradientEnergy(image: RawImage): number {
  const { data, width, height } = image;
  const row = width * 3;
  let sum = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const p = y * row + x * 3;
      for (let c = 0; c < 3; c += 1) {
        const v = data[p + c]!;
        if (x > 0) sum += Math.abs(v - data[p - 3 + c]!);
        if (y > 0) sum += Math.abs(v - data[p - row + c]!);
      }
    }
  return sum;
}

/**
 * Gradient energy of `test` relative to `reference`; see {@link ImageMetrics.sharpness}.
 *
 * @param reference - The reference image.
 * @param test - The image to judge against it.
 * @returns The ratio, or `null` when the reference has no gradient.
 */
export function sharpnessRatio(reference: RawImage, test: RawImage): number | null {
  const ref = gradientEnergy(reference);
  return ref === 0 ? null : gradientEnergy(test) / ref;
}

/**
 * Computes metrics and an RGB heat-map delta image (black = identical) from two equal-size RGB images.
 *
 * @param reference - The reference image.
 * @param test - The image to compare; it must have the same dimensions.
 * @returns The metrics and the delta image, whose colour follows the largest channel error of each pixel.
 * @throws If the image dimensions differ.
 */
export function compareRgb(reference: RawImage, test: RawImage): RgbComparison {
  if (reference.width !== test.width || reference.height !== test.height) {
    throw new Error(
      `Image size mismatch: reference ${reference.width}x${reference.height} vs test ${test.width}x${test.height}`,
    );
  }
  const n = reference.data.length;
  const delta = Buffer.alloc(n);
  let sumSq = 0;
  for (let p = 0; p < n; p += 3) {
    let pixelMax = 0;
    for (let c = 0; c < 3; c += 1) {
      const d = Math.abs(reference.data[p + c]! - test.data[p + c]!);
      sumSq += d * d;
      if (d > pixelMax) pixelMax = d;
    }
    const [r, g, b] = DELTA_LUT[pixelMax]!;
    delta[p] = r;
    delta[p + 1] = g;
    delta[p + 2] = b;
  }
  const mse = sumSq / n;
  return {
    metrics: {
      psnr: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse),
      sharpness: sharpnessRatio(reference, test),
    },
    delta: { data: delta, width: reference.width, height: reference.height },
  };
}

/**
 * Computes metrics without encoding a heatmap, for when the cached heatmap is still current.
 *
 * @param reference - The reference image as a path or encoded buffer.
 * @param test - The image to compare as a path or encoded buffer.
 * @returns The metrics and the shared image dimensions.
 * @throws If the image dimensions differ.
 */
export async function measureImages(reference: string | Buffer, test: string | Buffer): Promise<ImageMeasurement> {
  const [ref, tst] = await Promise.all([readRgb(reference), readRgb(test)]);
  return { metrics: compareRgb(ref, tst).metrics, width: ref.width, height: ref.height };
}

/**
 * Compares two encoded images; returns metrics and a quality-85 WebP heatmap.
 *
 * @param reference - The reference image as a path or encoded buffer.
 * @param test - The image to compare as a path or encoded buffer.
 * @returns The metrics, the image dimensions and the encoded WebP delta image.
 * @throws If the image dimensions differ.
 * @example
 * ```ts
 * const { metrics, deltaImage } = await compareImages('reference.avif', 'my-renderer.avif');
 * console.log(metrics.psnr); // dB, or null when identical
 * ```
 */
export async function compareImages(reference: string | Buffer, test: string | Buffer): Promise<ImageComparison> {
  const [ref, tst] = await Promise.all([readRgb(reference), readRgb(test)]);
  const { metrics, delta } = compareRgb(ref, tst);
  const deltaImage = await sharp(delta.data, { raw: { width: delta.width, height: delta.height, channels: 3 } })
    .webp(DELTA_WEBP)
    .toBuffer();
  return { metrics, width: ref.width, height: ref.height, deltaImage };
}
