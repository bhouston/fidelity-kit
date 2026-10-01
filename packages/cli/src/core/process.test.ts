import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, expect, test, vi } from 'vitest';
import * as comparison from './compare.js';
import * as scanning from './scan.js';
import { processSuite, SuiteProcessor } from './process.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const image = (v: number) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: v, g: v, b: v } } })
    .avif({ lossless: true })
    .toBuffer();
const index = async (root: string) => JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
async function addScene(root: string, scene: string, value = 100) {
  const dir = join(root, scene, 'beauty');
  await mkdir(dir, { recursive: true });
  for (const renderer of ['ref', 'a', 'b']) await writeFile(join(dir, `${renderer}.avif`), await image(value));
  return dir;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fk-process-'));
  roots.push(root);
  await writeFile(
    join(root, 'fidelity.json'),
    JSON.stringify({ title: 'T', renderers: [{ id: 'ref', reference: true }, { id: 'a' }, { id: 'b' }] }),
  );
  return { root, dir: await addScene(root, 'one') };
}
const aKey = 'one/beauty/a.vs-ref.metrics.json';

test('persisted signatures detect older timestamps and size-only changes, and reuse future timestamps', async () => {
  const { root, dir } = await fixture();
  const file = join(dir, 'a.avif');
  const future = new Date('2040-01-01');
  await utimes(file, future, future);
  expect(await processSuite(root)).toMatchObject({ computed: 2 });
  expect(await processSuite(root)).toMatchObject({ computed: 0, skipped: 2 });
  await writeFile(file, await image(160));
  const old = new Date('2000-01-01');
  await utimes(file, old, old);
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
  expect((await index(root)).metrics[aKey].psnr).toEqual(expect.any(Number));
  await writeFile(file, Buffer.concat([await readFile(file), Buffer.from('padding')]));
  await utimes(file, old, old);
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
});

test('missing outputs, malformed metrics, and old cache formats are recomputed', async () => {
  const { root, dir } = await fixture();
  await processSuite(root);
  await rm(join(dir, 'a.vs-ref.delta.webp'));
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
  const metrics = join(root, aKey);
  const saved = JSON.parse(await readFile(metrics, 'utf8'));
  await writeFile(metrics, JSON.stringify({ ...saved, width: -1 }));
  expect(await processSuite(root)).toMatchObject({ computed: 1 });
  const { source: _source, ...legacy } = saved;
  await writeFile(metrics, JSON.stringify(legacy));
  expect(await processSuite(root)).toMatchObject({ computed: 1 });
});

test('coalesces shared input changes and updates metadata without comparing images', async () => {
  const { root, dir } = await fixture();
  const processor = await SuiteProcessor.create(root);
  await processor.initialize();
  const compare = vi.spyOn(comparison, 'compareImages');
  await writeFile(join(dir, 'ref.avif'), await image(140));
  await writeFile(join(dir, 'a.avif'), await image(120));
  processor.notify(['one/beauty/ref.avif', 'one/beauty/a.avif', 'one/beauty/ref.avif']);
  expect(await processor.flush()).toMatchObject({ computed: 2, failed: [] });
  expect(compare).toHaveBeenCalledTimes(2);
  compare.mockClear();
  await writeFile(join(root, 'one/scene.json'), JSON.stringify({ title: 'Renamed' }));
  processor.notify(['one/scene.json']);
  expect(await processor.flush()).toMatchObject({ computed: 0, skipped: 0 });
  expect(compare).not.toHaveBeenCalled();
  expect((await index(root)).root.scenes[0].title).toBe('Renamed');
});

test('adds and removes scenes and images while retaining explicit empty scenes', async () => {
  const { root, dir } = await fixture();
  const processor = await SuiteProcessor.create(root);
  await processor.initialize();
  await addScene(root, 'group/two');
  processor.notify(['group/two/beauty/a.avif']);
  expect(await processor.flush()).toMatchObject({ computed: 2 });
  await rm(join(dir, 'ref.avif'));
  processor.notify(['one/beauty/ref.avif']);
  await processor.flush();
  expect(Object.keys((await index(root)).metrics)).not.toContain(aKey);
  await writeFile(join(dir, 'ref.avif'), await image(130));
  processor.notify(['one/beauty/ref.avif']);
  expect(await processor.flush()).toMatchObject({ computed: 2 });
  await writeFile(join(root, 'one/scene.json'), '{}');
  await rm(dir, { recursive: true });
  processor.notify(['one/beauty/ref.avif', 'one/beauty/a.avif', 'one/beauty/b.avif', 'one/scene.json']);
  await processor.flush();
  expect((await index(root)).root.scenes[0].images).toEqual({});
  await rm(join(root, 'group'), { recursive: true });
  processor.removeDirectory('group');
  await processor.flush();
  expect((await index(root)).root.groups).toEqual([]);
  expect((await index(root)).metrics).toEqual({});
  await rm(join(root, 'one/scene.json'));
  processor.notify(['one/scene.json']);
  await processor.flush();
  expect((await index(root)).root.scenes).toEqual([]);
});

test('discards in-flight results and waits for a settled batch before recomputing', async () => {
  const { root, dir } = await fixture();
  const processor = await SuiteProcessor.create(root, { concurrency: 1 });
  await processor.initialize();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = comparison.compareImages;
  const compare = vi.spyOn(comparison, 'compareImages').mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    started.resolve();
    await release.promise;
    return result;
  });
  await writeFile(join(dir, 'a.avif'), await image(120));
  processor.notify(['one/beauty/a.avif']);
  const running = processor.flush();
  await started.promise;
  await writeFile(join(dir, 'a.avif'), await image(180));
  processor.notify(['one/beauty/a.avif'], true);
  release.resolve();
  expect(await running).toMatchObject({ computed: 0 });
  expect((await index(root)).metrics[aKey]).toBeUndefined();
  expect(compare).toHaveBeenCalledTimes(1);
  processor.settle();
  expect(await processor.flush()).toMatchObject({ computed: 1 });
  expect(compare).toHaveBeenCalledTimes(2);
  expect((await index(root)).metrics[aKey].psnr).toBeLessThan(13);
});

test('deleting and recreating a scene cannot publish its previous running comparison', async () => {
  const { root, dir } = await fixture();
  const processor = await SuiteProcessor.create(root, { concurrency: 1 });
  await processor.initialize();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = comparison.compareImages;
  vi.spyOn(comparison, 'compareImages').mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    started.resolve();
    await release.promise;
    return result;
  });
  await writeFile(join(dir, 'a.avif'), await image(130));
  processor.notify(['one/beauty/a.avif']);
  const running = processor.flush();
  await started.promise;
  await rm(join(root, 'one'), { recursive: true });
  processor.removeDirectory('one');
  release.resolve();
  expect(await running).toMatchObject({ computed: 0, failed: [] });
  expect((await index(root)).metrics).toEqual({});
  await addScene(root, 'one', 170);
  processor.notify(['one/beauty/a.avif']);
  expect(await processor.flush()).toMatchObject({ computed: 2 });
  expect((await index(root)).metrics[aKey].psnr).toBeNull();
});

test('streams discovery into a globally bounded queue', async () => {
  const { root } = await fixture();
  await addScene(root, 'two');
  const started = Promise.withResolvers<void>();
  const discovered = Promise.withResolvers<void>();
  const originalCompare = comparison.compareImages;
  let active = 0;
  let maximum = 0;
  vi.spyOn(comparison, 'compareImages').mockImplementation(async (...args) => {
    active++;
    maximum = Math.max(maximum, active);
    if (active === 2) started.resolve();
    await discovered.promise;
    try {
      return await originalCompare(...args);
    } finally {
      active--;
    }
  });
  const originalScan = scanning.scanSuite;
  vi.spyOn(scanning, 'scanSuite').mockImplementation((path, options) =>
    originalScan(path, {
      ...options,
      onScene: async (scene) => {
        if (scene.path === 'two') {
          await started.promise;
          discovered.resolve();
        }
        await options?.onScene?.(scene);
      },
    }),
  );
  expect(await processSuite(root, { concurrency: 2 })).toMatchObject({ computed: 4, failed: [] });
  expect(maximum).toBe(2);
});

test('ignores all generated outputs and keeps renderer/pass configuration fixed', async () => {
  const { root } = await fixture();
  const processor = await SuiteProcessor.create(root);
  await processor.initialize();
  const before = (await stat(join(root, 'index.json'))).mtimeMs;
  processor.notify([
    'index.json',
    aKey,
    'one/beauty/a.vs-ref.delta.webp',
    'one/beauty/a.avif.uuid.tmp',
    'fidelity.json',
    'one/new-pass/a.avif',
    'one/beauty/new-renderer.avif',
  ]);
  expect(await processor.flush()).toEqual({ computed: 0, skipped: 0, failed: [] });
  expect((await stat(join(root, 'index.json'))).mtimeMs).toBe(before);
});

test('failed pairs do not spin and retry after a new input revision', async () => {
  const { root, dir } = await fixture();
  const processor = await SuiteProcessor.create(root);
  await processor.initialize();
  await writeFile(join(dir, 'a.avif'), 'partial');
  processor.notify(['one/beauty/a.avif']);
  expect((await processor.flush()).failed).toHaveLength(1);
  processor.notify(['one/beauty/a.avif']);
  expect(await processor.flush()).toEqual({ computed: 0, skipped: 0, failed: [] });
  await writeFile(join(dir, 'a.avif'), await image(150));
  processor.notify(['one/beauty/a.avif']);
  expect(await processor.flush()).toMatchObject({ computed: 1, failed: [] });
});

test('multiple references invalidate both incoming and outgoing comparisons', async () => {
  const { root, dir } = await fixture();
  const config = JSON.parse(await readFile(join(root, 'fidelity.json'), 'utf8'));
  config.renderers[2].reference = true;
  await writeFile(join(root, 'fidelity.json'), JSON.stringify(config));
  const processor = await SuiteProcessor.create(root);
  expect(await processor.initialize()).toMatchObject({ computed: 4 });
  await writeFile(join(dir, 'b.avif'), await image(140));
  processor.notify(['one/beauty/b.avif']);
  expect(await processor.flush()).toMatchObject({ computed: 3 });
});

test('legacy delta false still generates delta images and repairs missing deltas', async () => {
  const { root } = await fixture();
  const config = JSON.parse(await readFile(join(root, 'fidelity.json'), 'utf8'));
  await writeFile(join(root, 'fidelity.json'), JSON.stringify({ ...config, delta: false }));
  const compare = vi.spyOn(comparison, 'compareImages');
  expect(await processSuite(root)).toMatchObject({ computed: 2 });
  for (const result of compare.mock.results) expect((await result.value).deltaImage.length).toBeGreaterThan(0);
  expect((await index(root)).metrics[aKey].psnr).toBeNull();
  expect((await stat(join(root, 'one/beauty/a.vs-ref.delta.webp'))).size).toBeGreaterThan(0);
  expect(await processSuite(root)).toMatchObject({ computed: 0, skipped: 2 });
  await rm(join(root, 'one/beauty/a.vs-ref.delta.webp'));
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
  expect((await stat(join(root, 'one/beauty/a.vs-ref.delta.webp'))).size).toBeGreaterThan(0);
});

test('one-shot changes remove stale index records after files disappeared before startup', async () => {
  const { root, dir } = await fixture();
  await processSuite(root);
  await rm(dir, { recursive: true });
  const { processChanges } = await import('./process.js');
  expect(await processChanges(root, ['one/beauty/ref.avif'])).toMatchObject({ computed: 0, failed: [] });
  expect((await index(root)).metrics).toEqual({});
  expect((await index(root)).root.scenes).toEqual([]);
});

test('output-directory removal invalidates its scene even without individual unlink events', async () => {
  const { root, dir } = await fixture();
  const processor = await SuiteProcessor.create(root);
  await processor.initialize();
  await rm(dir, { recursive: true });
  processor.removeDirectory('one/beauty');
  await processor.flush();
  expect((await index(root)).metrics).toEqual({});
  expect((await index(root)).root.scenes).toEqual([]);
});

test('metrics and heatmaps have independent input-signature caches', async () => {
  const { root, dir } = await fixture();
  await processSuite(root);
  const metrics = join(root, aKey);
  const delta = join(dir, 'a.vs-ref.delta.webp');
  const cache = `${delta}.json`;
  const originalMetrics = await readFile(metrics, 'utf8');
  const originalMetricsStat = await stat(metrics);
  const compare = vi.spyOn(comparison, 'compareImages');

  await rm(delta);
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
  expect(compare).toHaveBeenCalledTimes(1);
  expect(await readFile(metrics, 'utf8')).toBe(originalMetrics);
  expect((await stat(metrics)).mtimeMs).toBe(originalMetricsStat.mtimeMs);
  expect((await sharp(delta).metadata()).format).toBe('webp');
  const originalDelta = await readFile(delta);
  const originalDeltaStat = await stat(delta);
  const originalCache = await readFile(cache, 'utf8');
  const originalCacheStat = await stat(cache);

  await rm(metrics);
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
  expect(compare).toHaveBeenCalledTimes(1);
  expect(await readFile(delta)).toEqual(originalDelta);
  expect((await stat(delta)).mtimeMs).toBe(originalDeltaStat.mtimeMs);
  expect(await readFile(cache, 'utf8')).toBe(originalCache);
  expect((await stat(cache)).mtimeMs).toBe(originalCacheStat.mtimeMs);

  const saved = JSON.parse(await readFile(metrics, 'utf8'));
  await writeFile(
    metrics,
    JSON.stringify({ ...saved, source: { ...saved.source, renderer: { ...saved.source.renderer, size: -1 } } }),
  );
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
  expect(compare).toHaveBeenCalledTimes(1);
  expect((await stat(delta)).mtimeMs).toBe(originalDeltaStat.mtimeMs);

  const currentMetrics = await readFile(metrics, 'utf8');
  await writeFile(cache, '{}');
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
  expect(compare).toHaveBeenCalledTimes(2);
  expect(await readFile(metrics, 'utf8')).toBe(currentMetrics);
  expect(await processSuite(root)).toMatchObject({ computed: 0, skipped: 2 });
});

test('legacy AVIF metrics stay untouched while WebP heatmaps are generated', async () => {
  const { root, dir } = await fixture();
  await processSuite(root);
  const file = join(root, aKey);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  delete saved.source.reference.path;
  delete saved.source.renderer.path;
  saved.source.delta = true;
  await writeFile(file, JSON.stringify(saved));
  const originalMetrics = await readFile(file, 'utf8');
  const before = (await stat(file)).mtimeMs;
  await rm(join(dir, 'a.vs-ref.delta.webp'));
  await rm(join(dir, 'a.vs-ref.delta.webp.json'));
  await writeFile(join(dir, 'a.vs-ref.delta.avif'), await image(0));
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
  expect(await readFile(file, 'utf8')).toBe(originalMetrics);
  expect((await stat(file)).mtimeMs).toBe(before);
  expect((await sharp(join(dir, 'a.vs-ref.delta.webp')).metadata()).format).toBe('webp');
  expect((await index(root)).metrics[aKey].deltaFile).toBe('a.vs-ref.delta.webp');
});

const encoded = (format: 'avif' | 'webp' | 'png' | 'jpeg', value: number) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: value, g: value, b: value } } })
    .toFormat(format)
    .toBuffer();

test('selects AVIF, WebP, PNG, then JPG and reselects sources during incremental processing', async () => {
  const { root, dir } = await fixture();
  await rm(join(dir, 'ref.avif'));
  await writeFile(join(dir, 'ref.png'), await encoded('png', 100));
  for (const [extension, format, value] of [
    ['avif', 'avif', 120],
    ['webp', 'webp', 140],
    ['png', 'png', 160],
    ['jpg', 'jpeg', 180],
  ] as const)
    await writeFile(join(dir, `a.${extension}`), await encoded(format, value));
  const processor = await SuiteProcessor.create(root);
  expect(await processor.initialize()).toMatchObject({ computed: 2, failed: [] });
  for (const extension of ['avif', 'webp', 'png', 'jpg']) {
    const data = await index(root);
    expect(data.root.scenes[0].imageFiles.beauty).toMatchObject({ ref: 'ref.png', a: `a.${extension}` });
    expect((await scanning.scanScene(root, 'one', processor.config))?.imageFiles).toEqual(
      data.root.scenes[0].imageFiles,
    );
    await rm(join(dir, `a.${extension}`));
    processor.notify([`one/beauty/a.${extension}`]);
    expect(await processor.flush()).toMatchObject({ computed: extension === 'jpg' ? 0 : 1, failed: [] });
  }
  expect((await index(root)).metrics[aKey]).toBeUndefined();
  await writeFile(join(dir, 'a.jpg'), await encoded('jpeg', 180));
  processor.notify(['one/beauty/a.jpg']);
  await processor.flush();
  await writeFile(join(dir, 'a.webp'), await encoded('webp', 140));
  processor.notify(['one/beauty/a.webp']);
  expect(await processor.flush()).toMatchObject({ computed: 1, failed: [] });
  expect((await index(root)).root.scenes[0].imageFiles.beauty.a).toBe('a.webp');
  const compare = vi.spyOn(comparison, 'compareImages');
  await writeFile(join(dir, 'a.png'), await encoded('png', 160));
  processor.notify(['one/beauty/a.png']);
  expect(await processor.flush()).toMatchObject({ computed: 0 });
  expect(compare).not.toHaveBeenCalled();
});

test('source format changes invalidate caches even when size and mtime match', async () => {
  const { root, dir } = await fixture();
  await rm(join(dir, 'a.avif'));
  const jpg = await encoded('jpeg', 180);
  const png = await encoded('png', 160);
  const size = Math.max(jpg.length, png.length);
  const timestamp = new Date('2000-01-01');
  for (const [extension, bytes] of [
    ['jpg', jpg],
    ['png', png],
  ] as const) {
    await writeFile(join(dir, `a.${extension}`), Buffer.concat([bytes, Buffer.alloc(size - bytes.length)]));
    await utimes(join(dir, `a.${extension}`), timestamp, timestamp);
  }
  expect(await processSuite(root)).toMatchObject({ computed: 2 });
  const previous = (await index(root)).metrics[aKey].psnr;
  await rm(join(dir, 'a.png'));
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
  expect((await index(root)).metrics[aKey].psnr).toBeLessThan(previous!);
  expect(await processSuite(root)).toMatchObject({ computed: 0, skipped: 2 });
});

test('warm-cache discovery retains every pair in scenes with multiple outputs', async () => {
  const { root, dir } = await fixture();
  await rm(dir, { recursive: true });
  const outputs = ['beauty', 'direct', 'ao'];
  const renderers = [{ id: 'ref', reference: true }, { id: 'a' }, { id: 'b' }];
  await writeFile(
    join(root, 'fidelity.json'),
    JSON.stringify({ title: 'T', renderers, outputs: outputs.map((id) => ({ id })) }),
  );
  const bytes = await encoded('png', 100);
  for (let i = 0; i < 12; i++)
    for (const output of outputs) {
      const path = join(root, `scene-${i}`, output);
      await mkdir(path, { recursive: true });
      for (const renderer of renderers) await writeFile(join(path, `${renderer.id}.png`), bytes);
    }
  expect(await processSuite(root)).toEqual({ computed: 72, skipped: 0, failed: [] });
  for (let i = 0; i < 5; i++) {
    expect(await processSuite(root)).toEqual({ computed: 0, skipped: 72, failed: [] });
    expect(Object.keys((await index(root)).metrics)).toHaveLength(72);
  }
});
