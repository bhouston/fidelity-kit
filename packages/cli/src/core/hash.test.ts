import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { HASHES_FILE, hashFile, hashSuite } from './index.js';
import type { ProgressUpdate } from './progress.js';

async function suite() {
  const root = await mkdtemp(join(tmpdir(), 'fk-hash-'));
  await mkdir(join(root, 'b', 'beauty'), { recursive: true });
  await mkdir(join(root, 'a', 'beauty'), { recursive: true });
  await mkdir(join(root, '.hidden'), { recursive: true });
  for (const [f, c] of [
    ['b/beauty/x.avif', 'bbb'],
    ['a/beauty/x.avif', 'a'],
    ['a/beauty/y.avif', 'aaaa'],
    ['a/notes.txt', 'ignored'],
    ['.hidden/z.avif', 'ignored'],
  ] as const) {
    await writeFile(join(root, f), c);
  }
  return root;
}
const read = async (root: string) => JSON.parse(await readFile(join(root, HASHES_FILE), 'utf8'));

test('hash is deterministic, sorted, covers only served images, and is incremental', async () => {
  const root = await suite();
  const progress: ProgressUpdate[] = [];
  expect(await hashSuite(root, { onProgress: (update) => progress.push(update) })).toEqual({
    hashed: 3,
    reused: 0,
    total: 3,
  });
  expect(progress.at(-1)).toEqual({ phase: 'Writing hashes', completed: 1, total: 1, unit: 'files' });
  expect(progress.find((update) => update.phase === 'Hashing' && update.completed === 3)).toBeDefined();
  const first = await readFile(join(root, HASHES_FILE), 'utf8');
  const json = JSON.parse(first);
  expect(json.version).toBe(1);
  expect(Object.keys(json.files)).toEqual(['a/beauty/x.avif', 'a/beauty/y.avif', 'b/beauty/x.avif']);
  expect(json.files['b/beauty/x.avif']).toMatchObject({ hash: await hashFile(join(root, 'b/beauty/x.avif')), size: 3 });

  expect(await hashSuite(root)).toEqual({ hashed: 0, reused: 3, total: 3 });
  expect(await readFile(join(root, HASHES_FILE), 'utf8')).toBe(first);

  // changed content (new size) is rehashed, the rest is reused without reading
  const hashed: string[] = [];
  await writeFile(join(root, 'a/beauty/y.avif'), 'changed!');
  const r = await hashSuite(root, {
    hash: (p) => {
      hashed.push(p);
      return hashFile(p);
    },
  });
  expect(r).toEqual({ hashed: 1, reused: 2, total: 3 });
  expect(hashed).toEqual([join(root, 'a/beauty/y.avif')]);
  expect((await read(root)).files['a/beauty/y.avif'].hash).not.toBe(json.files['a/beauty/y.avif'].hash);

  // a touched file (same bytes, new mtime) is rehashed to the same hash
  const later = new Date(Date.now() + 10_000);
  await utimes(join(root, 'a/beauty/x.avif'), later, later);
  expect(await hashSuite(root)).toMatchObject({ hashed: 1, reused: 2 });
  expect((await read(root)).files['a/beauty/x.avif'].hash).toBe(json.files['a/beauty/x.avif'].hash);
});

test('hash concurrency never exceeds the limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fk-hash-'));
  await mkdir(join(root, 's', 'o'), { recursive: true });
  for (let i = 0; i < 12; i++) await writeFile(join(root, 's', 'o', `${i}.avif`), String(i));
  let active = 0;
  let peak = 0;
  const hash = async () => {
    peak = Math.max(peak, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return 'h';
  };
  await hashSuite(root, { concurrency: 3, hash });
  expect(peak).toBe(3);
  peak = 0;
  await writeFile(join(root, HASHES_FILE), '{}'); // malformed cache is ignored
  await hashSuite(root, { concurrency: 1, hash });
  expect(peak).toBe(1);
});

test('hashes all supported source formats and WebP heatmaps without cache sidecars', async () => {
  const root = await suite();
  for (const name of ['z.webp', 'z.png', 'z.jpg', 'z.vs-ref.delta.webp', 'z.vs-ref.delta.webp.json', 'z.webp.tmp'])
    await writeFile(join(root, 'a/beauty', name), name);
  expect(await hashSuite(root)).toMatchObject({ hashed: 7, total: 7 });
  expect(Object.keys((await read(root)).files)).toEqual([
    'a/beauty/x.avif',
    'a/beauty/y.avif',
    'a/beauty/z.jpg',
    'a/beauty/z.png',
    'a/beauty/z.vs-ref.delta.webp',
    'a/beauty/z.webp',
    'b/beauty/x.avif',
  ]);
  expect(await hashSuite(root)).toMatchObject({ hashed: 0, reused: 7 });
});
