import type { RawImage } from './core/compare.js';
import type { Supersample } from './registry.js';

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

function toSrgb8(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Normalized 1D filter taps (source offsets relative to the first source pixel of an output pixel). */
function taps(factor: number, filter: Supersample['filter']): { offsets: Int32Array; weights: Float32Array } {
  if (filter === 'box')
    return {
      offsets: Int32Array.from({ length: factor }, (_, i) => i),
      weights: new Float32Array(factor).fill(1 / factor),
    };
  // Lanczos3 scaled to the output pixel: support of 3 output pixels on each side of the output pixel center.
  const center = factor / 2;
  const radius = 3 * factor;
  const offsets: number[] = [];
  const weights: number[] = [];
  for (let i = Math.floor(center - radius); i <= Math.ceil(center + radius); i += 1) {
    const x = (i + 0.5 - center) / factor;
    if (Math.abs(x) >= 3) continue;
    offsets.push(i);
    weights.push(sinc(x) * sinc(x / 3));
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  return { offsets: Int32Array.from(offsets), weights: Float32Array.from(weights, (w) => w / sum) };
}

/**
 * Downsamples a supersampled 8-bit sRGB capture by an integer factor with a separable filter. Filtering happens in
 * linear light, like the resolve of a supersampled render, and the result is encoded back to 8-bit sRGB. Lanczos
 * ringing is clamped; edges are clamped to the image border.
 */
export function downsample(image: RawImage, options: Supersample): RawImage {
  const { factor, filter } = options;
  if (image.width % factor || image.height % factor)
    throw new Error(`Capture ${image.width}x${image.height} is not a multiple of the supersample factor ${factor}`);
  const width = image.width / factor;
  const height = image.height / factor;
  const { offsets, weights } = taps(factor, filter);
  // Horizontal pass: source height × output width, in linear light.
  const horizontal = new Float32Array(image.height * width * 3);
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let t = 0; t < offsets.length; t += 1) {
        const sx = Math.min(image.width - 1, Math.max(0, x * factor + offsets[t]!));
        const p = (y * image.width + sx) * 3;
        const w = weights[t]!;
        r += SRGB_TO_LINEAR[image.data[p]!]! * w;
        g += SRGB_TO_LINEAR[image.data[p + 1]!]! * w;
        b += SRGB_TO_LINEAR[image.data[p + 2]!]! * w;
      }
      const o = (y * width + x) * 3;
      horizontal[o] = r;
      horizontal[o + 1] = g;
      horizontal[o + 2] = b;
    }
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1)
      for (let c = 0; c < 3; c += 1) {
        let v = 0;
        for (let t = 0; t < offsets.length; t += 1) {
          const sy = Math.min(image.height - 1, Math.max(0, y * factor + offsets[t]!));
          v += horizontal[(sy * width + x) * 3 + c]! * weights[t]!;
        }
        data[(y * width + x) * 3 + c] = toSrgb8(v);
      }
  return { data, width, height };
}
