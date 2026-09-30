import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { fileResponse, processSuite, readConfig, scanSuite } from './index.js';
import type { ProgressUpdate } from './progress.js';

const png = (v: number) =>
  sharp({ create: { width: 8, height: 8, channels: 3, background: { r: v, g: v, b: v } } })
    .avif({ lossless: true })
    .toBuffer();

test('scan, process, staleness, etag', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fk-'));
  await writeFile(
    join(root, 'fidelity.json'),
    JSON.stringify({ title: 'T', renderers: [{ id: 'ref', reference: true }, { id: 'a' }, { id: 'b' }] }),
  );
  const dir = join(root, 'g1', 'g2', 's1', 'beauty');
  await mkdir(dir, { recursive: true });
  await writeFile(join(root, 'g1', 'g2', 's1', 'scene.json'), JSON.stringify({ tags: ['x'] }));
  await writeFile(join(dir, 'ref.avif'), await png(100));
  await writeFile(join(dir, 'a.avif'), await png(100));
  await writeFile(join(dir, 'b.avif'), await png(110));

  const suite = await scanSuite(root);
  expect(suite.root.groups[0]!.groups[0]!.scenes[0]).toMatchObject({
    path: 'g1/g2/s1',
    tags: ['x'],
    images: { beauty: ['ref', 'a', 'b'] },
  });

  const progress: ProgressUpdate[] = [];
  expect(await processSuite(root, { onProgress: (update) => progress.push(update) })).toMatchObject({
    computed: 2,
    skipped: 0,
    failed: [],
  });
  expect(progress.filter((update) => update.completed === update.total).map((update) => update.phase)).toEqual(
    expect.arrayContaining(['Scanning', 'Comparing', 'Scanning for index', 'Writing index']),
  );
  const a = JSON.parse(await readFile(join(dir, 'a.vs-ref.metrics.json'), 'utf8'));
  const b = JSON.parse(await readFile(join(dir, 'b.vs-ref.metrics.json'), 'utf8'));
  expect(a.psnr).toBeNull();
  expect(b.maxError).toBeGreaterThan(0);

  expect(await processSuite(root)).toMatchObject({ computed: 0, skipped: 2 });
  const future = new Date(Date.now() + 5000);
  await utimes(join(dir, 'b.avif'), future, future);
  expect(await processSuite(root)).toMatchObject({ computed: 1, skipped: 1 });

  const url = 'http://x/';
  const first = await fileResponse(new Request(url), join(dir, 'a.avif'));
  const tag = first.headers.get('etag')!;
  await first.body?.cancel();
  const second = await fileResponse(new Request(url, { headers: { 'if-none-match': tag } }), join(dir, 'a.avif'));
  expect(second.status).toBe(304);
});

test('explicit empty scenes remain in the index and failed pairs cannot reuse stale metrics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fk-failure-'));
  await writeFile(
    join(root, 'fidelity.json'),
    JSON.stringify({ title: 'T', renderers: [{ id: 'ref', reference: true }, { id: 'test' }] }),
  );
  const empty = join(root, 'empty');
  const images = join(root, 'broken', 'beauty');
  await mkdir(empty);
  await mkdir(images, { recursive: true });
  await writeFile(join(empty, 'scene.json'), JSON.stringify({ title: 'Empty' }));
  await writeFile(join(images, 'ref.avif'), await png(100));
  await writeFile(
    join(images, 'test.avif'),
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } })
      .avif()
      .toBuffer(),
  );
  await writeFile(join(images, 'test.vs-ref.metrics.json'), JSON.stringify({ psnr: 50, width: 8, height: 8 }));

  const result = await processSuite(root, { force: true });
  expect(result.failed).toHaveLength(1);
  const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8'));
  expect(index.root.scenes.map((s: { path: string }) => s.path)).toEqual(['broken', 'empty']);
  expect(index.root.scenes[1].images).toEqual({});
  expect(index.metrics).toEqual({});
});

test('config rejects empty outputs and duplicate ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fk-config-'));
  const config = {
    title: 'T',
    renderers: [{ id: 'ref', reference: true }, { id: 'test' }],
    outputs: [{ id: 'beauty' }],
  };
  for (const change of [
    { outputs: [] },
    { outputs: [{ id: 'beauty' }, { id: 'beauty' }] },
    { renderers: [{ id: 'ref', reference: true }, { id: 'ref' }] },
  ]) {
    await writeFile(join(root, 'fidelity.json'), JSON.stringify({ ...config, ...change }));
    await expect(readConfig(root)).rejects.toThrow();
  }
});

const strip = (raw: string) => JSON.parse(raw.replace(/"generatedAt": "[^"]*"/g, '"generatedAt": ""'));

test('concurrent and sequential processing give identical results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fk-conc-'));
  await writeFile(
    join(root, 'fidelity.json'),
    JSON.stringify({ title: 'T', renderers: [{ id: 'ref', reference: true }, { id: 'a' }, { id: 'b' }] }),
  );
  for (let i = 0; i < 6; i++) {
    const dir = join(root, `s${i}`, 'beauty');
    await mkdir(dir, { recursive: true });
    await writeFile(join(root, `s${i}`, 'scene.json'), '{}');
    await writeFile(join(dir, 'ref.avif'), await png(100));
    await writeFile(join(dir, 'a.avif'), await png(100 + i));
    await writeFile(join(dir, 'b.avif'), await png(120 + i));
  }
  expect(await processSuite(root, { concurrency: 1 })).toMatchObject({ computed: 12, failed: [] });
  const seq = strip(await readFile(join(root, 'index.json'), 'utf8'));
  expect(await processSuite(root, { force: true, concurrency: 4 })).toMatchObject({ computed: 12, failed: [] });
  expect(strip(await readFile(join(root, 'index.json'), 'utf8'))).toEqual(seq);
});
