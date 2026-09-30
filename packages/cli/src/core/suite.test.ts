import { mkdtemp, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { expect, test } from 'vitest';
import { fileResponse, processSuite, scanSuite } from './index.js';

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

  expect(await processSuite(root)).toMatchObject({ computed: 2, skipped: 0, failed: [] });
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
  const second = await fileResponse(new Request(url, { headers: { 'if-none-match': tag } }), join(dir, 'a.avif'));
  expect(second.status).toBe(304);
});
