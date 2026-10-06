import { it, expect } from 'vitest';
import sharp from 'sharp';
import { RESULT_AVIF } from './capture.js';
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  atomicWrite,
  writeRun,
  scanResults,
  safeEntryId,
  buildReport,
  processResults,
  processResult,
  readReportIndex,
  writeMachine,
} from './storage.js';
import type { RunResult } from '../schema/index.js';
it('rejects nested result and site directories before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-separate-'));
  try {
    await expect(buildReport(root, join(root, 'site'))).rejects.toThrow('must be separate');
    await expect(buildReport(join(root, 'results'), root)).rejects.toThrow('must be separate');
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('atomically replaces a file using native absolute paths without leaving temporary files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-atomic-'));
  try {
    const folder = join(root, 'nested folder');
    const file = join(folder, 'index.json');
    await atomicWrite(file, 'original');
    await atomicWrite(file, new Uint8Array([114, 101, 112, 108, 97, 99, 101, 100]));
    expect(await readFile(file, 'utf8')).toBe('replaced');
    expect(await readdir(folder)).toEqual(['index.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const result: RunResult = {
  schemaVersion: 1,
  runId: 'test',
  entry: {
    id: 'cube',
    name: 'Cube',
    renderer: { id: 'test', name: 'Test Renderer' },
    scene: { id: 'cube', name: 'Spinning cube' },
    url: '/cube',
  },
  networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
  config: { durationMs: 100, vsync: 'off' },
  harness: { teardown: 1200 },
  reporter: { frames: [] },
  status: 'timeout',
};
it('writes only flat AVIF/metrics files atomically and overwrites a workload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-flat-'));
  try {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    const file = await writeRun(root, 'mac', structuredClone(result), png);
    expect(file).toBe(join(root, 'mac/test/cube/metrics.json'));
    await expect(readFile(join(root, 'mac/test/cube/raw.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await sharp(join(root, 'mac/test/cube/screenshot.avif')).metadata()).hasAlpha).toBe(false);
    expect(RESULT_AVIF).toEqual({ quality: 90, chromaSubsampling: '4:4:4' });
    const index = await readReportIndex(root);
    expect(index).toEqual({
      schemaVersion: 2,
      machines: [{ id: 'mac', name: 'mac' }],
      results: [
        {
          machine: { id: 'mac', name: 'mac' },
          renderer: result.entry.renderer,
          scene: result.entry.scene,
          metrics: 'mac/test/cube/metrics.json',
          screenshot: 'mac/test/cube/screenshot.avif',
        },
      ],
    });
    expect(JSON.stringify(index)).not.toContain('reporter');
    const processed = JSON.parse(await readFile(join(root, 'mac/test/cube/metrics.json'), 'utf8'));
    expect(processed.status).toBe('timeout');
    expect(processed.screenshot).toBe(true);
    expect(processed).not.toHaveProperty('reporter');
    const before = (await stat(join(root, 'mac/test/cube/metrics.json'))).mtimeMs;
    await processResults(root);
    expect((await stat(join(root, 'mac/test/cube/metrics.json'))).mtimeMs).toBe(before);
    await writeRun(root, 'mac', { ...structuredClone(result), runId: 'replacement' });
    expect(JSON.parse(await readFile(file, 'utf8')).runId).toBe('replacement');
    expect((await scanResults(root)).runs).toHaveLength(1);
    await expect(readFile(join(root, 'mac/test/cube/screenshot.avif'))).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(file);
    await processResult(root, 'mac', 'test', 'cube');
    expect((await readReportIndex(root)).results).toEqual([]);
    await expect(readFile(join(root, 'mac/test/cube/metrics.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('rejects old metrics instead of migrating raw files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-format-'));
  try {
    const file = await writeRun(root, 'mac', structuredClone(result));
    await writeFile(file, JSON.stringify({ schemaVersion: 1 }));
    await writeFile(join(root, 'mac/test/cube/raw.json'), JSON.stringify(result));
    await expect(processResults(root)).rejects.toThrow('Invalid processed result');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ schemaVersion: 1 });
    await rm(file);
    expect((await scanResults(root)).runs).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('rejects traversal IDs', () => {
  for (const id of ['../escape', 'a/b', '..', '/tmp/x']) expect(() => safeEntryId(id)).toThrow();
});
it('exports processed files and README without raw data and removes stale owned results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-readme-')),
    site = await mkdtemp(join(tmpdir(), 'performance-site-'));
  try {
    await writeRun(root, 'mac', structuredClone(result));
    await writeFile(join(root, 'README.md'), '# My benchmark\n\nSuite description.');
    await buildReport(root, site);
    expect(await readFile(join(site, 'README.md'), 'utf8')).toBe('# My benchmark\n\nSuite description.');
    expect(JSON.parse(await readFile(join(site, 'mac/test/cube/metrics.json'), 'utf8')).entry.renderer.id).toBe('test');
    await expect(readFile(join(site, 'mac/test/cube/raw.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(join(root, 'README.md'));
    await rm(join(root, 'mac/test/cube/metrics.json'));
    await buildReport(root, site);
    await expect(readFile(join(site, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(site, 'mac/test/cube/metrics.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(site, { recursive: true, force: true });
  }
});

it('treats metrics as canonical even when stale raw files remain, and rejects future versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-canonical-'));
  try {
    const file = await writeRun(root, 'mac', structuredClone(result));
    await writeFile(join(root, 'mac/test/cube/raw.json'), JSON.stringify({ ...result, runId: 'stale' }));
    await processResults(root);
    expect((await scanResults(root)).runs[0]?.result.runId).toBe('test');
    const metrics = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...metrics, schemaVersion: metrics.schemaVersion + 1 }));
    await expect(processResults(root)).rejects.toThrow('Invalid processed result');
    expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(metrics.schemaVersion + 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps convergence references and diffs portable and removes them when overwritten without a reference', async () => {
  const root = await mkdtemp(join(tmpdir(), 'convergence-assets-'));
  try {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } })
      .png()
      .toBuffer();
    const run = structuredClone(result);
    run.status = 'ok';
    run.reporter.runStart = 0.1;
    run.reporter.runEnd = 1;
    run.reporter.convergence = {
      width: 2,
      height: 2,
      interval: 0.25,
      targetPsnr: 30,
      samples: [{ at: 0.2, frame: 1, mse: 0, psnr: null }],
    };
    await writeRun(root, 'mac', run, png, png);
    const metrics = JSON.parse(await readFile(join(root, 'mac/test/cube/metrics.json'), 'utf8'));
    expect(metrics.convergence.timeToTarget).toBe(0.1);
    expect(metrics.convergence.reference).toBe('reference.png');
    expect((await readReportIndex(root)).results[0]).toMatchObject({
      reference: 'mac/test/cube/reference.png',
      diff: 'mac/test/cube/diff.png',
    });
    expect((await sharp(join(root, 'mac/test/cube/diff.png')).stats()).channels.every((c) => c.max === 0)).toBe(true);
    await buildReport(root, root + '-site');
    expect(await readFile(join(root + '-site', 'mac/test/cube/reference.png'))).toEqual(png);
    expect((await sharp(join(root + '-site', 'mac/test/cube/diff.png')).metadata()).width).toBe(2);
    await writeRun(root, 'mac', structuredClone(result));
    await buildReport(root, root + '-site');
    for (const name of ['reference.png', 'diff.png']) {
      await expect(readFile(join(root, 'mac/test/cube', name))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(root + '-site', 'mac/test/cube', name))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(root + '-site', { recursive: true, force: true });
  }
});

it('indexes results per machine folder with machine.json display names', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-machines-')),
    site = await mkdtemp(join(tmpdir(), 'performance-machines-site-'));
  try {
    await writeMachine(root, { id: 'laptop', name: 'MacBook Air M3' });
    await writeRun(root, 'laptop', structuredClone(result));
    const run = structuredClone(result);
    run.environment = {
      userAgent: 'test',
      gpuTimestampsAvailable: false,
      crossOriginIsolated: true,
      devicePixelRatio: 1,
      chromeFlags: [],
      host: { os: 'linux', cpu: 'Ryzen' },
    };
    await writeRun(root, 'desktop', run);
    expect(JSON.parse(await readFile(join(root, 'desktop/test/cube/metrics.json'), 'utf8')).environment.host).toEqual({
      os: 'linux',
      cpu: 'Ryzen',
      machineId: 'desktop',
    });
    const index = await processResults(root);
    expect(index.machines).toEqual([
      { id: 'desktop', name: 'desktop' },
      { id: 'laptop', name: 'MacBook Air M3' },
    ]);
    expect(index.results.map((item) => [item.machine.id, item.metrics])).toEqual([
      ['desktop', 'desktop/test/cube/metrics.json'],
      ['laptop', 'laptop/test/cube/metrics.json'],
    ]);
    await processResult(root, 'desktop', 'test', 'cube');
    expect((await readReportIndex(root)).results).toHaveLength(2);
    await buildReport(root, site);
    expect(JSON.parse(await readFile(join(site, 'laptop/test/cube/metrics.json'), 'utf8')).entry.scene.id).toBe('cube');
    await rm(join(root, 'desktop'), { recursive: true });
    await buildReport(root, site);
    await expect(readFile(join(site, 'desktop/test/cube/metrics.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(join(site, 'index.json'), 'utf8')).machines).toEqual([
      { id: 'laptop', name: 'MacBook Air M3' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(site, { recursive: true, force: true });
  }
});
it('rejects machine metadata or recorded machine IDs that do not match their folder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-machine-mismatch-'));
  try {
    await writeRun(root, 'mac', structuredClone(result));
    await writeFile(join(root, 'mac/machine.json'), JSON.stringify({ id: 'other', name: 'Other' }));
    await expect(processResults(root)).rejects.toThrow('Machine metadata does not match');
    await rm(join(root, 'mac/machine.json'));
    const file = join(root, 'mac/test/cube/metrics.json');
    const metrics = JSON.parse(await readFile(file, 'utf8'));
    metrics.environment = {
      userAgent: 'test',
      gpuTimestampsAvailable: false,
      crossOriginIsolated: true,
      devicePixelRatio: 1,
      chromeFlags: [],
      host: { os: 'linux', cpu: 'Ryzen', machineId: 'other' },
    };
    await writeFile(file, JSON.stringify(metrics));
    await expect(processResults(root)).rejects.toThrow('Result metadata does not match');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
