import { mkdir, mkdtemp, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { expect, test } from 'vitest';
import { createHandler, serve } from './server.js';

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

test('uses the next open port when the default is occupied', async () => {
  const blocker = createServer();
  const blocked = await new Promise<boolean>((resolve, reject) => {
    blocker.once('error', (error: NodeJS.ErrnoException) =>
      error.code === 'EADDRINUSE' ? resolve(false) : reject(error),
    );
    blocker.listen(3000, '127.0.0.1', () => resolve(true));
  });
  try {
    const server = await serve(async () => new Response('viewer'), undefined, '127.0.0.1');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
      expect(address.port).toBeGreaterThan(3000);
      expect(await (await fetch(`http://127.0.0.1:${address.port}/`)).text()).toBe('viewer');
    } finally {
      await close(server);
    }
  } finally {
    if (blocked) await close(blocker);
  }
});

test('does not change an explicitly requested occupied port', async () => {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  try {
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    await expect(serve(async () => new Response('viewer'), address.port, '127.0.0.1')).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
  } finally {
    await close(blocker);
  }
});

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
  const get = async (p: string) => createHandler(root, { assets })(new Request(`http://x${p}`));
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
    (await createHandler(root, { assets })(new Request('http://x/data/s/beauty/a.avif', { headers: h }))).status;
  expect(await revalidate({ 'if-none-match': img.headers.get('etag')! })).toBe(304);
  expect(await revalidate({ 'if-none-match': '"other"' })).toBe(200);
  expect(await revalidate({ 'if-modified-since': img.headers.get('last-modified')! })).toBe(304);
  expect(await revalidate({ 'if-modified-since': new Date(0).toUTCString() })).toBe(200);
});

test('does not serve allowlisted paths through symlinks outside the suite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fk-link-'));
  const root = join(dir, 'root');
  const assets = join(dir, 'assets');
  await mkdir(root);
  await mkdir(assets);
  await writeFile(join(assets, 'index.html'), '<html>');
  await writeFile(join(dir, 'secret.txt'), 'secret');
  await symlink(join(dir, 'secret.txt'), join(root, 'README.md'));
  const handler = createHandler(root, { assets });
  expect((await handler(new Request('http://x/data/README.md'))).status).toBe(404);
});

test('dev mode serves everything fresh: no validators, no caching, conditionals ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fk-dev-'));
  const [root, assets] = [join(dir, 'root'), join(dir, 'assets')];
  await mkdir(join(root, 's', 'beauty'), { recursive: true });
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, 'index.html'), '<html>');
  await writeFile(join(root, 'index.json'), '{}');
  const image = join(root, 's', 'beauty', 'a.avif');
  await writeFile(image, 'one');
  const dev = createHandler(root, { assets, dev: true });
  const get = (p: string, headers: Record<string, string> = {}) => dev(new Request(`http://x${p}`, { headers }));

  for (const p of ['/', '/data/index.json', '/data/s/beauty/a.avif']) {
    const res = await get(p);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('last-modified')).toBeNull();
  }
  const future = new Date(Date.now() + 60_000).toUTCString();
  expect((await get('/data/s/beauty/a.avif', { 'if-none-match': '*', 'if-modified-since': future })).status).toBe(200);
  expect((await get('/data/nope.avif')).status).toBe(404);

  // a modified image is visible on the very next request, with a new size
  await writeFile(image, 'changed!');
  const after = await get('/data/s/beauty/a.avif');
  expect(await after.text()).toBe('changed!');
  expect(after.headers.get('content-length')).toBe('8');
});

async function hashedSuite(prepare?: (root: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'fk-hsh-'));
  const [root, assets] = [join(dir, 'root'), join(dir, 'assets')];
  await mkdir(join(root, 's', 'beauty'), { recursive: true });
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, 'index.html'), '<html>');
  await writeFile(join(root, 'index.json'), '{}');
  await writeFile(join(root, 's', 'beauty', 'a.avif'), 'one');
  await writeFile(join(root, 's', 'beauty', 'b.avif'), 'two2');
  await prepare?.(root);
  return { root, assets };
}
const SHORT = 'public, max-age=300, stale-while-revalidate=86400, stale-if-error=86400';
const IMMUTABLE = 'public, max-age=31536000, immutable';
const A = '/data/s/beauty/a.avif';

test('?v is immutable only when it matches the current hash; the listing grows as images are hashed', async () => {
  const { root, assets } = await hashedSuite();
  const h = createHandler(root, { assets });
  const get = (p: string, headers: Record<string, string> = {}) => h(new Request(`http://x${p}`, { headers }));

  const empty = await get('/data/image-hashes.json');
  expect(await empty.json()).toEqual({});
  expect(empty.headers.get('cache-control')).toBe('no-cache');
  expect(empty.headers.get('content-type')).toBe('application/json');

  const first = await get(A);
  const hash = first.headers.get('etag')!.slice(1, -1);
  expect(first.headers.get('cache-control')).toBe(SHORT);
  expect((await get(`${A}?v=${hash}`)).headers.get('cache-control')).toBe(IMMUTABLE);
  expect((await get(`${A}?v=bogus`)).headers.get('cache-control')).toBe(SHORT);
  expect((await get('/data/s/beauty/b.avif?v=' + hash)).headers.get('cache-control')).toBe(SHORT);
  expect((await get('/data/index.json?v=' + hash)).headers.get('cache-control')).toBe('no-cache');

  const list = await get('/data/image-hashes.json');
  expect(await list.json()).toEqual({ 's/beauty/a.avif': hash, 's/beauty/b.avif': expect.any(String) });
  const etag = list.headers.get('etag')!;
  expect(etag).not.toBe(empty.headers.get('etag'));
  expect((await get('/data/image-hashes.json', { 'if-none-match': etag })).status).toBe(304);

  // a changed file drops out of the listing and its old version is no longer immutable
  await writeFile(join(root, 's', 'beauty', 'a.avif'), 'changed');
  expect(Object.keys((await (await get('/data/image-hashes.json')).json()) as object)).toEqual(['s/beauty/b.avif']);
  expect((await get(`${A}?v=${hash}`)).headers.get('cache-control')).toBe(SHORT);
});

test('image-hashes.json pre-populates the map; entries with a different size or mtime are discarded', async () => {
  const { root, assets } = await hashedSuite(async (r) => {
    const [a, b] = ['a', 'b'].map((n) => join(r, 's', 'beauty', `${n}.avif`));
    const [sa, sb] = await Promise.all([stat(a!), stat(b!)]);
    await writeFile(
      join(r, 'image-hashes.json'),
      JSON.stringify({
        version: 1,
        files: {
          // deliberately not the real hash: proves the file is trusted instead of re-read
          's/beauty/a.avif': { hash: 'prepopulated', size: sa.size, mtimeMs: sa.mtimeMs },
          's/beauty/b.avif': { hash: 'stale', size: sb.size, mtimeMs: sb.mtimeMs + 1 },
        },
      }),
    );
  });
  const h = createHandler(root, { assets });
  const get = (p: string) => h(new Request(`http://x${p}`));
  expect(await (await get('/data/image-hashes.json')).json()).toEqual({ 's/beauty/a.avif': 'prepopulated' });
  const a = await get(A);
  expect(a.headers.get('etag')).toBe('"prepopulated"');
  expect((await get(`${A}?v=prepopulated`)).headers.get('cache-control')).toBe(IMMUTABLE);
  const b = await get('/data/s/beauty/b.avif');
  expect(b.headers.get('etag')).not.toMatch(/stale/);
  expect((await get('/data/s/beauty/b.avif?v=stale')).headers.get('cache-control')).toBe(SHORT);
  expect((await get('/data/image-hashes.json')).status).toBe(200);
});

test('dev mode never hashes: listing is empty, ?v is ignored, the hash file is not loaded', async () => {
  const { root, assets } = await hashedSuite(async (r) => {
    const s = await stat(join(r, 's', 'beauty', 'a.avif'));
    await writeFile(
      join(r, 'image-hashes.json'),
      JSON.stringify({ version: 1, files: { 's/beauty/a.avif': { hash: 'h', size: s.size, mtimeMs: s.mtimeMs } } }),
    );
  });
  const h = createHandler(root, { assets, dev: true });
  const list = await h(new Request('http://x/data/image-hashes.json'));
  expect(list.status).toBe(200);
  expect(await list.json()).toEqual({});
  expect(list.headers.get('cache-control')).toBe('no-store');
  expect(list.headers.get('etag')).toBeNull();
  const img = await h(new Request(`http://x${A}?v=h`));
  expect(img.status).toBe(200);
  expect(img.headers.get('cache-control')).toBe('no-store');
  expect(img.headers.get('etag')).toBeNull();
});

test('serves, caches, and lists hashes for every supported image format', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fk-formats-'));
  const dir = join(root, 's/beauty');
  await mkdir(dir, { recursive: true });
  const formats = { avif: 'image/avif', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };
  const handler = createHandler(root);
  const devHandler = createHandler(root, { dev: true });
  const get = (path: string) => handler(new Request(`http://x/data/${path}`));
  for (const [extension, type] of Object.entries(formats)) {
    const path = `s/beauty/a.${extension}`;
    await writeFile(join(root, path), extension);
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(type);
    expect(response.headers.get('cache-control')).toContain('max-age=300');
    await response.body?.cancel();
    const hashes = (await (await get('image-hashes.json')).json()) as Record<string, string>;
    expect(hashes[path]).toBeTruthy();
    const versioned = await get(`${path}?v=${hashes[path]}`);
    expect(versioned.headers.get('cache-control')).toContain('immutable');
    await versioned.body?.cancel();
    const fresh = await devHandler(new Request(`http://x/data/${path}`));
    expect(fresh.headers.get('content-type')).toBe(type);
    expect(fresh.headers.get('cache-control')).toBe('no-store');
    await fresh.body?.cancel();
  }
  for (const name of ['a.vs-ref.delta.webp.json', 'a.webp.tmp']) {
    await writeFile(join(dir, name), '{}');
    expect((await get(`s/beauty/${name}`)).status).toBe(404);
  }
});
