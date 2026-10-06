import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { loadReference, referenceDiff } from './convergence.js';
it('loads suite-relative and HTTP references with identical normalized pixels', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'convergence-reference-'));
  const png = await sharp({ create: { width: 2, height: 1, channels: 3, background: '#102030' } })
    .png()
    .toBuffer();
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.end(png);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await writeFile(join(folder, 'reference.png'), png);
    const local = await loadReference('./reference.png', join(folder, 'registry.json'));
    const port = (server.address() as { port: number }).port;
    const remote = await loadReference(`http://127.0.0.1:${port}/image.png`, join(folder, 'registry.json'));
    expect(local).toEqual(remote);
    expect((await sharp(local).metadata()).channels).toBe(3);
    await expect(loadReference('file:///reference.png', join(folder, 'registry.json'))).rejects.toThrow(/local path/);
    const diff = await referenceDiff(local, remote);
    expect((await sharp(diff).stats()).channels.every((channel) => channel.max === 0)).toBe(true);
    const wrong = await sharp(png).resize(1, 1).png().toBuffer();
    await expect(referenceDiff(local, wrong)).rejects.toThrow(/dimensions/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(folder, { recursive: true, force: true });
  }
});
