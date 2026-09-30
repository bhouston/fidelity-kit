import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, test, vi } from 'vitest';
import * as comparison from './core/compare.js';
import { processChanges, processSuite } from './core/process.js';
import { watchResults } from './watch.js';
import type { ProgressUpdate } from './core/progress.js';

const image = (value: number) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: value, g: value, b: value } } })
    .avif({ lossless: true })
    .toBuffer();
const index = async (root: string) => JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fk-watch-'));
  await writeFile(
    join(root, 'fidelity.json'),
    JSON.stringify({ title: 'Watch', renderers: [{ id: 'ref', reference: true }, { id: 'a' }, { id: 'b' }] }),
  );
  const dir = join(root, 'one', 'beauty');
  await mkdir(dir, { recursive: true });
  for (const renderer of ['ref', 'a', 'b']) await writeFile(join(dir, `${renderer}.avif`), await image(100));
  await processSuite(root);
  return { root, dir };
}

test('a changed renderer recomputes only its pair and updates the index; new scenes are inserted', async () => {
  const { root, dir } = await fixture();
  const before = await index(root);
  const changed = join(dir, 'a.avif');
  await writeFile(changed, await image(140));
  const future = new Date(Date.now() + 2000);
  await utimes(changed, future, future);
  const progress: ProgressUpdate[] = [];
  expect(await processChanges(root, ['one/beauty/a.avif'], (update) => progress.push(update))).toMatchObject({
    computed: 1,
    failed: [],
  });
  expect(progress.at(-1)).toEqual({ phase: 'Writing index', completed: 1, total: 1, unit: 'files' });
  expect(progress.find((update) => update.phase === 'Comparing' && update.completed === 1)).toBeDefined();
  const after = await index(root);
  expect(after.metrics['one/beauty/a.vs-ref.metrics.json'].maxError).toBeGreaterThan(0);
  expect(after.metrics['one/beauty/b.vs-ref.metrics.json']).toEqual(before.metrics['one/beauty/b.vs-ref.metrics.json']);
  const newDir = join(root, 'two', 'beauty');
  await mkdir(newDir, { recursive: true });
  await writeFile(join(newDir, 'ref.avif'), await image(90));
  await writeFile(join(newDir, 'a.avif'), await image(110));
  expect(await processChanges(root, ['two/beauty/a.avif'])).toMatchObject({ computed: 1, failed: [] });
  expect((await index(root)).root.scenes.map((s: { path: string }) => s.path)).toEqual(['one', 'two']);
});

test('the watcher picks up an overwritten image and survives an invalid intermediate file', async () => {
  const { root, dir } = await fixture();
  const updates: number[] = [];
  const watcher = await watchResults(root, (result) => updates.push(result.computed));
  try {
    await writeFile(join(dir, 'a.avif'), 'incomplete');
    await new Promise((resolve) => setTimeout(resolve, 900));
    await writeFile(join(dir, 'a.avif'), await image(160));
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('watch update timed out')), 6000);
      const poll = setInterval(async () => {
        if ((await index(root)).metrics['one/beauty/a.vs-ref.metrics.json']?.maxError > 0) {
          clearTimeout(deadline);
          clearInterval(poll);
          resolve();
        }
      }, 100);
    });
    expect(updates).toContain(1);
  } finally {
    await watcher.close();
  }
});

test('reference and metadata changes refresh the affected scene', async () => {
  const { root, dir } = await fixture();
  await writeFile(join(root, 'one', 'scene.json'), JSON.stringify({ title: 'Renamed', tags: ['new'] }));
  expect(await processChanges(root, ['one/scene.json'])).toMatchObject({ computed: 0 });
  expect((await index(root)).root.scenes[0]).toMatchObject({ title: 'Renamed', tags: ['new'] });
  const changed = join(dir, 'ref.avif');
  await writeFile(changed, await image(170));
  const future = new Date(Date.now() + 2000);
  await utimes(changed, future, future);
  expect(await processChanges(root, ['one/beauty/ref.avif'])).toMatchObject({ computed: 2, failed: [] });
});

test('generated metrics, deltas, index and temporary writes never trigger watch updates', async () => {
  const { root, dir } = await fixture();
  const updates: number[] = [];
  const watcher = await watchResults(root, (result) => updates.push(result.computed), { concurrency: 1 });
  try {
    const baseline = updates.length;
    await writeFile(join(dir, 'a.vs-ref.metrics.json'), '{}');
    await writeFile(join(dir, 'a.vs-ref.delta.webp'), await image(30));
    await writeFile(join(dir, 'a.avif.write.tmp'), 'temporary');
    await writeFile(join(root, 'index.json.write.tmp'), '{}');
    await writeFile(join(root, 'index.json'), JSON.stringify(await index(root)));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(updates).toHaveLength(baseline);
    await writeFile(join(dir, 'a.avif'), await image(190));
    await expect.poll(() => updates.length, { timeout: 6000 }).toBe(baseline + 1);
    expect(updates.at(-1)).toBe(1);
    // The comparison itself writes all generated artifacts; none may feed back into the watcher.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(updates).toHaveLength(baseline + 1);
  } finally {
    await watcher.close();
  }
}, 10000);

test('changes during initial processing are observed and supersede the initial comparison', async () => {
  const { root, dir } = await fixture();
  await writeFile(join(dir, 'a.avif'), await image(130));
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = comparison.compareImages;
  const compare = vi.spyOn(comparison, 'compareImages').mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    started.resolve();
    await release.promise;
    return result;
  });
  let watcher: Awaited<ReturnType<typeof watchResults>> | undefined;
  try {
    const starting = watchResults(root);
    await started.promise;
    await writeFile(join(dir, 'a.avif'), await image(190));
    // Let the real watcher deliver its stable-write notification while startup is still running.
    await new Promise((resolve) => setTimeout(resolve, 900));
    release.resolve();
    watcher = await starting;
    await expect
      .poll(async () => (await index(root)).metrics['one/beauty/a.vs-ref.metrics.json']?.maxError, { timeout: 6000 })
      .toBeGreaterThan(0.3);
    expect(compare).toHaveBeenCalledTimes(2);
  } finally {
    release.resolve();
    await watcher?.close();
    compare.mockRestore();
  }
}, 10000);

test('watch mode discovers preferred formats and falls back when they are removed', async () => {
  const { rm } = await import('node:fs/promises');
  const { root, dir } = await fixture();
  await rm(join(dir, 'a.avif'));
  await writeFile(
    join(dir, 'a.jpg'),
    await sharp(await image(160))
      .jpeg()
      .toBuffer(),
  );
  const updates: number[] = [];
  const watcher = await watchResults(root, (result) => updates.push(result.computed));
  try {
    expect((await index(root)).root.scenes[0].imageFiles.beauty.a).toBe('a.jpg');
    for (const extension of ['png', 'webp', 'avif'] as const) {
      await writeFile(
        join(dir, `a.${extension}`),
        await sharp(await image(120))
          .toFormat(extension)
          .toBuffer(),
      );
      await expect
        .poll(async () => (await index(root)).root.scenes[0].imageFiles.beauty.a, { timeout: 6000 })
        .toBe(`a.${extension}`);
    }
    await rm(join(dir, 'a.avif'));
    await expect
      .poll(async () => (await index(root)).root.scenes[0].imageFiles.beauty.a, { timeout: 6000 })
      .toBe('a.webp');
    const count = updates.length;
    await writeFile(join(dir, 'a.vs-ref.delta.webp.json'), '{}');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(updates).toHaveLength(count);
  } finally {
    await watcher.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
