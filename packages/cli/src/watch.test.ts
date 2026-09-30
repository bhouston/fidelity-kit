import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { processChanges, processSuite } from './core/process.js';
import { watchResults } from './watch.js';

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
  expect(await processChanges(root, ['one/beauty/a.avif'])).toMatchObject({ computed: 1, failed: [] });
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
