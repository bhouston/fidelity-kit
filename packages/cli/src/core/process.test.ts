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
  expect((await index(root)).metrics[aKey].maxError).toBeGreaterThan(0);
  await writeFile(file, Buffer.concat([await readFile(file), Buffer.from('padding')]));
  await utimes(file, old, old);
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });
});

test('missing outputs, malformed metrics, and old cache formats are recomputed', async () => {
  const { root, dir } = await fixture();
  await processSuite(root);
  await rm(join(dir, 'a.vs-ref.delta.avif'));
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
  expect((await index(root)).metrics[aKey].maxError).toBeGreaterThan(0.25);
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
  expect((await index(root)).metrics[aKey].maxError).toBe(0);
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
    'one/beauty/a.vs-ref.delta.avif',
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

test('metrics-only processing avoids delta encoding and reuses its results', async () => {
  const { root } = await fixture();
  const config = JSON.parse(await readFile(join(root, 'fidelity.json'), 'utf8'));
  await writeFile(join(root, 'fidelity.json'), JSON.stringify({ ...config, delta: false }));
  const compare = vi.spyOn(comparison, 'compareImages');
  expect(await processSuite(root)).toMatchObject({ computed: 2 });
  for (const result of compare.mock.results) expect((await result.value).deltaImage.length).toBe(0);
  expect((await index(root)).metrics[aKey].maxError).toBe(0);
  await expect(stat(join(root, 'one/beauty/a.vs-ref.delta.avif'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await processSuite(root)).toMatchObject({ computed: 0, skipped: 2 });
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
