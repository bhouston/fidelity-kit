import { describe, expect, it } from 'vitest';
import { downsample } from './supersample.js';

const checker = (size: number) => {
  const data = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) data.fill((x + y) % 2 ? 255 : 0, (y * size + x) * 3, (y * size + x) * 3 + 3);
  return { data, width: size, height: size };
};

describe('downsample', () => {
  it('averages in linear light', () => {
    // Half black, half white is 0.5 linear, which is 188 in sRGB (not 128).
    const result = downsample(checker(16), { factor: 4, filter: 'box' });
    expect([result.width, result.height]).toEqual([4, 4]);
    expect(new Set(result.data)).toEqual(new Set([188]));
  });

  it('keeps flat regions flat with the Lanczos filter', () => {
    const flat = { data: Buffer.alloc(32 * 32 * 3, 90), width: 32, height: 32 };
    const result = downsample(flat, { factor: 4, filter: 'lanczos3' });
    expect(new Set(result.data)).toEqual(new Set([90]));
  });

  it('resolves a fine checker to grey away from the borders', () => {
    const result = downsample(checker(64), { factor: 4, filter: 'lanczos3' });
    const center = (8 * result.width + 8) * 3;
    expect(result.data[center]).toBeGreaterThan(180);
    expect(result.data[center]).toBeLessThan(196);
  });

  it('requires an integer multiple of the factor', () => {
    expect(() => downsample(checker(10), { factor: 4, filter: 'box' })).toThrow(/multiple/);
  });
});
