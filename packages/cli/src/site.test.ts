import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { prepareSite, copyPerformance, watchPerformance } from './site.js';
import { writeMachine, writeRun } from './performance/storage.js';
import type { RunResult } from './schema/index.js';

const temporary: string[] = [];
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'unified-publication-'));
  temporary.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const registry = {
  schemaVersion: 1,
  title: 'Cube laboratory',
  renderServer: {
    developmentUrl: 'http://localhost:5173/local/',
    deployedUrl: 'https://renderer.test/gpu/',
    entry: 'render.html',
  },
  renderers: [{ id: 'cube', name: 'Cube Renderer', reference: true, params: { quality: 3 } }],
  scenes: [{ id: 'spinning-cube', name: 'Spinning Cube' }],
};
const run: RunResult = {
  schemaVersion: 1,
  runId: 'initial',
  entry: {
    id: 'cube',
    name: 'Cube',
    url: '/render.html',
    renderer: { id: 'cube', name: 'Cube Renderer' },
    scene: { id: 'spinning-cube', name: 'Spinning Cube' },
  },
  networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
  config: { durationMs: 5000, vsync: 'off' },
  harness: { teardown: 7 },
  reporter: {
    navigationStart: 0,
    ready: 0.1,
    renderStart: 0.1,
    runStart: 1,
    runEnd: 6,
    frames: [],
    throughput: { completedFrames: 200, elapsed: 5 },
  },
  status: 'ok',
};
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));

describe('unified website publication contracts', () => {
  it('exports only the deployed render endpoint and canonical renderer definitions while preserving fidelity outputs', async () => {
    const root = await directory(),
      file = join(await directory(), 'registry.json');
    const outputs = [
      { id: 'beauty', label: 'Beauty' },
      { id: 'ao', label: 'Occlusion' },
    ];
    await writeFile(file, JSON.stringify(registry));
    await writeFile(
      join(root, 'fidelity.json'),
      JSON.stringify({ title: 'Old title', renderers: [{ id: 'obsolete' }], outputs }),
    );
    await prepareSite(root, { registry: file }, 'deployed');
    const site = await json(join(root, 'site.json'));
    expect(site.rendererUrl).toBe('https://renderer.test/gpu/render.html');
    expect(JSON.stringify(site)).not.toContain('localhost');
    expect(site.registry.renderers[0].params.quality).toBe(3);
    const fidelity = await json(join(root, 'fidelity.json'));
    expect(fidelity).toEqual({
      title: 'Cube laboratory',
      renderers: [{ id: 'cube', label: 'Cube Renderer', reference: true, enabled: true }],
      outputs,
    });
    expect(fidelity).not.toHaveProperty('machines');
    await prepareSite(root, { registry: file, rootUrl: 'https://other.test/nested' }, 'deployed');
    expect((await json(join(root, 'site.json'))).rendererUrl).toBe('https://other.test/nested/render.html');
    await prepareSite(root, { registry: file }, 'development');
    expect((await json(join(root, 'site.json'))).rendererUrl).toBe('http://localhost:5173/local/render.html');
  });

  it('fails a deployment without an endpoint before replacing existing results metadata', async () => {
    const root = await directory(),
      file = join(await directory(), 'registry.json');
    const original = '{"title":"Existing results"}';
    await writeFile(join(root, 'fidelity.json'), original);
    await writeFile(file, JSON.stringify({ ...registry, renderServer: { developmentUrl: 'http://localhost:5173/' } }));
    await expect(prepareSite(root, { registry: file }, 'deployed')).rejects.toThrow('deployedUrl');
    expect(await readFile(join(root, 'fidelity.json'), 'utf8')).toBe(original);
    await expect(readFile(join(root, 'site.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('publishes current metrics, machine identity and reference assets without exposing raw traces or unlisted files', async () => {
    const source = await directory(),
      root = await directory();
    await writeMachine(source, { id: 'machine-a', name: 'Benchmark workstation' });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } })
      .png()
      .toBuffer();
    const referenceRun = structuredClone(run);
    referenceRun.reporter.convergence = {
      width: 2,
      height: 2,
      interval: 0.25,
      targetPsnr: 30,
      samples: [{ at: 2, frame: 40, mse: 0, psnr: null }],
    };
    await writeRun(source, 'machine-a', referenceRun, png, png);
    const folder = join(source, 'machine-a/cube/spinning-cube');
    await writeFile(join(folder, 'raw.json'), 'private diagnostic trace');
    await writeFile(join(folder, 'unlisted.avif'), 'private asset');
    await writeFile(join(source, 'README.md'), '# Benchmark suite');
    await writeFile(join(root, 'fidelity.json'), '{"title":"Fidelity"}');
    await copyPerformance(root, source);
    const published = join(root, 'performance'),
      index = await json(join(published, 'index.json'));
    expect(index.machines).toEqual([{ id: 'machine-a', name: 'Benchmark workstation' }]);
    expect(index.liveReload).toBe(false);
    expect(index.results[0].reference).toBe('machine-a/cube/spinning-cube/reference.png');
    expect(await readFile(join(published, index.results[0].reference))).toEqual(png);
    expect((await json(join(published, index.results[0].metrics))).statistics.averageFps).toBe(40);
    expect(await readFile(join(published, 'README.md'), 'utf8')).toBe('# Benchmark suite');
    const files = await readdir(published, { recursive: true });
    expect(files.some((file) => file.includes('raw.json') || file.includes('unlisted.avif'))).toBe(false);
    expect(await readFile(join(root, 'fidelity.json'), 'utf8')).toBe('{"title":"Fidelity"}');

    // A new benchmark without reference/capture must withdraw the previously published assets.
    await writeRun(source, 'machine-a', { ...structuredClone(run), runId: 'replacement' });
    await rm(join(source, 'README.md'));
    await copyPerformance(root, source);
    for (const name of ['screenshot.avif', 'reference.png', 'diff.png'])
      await expect(readFile(join(published, 'machine-a/cube/spinning-cube', name))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    await expect(readFile(join(published, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(join(folder, 'metrics.json'));
    await copyPerformance(root, source);
    expect((await json(join(published, 'index.json'))).results).toEqual([]);
    await expect(readFile(join(published, 'machine-a/cube/spinning-cube/metrics.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects overlapping publication/source directories', async () => {
    const root = await directory();
    await expect(copyPerformance(root, join(root, 'performance'))).rejects.toThrow();
    await expect(copyPerformance(root, root)).rejects.toThrow();
  });

  it('refreshes changed benchmark metrics and stops observing after close', async () => {
    const source = await directory(),
      root = await directory();
    await writeRun(source, 'machine-a', structuredClone(run));
    await copyPerformance(root, source);
    const watcher = await watchPerformance(root, source);
    const file = join(root, 'performance/machine-a/cube/spinning-cube/metrics.json');
    try {
      await writeRun(source, 'machine-a', { ...structuredClone(run), runId: 'changed' });
      await expect.poll(async () => (await json(file)).runId, { timeout: 10000 }).toBe('changed');
    } finally {
      await watcher.close();
    }
    await writeRun(source, 'machine-a', { ...structuredClone(run), runId: 'after-close' });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect((await json(file)).runId).toBe('changed');
  }, 15000);
});
