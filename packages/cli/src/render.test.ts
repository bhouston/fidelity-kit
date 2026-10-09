import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import yargs from 'yargs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { command } from './commands/render.js';
import { renderSuite, type RenderOptions } from './render.js';

vi.mock('puppeteer', () => ({ default: { launch: vi.fn() } }));
let root: string;
let options: RenderOptions;
let captures: { scene: string; renderer: string }[];
let close: ReturnType<typeof vi.fn>;
const registry = {
  schemaVersion: 1,
  title: 'Filtering fixture',
  renderServer: { developmentUrl: 'http://localhost:5173/', entry: 'render.html' },
  renderers: [
    { id: 'gpu-base', name: 'GPU base', params: { renderer: 'gpu-base' } },
    { id: 'gpu-other', name: 'GPU other', params: { renderer: 'gpu-other' } },
    { id: 'disabled', name: 'Disabled', enabled: false, params: { renderer: 'disabled' } },
    {
      id: 'native',
      name: 'Native',
      kind: 'external',
      command: [
        process.execPath,
        '-e',
        "require('node:fs').writeFileSync(process.argv[2], process.argv[1])",
        '{job}',
        '{output}',
      ],
    },
  ],
  scenes: [
    { id: 'box-small', name: 'Small box', path: 'group/box' },
    { id: 'box-large', name: 'Large box' },
    { id: 'sphere', name: 'Sphere' },
  ],
};
const relative = (scene: string) => (scene === 'box-small' ? 'group/box' : scene);
const output = (scene: string, renderer: string) => join(options.out, relative(scene), 'beauty', `${renderer}.avif`);
async function existing(scene: string, renderer: string) {
  const file = output(scene, renderer);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, 'existing image');
  return file;
}
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'kit-render-'));
  options = { registry: join(root, 'registry.json'), out: join(root, 'results') };
  await writeFile(options.registry, JSON.stringify(registry));
  captures = [];
  close = vi.fn();
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
  vi.mocked(puppeteer.launch).mockResolvedValue({
    close,
    newPage: async () => ({
      setViewport: vi.fn(),
      goto: async (url: string) => captures.push(JSON.parse(new URL(url).searchParams.get('fidelityKitParams')!)),
      waitForFunction: vi.fn(),
      evaluate: vi.fn(),
      close: vi.fn(),
      $: async () => ({ screenshot: async () => png }),
    }),
  } as unknown as Awaited<ReturnType<typeof puppeteer.launch>>);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it('keeps default enabled renderers and overwrites existing outputs without missing-only', async () => {
  const file = await existing('box-small', 'gpu-base');
  await renderSuite(options);
  expect(captures).toHaveLength(6);
  expect(captures.some((c) => c.renderer === 'disabled')).toBe(false);
  expect(await readFile(file, 'utf8')).not.toBe('existing image');
  expect(JSON.parse(await readFile(output('sphere', 'native'), 'utf8'))).toMatchObject({
    scenes: ['sphere'],
    renderer: 'native',
  });
  expect(close).toHaveBeenCalledOnce();
});
it('applies missing-only across browser and external renderers with no other filters', async () => {
  const browserFile = await existing('box-small', 'gpu-base');
  const nativeFile = await existing('sphere', 'native');
  await renderSuite({ ...options, missingOnly: true });
  expect(captures).toHaveLength(5);
  expect(captures).not.toContainEqual(expect.objectContaining({ scene: 'box-small', renderer: 'gpu-base' }));
  expect(await readFile(browserFile, 'utf8')).toBe('existing image');
  expect(await readFile(nativeFile, 'utf8')).toBe('existing image');
});
it('combines both glob filters with missing-only through the CLI', async () => {
  const file = await existing('box-small', 'gpu-base');
  await yargs()
    .command(command)
    .exitProcess(false)
    .parseAsync([
      'render',
      '--registry',
      options.registry,
      '--out',
      options.out,
      '--renderers',
      'gpu-*',
      '--scenes',
      'box-*',
      '--missing-only',
    ]);
  expect(captures.map(({ scene, renderer }) => [scene, renderer])).toEqual([
    ['box-large', 'gpu-base'],
    ['box-small', 'gpu-other'],
    ['box-large', 'gpu-other'],
  ]);
  expect(await readFile(file, 'utf8')).toBe('existing image');
  expect(await readdir(options.out)).toEqual(['box-large', 'group']);
});
it('supports a renderer glob alone and explicitly selected disabled renderers', async () => {
  await renderSuite({ ...options, renderers: 'disabled' });
  expect(captures.map((c) => c.renderer)).toEqual(['disabled', 'disabled', 'disabled']);
});
it('supports a scene glob alone', async () => {
  await renderSuite({ ...options, scenes: 'sphere' });
  expect(captures.map((c) => c.scene)).toEqual(['sphere', 'sphere']);
  expect(JSON.parse(await readFile(output('sphere', 'native'), 'utf8'))).toMatchObject({ scenes: ['sphere'] });
});
it('does not launch Chrome or external jobs when every selected output exists', async () => {
  for (const scene of registry.scenes)
    for (const renderer of registry.renderers.filter((r) => r.enabled !== false)) await existing(scene.id, renderer.id);
  await renderSuite({ ...options, missingOnly: true });
  expect(puppeteer.launch).not.toHaveBeenCalled();
  for (const scene of registry.scenes)
    expect(await readFile(output(scene.id, 'native'), 'utf8')).toBe('existing image');
});
it('does not launch Chrome for missing external jobs when browser outputs exist', async () => {
  await existing('sphere', 'gpu-base');
  await renderSuite({ ...options, scenes: 'sphere', renderers: 'gpu-base,native', missingOnly: true });
  expect(puppeteer.launch).not.toHaveBeenCalled();
  expect(JSON.parse(await readFile(output('sphere', 'native'), 'utf8'))).toMatchObject({ scenes: ['sphere'] });
});
it('intersects legacy exact-ID filters with new glob filters', async () => {
  await renderSuite({ ...options, renderer: ['gpu-base'], scene: ['box-large'], renderers: 'gpu-*', scenes: 'box-*' });
  expect(captures).toEqual([expect.objectContaining({ renderer: 'gpu-base', scene: 'box-large' })]);
});
it('reports unmatched patterns before rendering and rejects empty intersections', async () => {
  await expect(renderSuite({ ...options, scenes: 'box-*,typo*' })).rejects.toThrow('No scene matches "typo*"');
  await expect(renderSuite({ ...options, renderers: 'typo*' })).rejects.toThrow('No renderer matches "typo*"');
  await expect(renderSuite({ ...options, scene: ['sphere'], scenes: 'box-*' })).rejects.toThrow(
    'No scenes or renderers match',
  );
  expect(puppeteer.launch).not.toHaveBeenCalled();
});

it('shares policy overrides with browser and external jobs and honours producer lanes', async () => {
  await writeFile(
    options.registry,
    JSON.stringify({
      ...registry,
      renderers: registry.renderers.map((r) => (r.id === 'native' ? { ...r, captureLane: 'cpu' } : r)),
    }),
  );
  await renderSuite({
    ...options,
    scenes: 'sphere',
    renderers: 'gpu-base,native',
    captureParams: { samples: 256, noiseThreshold: 0.005 },
  });
  expect(captures[0]).toMatchObject({ samples: 256, noiseThreshold: 0.005 });
  expect(JSON.parse(await readFile(output('sphere', 'native'), 'utf8'))).toMatchObject({
    samples: 256,
    noiseThreshold: 0.005,
    captureLane: 'cpu',
  });
  await expect(renderSuite({ ...options, captureParams: { scene: 'other' } })).rejects.toThrow('cannot override scene');
});

it('rejects CPU overrides for scenes requiring GPU export before running jobs', async () => {
  await writeFile(
    options.registry,
    JSON.stringify({ ...registry, scenes: registry.scenes.map((s) => ({ ...s, externalCaptureLane: 'gpu' })) }),
  );
  await expect(renderSuite({ ...options, renderers: 'native', scenes: 'sphere', externalLane: 'cpu' })).rejects.toThrow(
    'requires the gpu export lane',
  );
  expect(puppeteer.launch).not.toHaveBeenCalled();
});
