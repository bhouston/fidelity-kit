import { describe, expect, it } from 'vitest';
import { compareRgb, type RawImage } from './compare.js';
import { compareSequences } from './temporal.js';

const image = (width: number, height: number, pixel: (x: number, y: number) => number): RawImage => {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) data.fill(pixel(x, y), (y * width + x) * 3, (y * width + x) * 3 + 3);
  return { data, width, height };
};
const stripes = (phase: number) => image(8, 4, (x) => ((x + phase) % 2 ? 200 : 40));
const blurred = () => image(8, 4, () => 120);

describe('compareSequences', () => {
  it('reports identical sequences as infinite PSNR and equal sharpness', () => {
    const frames = [stripes(0), stripes(1), stripes(0)];
    const { summary, perFrame } = compareSequences(frames, frames);
    expect(summary).toEqual({ psnr: null, temporalPsnr: null, sharpness: 1, frames: 3 });
    expect(perFrame.temporalPsnr[0]).toBeNull();
  });

  it('separates a constant error from flicker', () => {
    const reference = [stripes(0), stripes(0), stripes(0)];
    const offset = reference.map((frame) => ({ ...frame, data: frame.data.map((v) => v + 10) as Buffer }));
    const constant = compareSequences(reference, offset).summary;
    expect(constant.psnr).toBeCloseTo(10 * Math.log10((255 * 255) / 100));
    expect(constant.temporalPsnr).toBeNull();
    const flicker = compareSequences(reference, [stripes(0), stripes(1), stripes(0)]).summary;
    expect(flicker.temporalPsnr).not.toBeNull();
    expect(flicker.temporalPsnr!).toBeLessThan(constant.psnr!);
  });

  it('reports blur as sharpness below one and aliasing as above one', () => {
    const reference = [image(8, 4, (x) => (x < 4 ? 40 : 200)), image(8, 4, (x) => (x < 4 ? 40 : 200))];
    expect(compareSequences(reference, [blurred(), blurred()]).summary.sharpness).toBe(0);
    expect(compareSequences(reference, [stripes(0), stripes(0)]).summary.sharpness).toBeGreaterThan(1);
  });

  it('rejects mismatched sequences', () => {
    expect(() => compareSequences([stripes(0)], [])).toThrow(/Frame count/);
    expect(() => compareSequences([stripes(0)], [image(4, 4, () => 0)])).toThrow(/size mismatch/);
  });
});

describe('image sharpness', () => {
  it('is reported with PSNR and is null for a flat reference', () => {
    expect(compareRgb(stripes(0), stripes(0)).metrics).toEqual({ psnr: null, sharpness: 1 });
    expect(compareRgb(blurred(), stripes(0)).metrics.sharpness).toBeNull();
  });
});
