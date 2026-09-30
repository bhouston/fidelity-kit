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
});
