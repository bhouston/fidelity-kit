import type { Convergence, ConvergenceSample, ReferenceConfig } from '../schema/index.js';

/** Encoded RGB8 PSNR, ignoring alpha. An exact match uses null for JSON-safe infinity. */
export function comparePixels(reference: Uint8ClampedArray, pixels: Uint8ClampedArray) {
  if (!reference.length || reference.length !== pixels.length || pixels.length % 4)
    throw new Error('Convergence requires matching, nonempty RGBA images');
  let squaredError = 0;
  for (let i = 0; i < pixels.length; i += 4)
    for (let channel = 0; channel < 3; channel++) {
      const delta = pixels[i + channel]! - reference[i + channel]!;
      squaredError += delta * delta;
    }
  const mse = squaredError / ((pixels.length / 4) * 3);
  return { mse, psnr: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse) };
}

export async function createConvergenceSampler(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  config: ReferenceConfig,
  clock?: () => number,
) {
  const interval = (config.intervalMs ?? 1000) / 1000;
  const targetPsnr = config.targetPsnr ?? 30;
  if (!Number.isFinite(interval) || interval < 0.016 || !Number.isFinite(targetPsnr) || targetPsnr < 0)
    throw new Error('Invalid convergence interval or PSNR target');
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error(`Cannot load convergence reference: ${config.image}`)), {
      once: true,
    });
    image.src = config.image;
  });
  const width = image.naturalWidth,
    height = image.naturalHeight;
  if (canvas.width !== width || canvas.height !== height)
    throw new Error(
      `Convergence dimensions must match: canvas ${canvas.width}×${canvas.height}, reference ${width}×${height}`,
    );
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Convergence requires a 2D readback canvas');
  context.drawImage(image, 0, 0);
  const reference = context.getImageData(0, 0, width, height).data;
  const samples: ConvergenceSample[] = [];
  let start = 0,
    nextAt = 0;
  return {
    start(at: number) {
      start = nextAt = at;
    },
    sample(at: number, frame: number) {
      if (at < nextAt) return;
      if (canvas.width !== width || canvas.height !== height) throw new Error('Canvas resized during convergence run');
      context.clearRect(0, 0, width, height);
      context.drawImage(canvas, 0, 0);
      const comparison = comparePixels(reference, context.getImageData(0, 0, width, height).data);
      const observedAt = clock?.() ?? at;
      samples.push({ at: observedAt, frame, ...comparison });
      // Skip missed ticks instead of adding a burst of readbacks after a slow frame.
      nextAt = start + (Math.floor((observedAt - start) / interval) + 1) * interval;
    },
    result(): Convergence {
      return { width, height, interval, targetPsnr, samples: samples.slice() };
    },
  };
}
