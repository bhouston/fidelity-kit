import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createHandler } from './server.js';

test('serves only allowlisted suite files and the viewer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fk-srv-'));
  const [root, assets] = [join(dir, 'root'), join(dir, 'assets')];
  await mkdir(join(root, 's', 'beauty'), { recursive: true });
  await mkdir(join(assets, 'assets'), { recursive: true });
  for (const [f, c] of [
    ['root/index.json', '{}'],
    ['root/fidelity.json', '{}'],
    ['root/README.md', '# x'],
    ['root/s/scene.json', '{}'],
    ['root/s/beauty/a.avif', 'img'],
    ['secret.txt', 'nope'],
    ['assets/index.html', '<html>'],
    ['assets/assets/app.js', '1'],
  ] as const) {
    await writeFile(join(dir, f), c);
  }
  const get = async (p: string) => createHandler(root, assets)(new Request(`http://x${p}`));
  const status = async (p: string) => (await get(p)).status;

  expect(await status('/')).toBe(200);
  expect((await get('/')).headers.get('content-type')).toContain('text/html');
  expect((await get('/assets/app.js')).headers.get('cache-control')).toContain('immutable');
  for (const ok of ['/data/index.json', '/data/README.md', '/data/s/beauty/a.avif']) expect(await status(ok)).toBe(200);
  for (const bad of [
    '/data/fidelity.json',
    '/data/s/scene.json',
    '/data/../secret.txt',
    '/data/%2e%2e/secret.txt',
    '/nope',
  ])
    expect(await status(bad)).toBe(404);

  // CDN-facing headers: images are shared-cacheable with SWR; everything mutable revalidates.
  const img = await get('/data/s/beauty/a.avif');
  expect(img.headers.get('cache-control')).toBe(
    'public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400',
  );
  expect(img.headers.get('content-length')).toBe('3');
  expect(img.headers.get('content-type')).toBe('image/avif');
  expect(img.headers.get('etag')).toMatch(/^"/);
  expect(img.headers.get('last-modified')).toMatch(/GMT$/);
  expect(img.headers.get('vary')).toBeNull();
  expect((await get('/data/index.json')).headers.get('cache-control')).toBe('no-cache');
  expect((await get('/')).headers.get('cache-control')).toBe('no-cache');

  // validators: If-None-Match, and If-Modified-Since when there is no ETag
  const revalidate = async (h: Record<string, string>) =>
    (await createHandler(root, assets)(new Request('http://x/data/s/beauty/a.avif', { headers: h }))).status;
  expect(await revalidate({ 'if-none-match': img.headers.get('etag')! })).toBe(304);
  expect(await revalidate({ 'if-none-match': '"other"' })).toBe(200);
  expect(await revalidate({ 'if-modified-since': img.headers.get('last-modified')! })).toBe(304);
  expect(await revalidate({ 'if-modified-since': new Date(0).toUTCString() })).toBe(200);
});
