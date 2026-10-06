import { afterEach, expect, it, vi } from 'vitest';
import { comparePixels, createConvergenceSampler } from './convergence.js';
afterEach(() => vi.unstubAllGlobals());
it('compares RGB, ignores alpha, and serializes exact matches without Infinity', () => {
  const a = new Uint8ClampedArray([0, 10, 20, 0]);
  expect(comparePixels(a, new Uint8ClampedArray([0, 10, 20, 255]))).toEqual({ mse: 0, psnr: null });
  const different = comparePixels(a, new Uint8ClampedArray([10, 20, 30, 255]));
  expect(different.mse).toBe(100);
  expect(different.psnr).toBeCloseTo(28.1308036087);
  expect(JSON.stringify(comparePixels(a, a))).toBe('{"mse":0,"psnr":null}');
  expect(() => comparePixels(a, new Uint8ClampedArray(8))).toThrow(/matching/);
});
function canvasFixture() {
  const reference = new Uint8ClampedArray([100, 100, 100, 255]);
  const pixels = new Uint8ClampedArray([80, 80, 80, 255]);
  let live = false;
  const read = vi.fn(() => ({ data: live ? pixels : reference }));
  const source = { width: 1, height: 1 } as HTMLCanvasElement;
  const context = {
    drawImage: (image: unknown) => {
      live = image === source;
    },
    clearRect() {},
    getImageData: read,
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 1;
      naturalHeight = 1;
      loadCallback?: () => void;
      addEventListener(type: string, callback: () => void) {
        if (type === 'load') this.loadCallback = callback;
      }
      set src(_src: string) {
        queueMicrotask(() => this.loadCallback?.());
      }
    },
  );
  return { source, read, pixels };
}
it('samples elapsed time, skips missed ticks and never reads on intervening frames', async () => {
  const f = canvasFixture();
  const sampler = await createConvergenceSampler(f.source, {
    image: '/reference.png',
    intervalMs: 1000,
    targetPsnr: 30,
  });
  sampler.start(10);
  sampler.sample(10.1, 1);
  sampler.sample(10.8, 2);
  sampler.sample(11.2, 3);
  sampler.sample(14.8, 4);
  sampler.sample(14.9, 5);
  f.pixels.fill(100, 0, 3);
  sampler.sample(15, 6);
  expect(sampler.result().samples.map((s) => [s.at, s.frame])).toEqual([
    [10.1, 1],
    [11.2, 3],
    [14.8, 4],
    [15, 6],
  ]);
  expect(sampler.result().samples.at(-1)?.psnr).toBeNull();
  expect(f.read).toHaveBeenCalledTimes(5); // One reference load and four timed comparisons.
});
it('rejects mismatched dimensions and resizing rather than silently resampling', async () => {
  const f = canvasFixture();
  f.source.width = 2;
  await expect(createConvergenceSampler(f.source, { image: '/ref' })).rejects.toThrow(/dimensions/);
  f.source.width = 1;
  const sampler = await createConvergenceSampler(f.source, { image: '/ref' });
  f.source.width = 2;
  expect(() => sampler.sample(0, 1)).toThrow(/resized/);
});

it('timestamps quality after readback/comparison and skips ticks consumed by that work', async () => {
  const f = canvasFixture();
  let completed = 10.7;
  const sampler = await createConvergenceSampler(f.source, { image: '/ref', intervalMs: 500 }, () => completed);
  sampler.start(10);
  sampler.sample(10.1, 1);
  sampler.sample(10.8, 2);
  completed = 11.1;
  sampler.sample(11, 3);
  expect(sampler.result().samples.map((s) => s.at)).toEqual([10.7, 11.1]);
  expect(f.read).toHaveBeenCalledTimes(3);
});
