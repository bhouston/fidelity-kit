import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';
import sharp from 'sharp';
import { readRgb, RESULT_AVIF, type RawImage } from './core/compare.js';
import { compareSequences, type DynamicIndex, type TemporalRecord } from './core/temporal.js';
import { DYNAMIC_INDEX, temporalFile } from './core/paths.js';
import { parseRegistry, rendererParams, rendererUrl, type RenderingRegistry } from './registry.js';
import { selectNames } from './select.js';
import { downsample } from './supersample.js';
import { chromeFlags } from './performance/schedule.js';

export interface DynamicOptions {
  registry: string;
  rootUrl?: string;
  out: string;
  /** Comma-separated globs matched against registry IDs. */
  renderers?: string;
  scenes?: string;
  executablePath?: string;
  chromeArgs?: string[];
  headful?: boolean;
  /** Called with progress messages; defaults to console.log. */
  log?: (message: string) => void;
}

type Renderer = RenderingRegistry['renderers'][number];
type Scene = RenderingRegistry['scenes'][number];

const scenePath = (scene: Scene) => {
  const relative = scene.path ?? scene.id;
  if (relative.split(/[\\/]/).some((s) => s === '..' || s.startsWith('.')) || relative.startsWith('/'))
    throw new Error(`Unsafe scene path ${relative}`);
  return relative;
};

/** Renders one scene's sequence with one renderer in a fresh page and returns the measured frames. */
async function captureSequence(
  browser: Browser,
  suite: RenderingRegistry,
  renderer: Renderer,
  scene: Scene,
  rootUrl: string | undefined,
): Promise<RawImage[]> {
  const sequence = scene.dynamic!;
  const factor = renderer.supersample?.factor ?? 1;
  const params = {
    seed: 1,
    ...rendererParams(suite, renderer.id, scene.id),
    ...sequence.params,
    width: sequence.width * factor,
    height: sequence.height * factor,
    frames: sequence.frames,
    warmup: sequence.warmup,
    fps: sequence.fps,
  };
  const frames: RawImage[] = [];
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: params.width, height: params.height, deviceScaleFactor: 1 });
    await page.exposeFunction('__fidelityKitFrame', async (index: number, png: string) => {
      const raw = await readRgb(Buffer.from(png, 'base64'));
      frames[index] = renderer.supersample ? downsample(raw, renderer.supersample) : raw;
    });
    const url = rendererUrl(suite, 'development', rootUrl);
    url.searchParams.set('fidelityKitMode', 'dynamic');
    url.searchParams.set('fidelityKitParams', JSON.stringify(params));
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => '__fidelityKitDynamic' in window || '__fidelityKitError' in window, {
      timeout: 0,
      polling: 250,
    });
    await page.evaluate(() => {
      const error = (window as unknown as { __fidelityKitError?: string }).__fidelityKitError;
      if (error) throw new Error(error);
    });
  } finally {
    await page.close();
  }
  const measured = sequence.frames - sequence.warmup;
  if (frames.length !== measured || frames.some((frame) => !frame))
    throw new Error(
      `${scene.id} / ${renderer.id}: expected ${measured} frames, received ${frames.filter(Boolean).length}`,
    );
  for (const frame of frames)
    if (frame.width !== sequence.width || frame.height !== sequence.height)
      throw new Error(
        `${scene.id} / ${renderer.id}: frame is ${frame.width}x${frame.height}, expected ${sequence.width}x${sequence.height}`,
      );
  return frames;
}

async function writeFrame(file: string, frame: RawImage) {
  await mkdir(dirname(file), { recursive: true });
  await sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 3 } })
    .avif(RESULT_AVIF)
    .toFile(file);
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Declare the dynamic output in `fidelity.json` so `process` and the viewer pick up the representative frames. */
async function declareOutput(out: string, suite: RenderingRegistry, output: string) {
  type Config = { outputs?: { id: string; label?: string; kind?: string }[] } & Record<string, unknown>;
  const file = join(out, 'fidelity.json');
  const existing = await readJson<Config>(file);
  const config: Config = existing ?? {
    title: suite.title,
    renderers: suite.renderers.map((r) => ({ id: r.id, label: r.name, reference: r.reference, enabled: r.enabled })),
  };
  // An existing configuration without outputs implies `beauty`; a new one only declares the dynamic output.
  const outputs = config.outputs ?? (existing ? [{ id: 'beauty' }] : []);
  config.staticFidelity = suite.staticFidelity;
  config.outputs = outputs.some((o) => o.id === output)
    ? outputs.map((item) => (item.id === output ? { ...item, kind: 'temporal' } : item))
    : [...outputs, { id: output, label: 'Temporal fidelity', kind: 'temporal' }];
  await writeFile(file, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Dynamic (temporal) fidelity: per scene, renders the reference sequence and then each compared renderer's sequence
 * from a fresh page, scores every measured frame and writes representative frames, sidecars and `dynamic.json`.
 */
export async function captureDynamic(options: DynamicOptions) {
  const log = options.log ?? console.log;
  const suite = parseRegistry(JSON.parse(await readFile(resolve(options.registry), 'utf8')));
  const config = suite.dynamic;
  if (!config) throw new Error('The registry has no enabled temporal fidelity section');
  const out = resolve(options.out);
  const reference = suite.renderers.find((r) => r.id === config.reference)!;
  const candidates = config.renderers
    ? suite.renderers.filter((r) => config.renderers!.includes(r.id))
    : suite.renderers.filter((r) => r.kind === 'browser' && r.enabled && !r.reference);
  const rendererIds =
    options.renderers === undefined
      ? undefined
      : selectNames(
          candidates.map((r) => r.id),
          options.renderers,
          'renderer',
        );
  const renderers = candidates.filter((r) => !rendererIds || rendererIds.includes(r.id));
  const dynamicScenes = suite.scenes.filter((s) => s.dynamic);
  const sceneIds =
    options.scenes === undefined
      ? undefined
      : selectNames(
          dynamicScenes.map((s) => s.id),
          options.scenes,
          'scene',
        );
  const scenes = dynamicScenes.filter((s) => !sceneIds || sceneIds.includes(s.id));
  if (!scenes.length) throw new Error('No dynamic scenes match');
  await mkdir(out, { recursive: true });
  await declareOutput(out, suite, config.output);
  const indexFile = join(out, DYNAMIC_INDEX);
  const index: DynamicIndex = (await readJson<DynamicIndex>(indexFile)) ?? {
    schemaVersion: 1,
    output: config.output,
    reference: config.reference,
    results: {},
  };
  if (index.output !== config.output || index.reference !== config.reference)
    Object.assign(index, { output: config.output, reference: config.reference, results: {} });
  const browser = await puppeteer.launch({
    headless: !options.headful,
    executablePath: options.executablePath,
    args: [...chromeFlags('on'), ...(options.chromeArgs ?? [])],
    // Supersampled references of heavy effects can keep a page busy for minutes; sequences have no time limit.
    protocolTimeout: 0,
  });
  try {
    for (const scene of scenes) {
      const path = scenePath(scene);
      const folder = join(out, path, config.output);
      const sequence = scene.dynamic!;
      const measured = sequence.frames - sequence.warmup;
      const representative = Math.min(config.representativeFrame ?? measured - 1, measured - 1);
      log(`${scene.id} / ${reference.id} (reference)`);
      const referenceFrames = await captureSequence(browser, suite, reference, scene, options.rootUrl);
      await writeFrame(join(folder, `${reference.id}.avif`), referenceFrames[representative]!);
      for (const renderer of renderers) {
        if (sequence.renderers && !sequence.renderers.includes(renderer.id)) continue;
        log(`${scene.id} / ${renderer.id}`);
        const frames = await captureSequence(browser, suite, renderer, scene, options.rootUrl);
        const { summary, perFrame } = compareSequences(referenceFrames, frames);
        const generatedAt = new Date().toISOString();
        const record: TemporalRecord = {
          schemaVersion: 1,
          scene: path,
          renderer: renderer.id,
          reference: reference.id,
          output: config.output,
          width: sequence.width,
          height: sequence.height,
          fps: sequence.fps,
          warmup: sequence.warmup,
          summary,
          perFrame,
          generatedAt,
        };
        await writeFrame(join(folder, `${renderer.id}.avif`), frames[representative]!);
        await writeFile(join(folder, temporalFile(renderer.id)), JSON.stringify(record) + '\n');
        (index.results[path] ??= {})[renderer.id] = { ...summary, generatedAt };
        await writeFile(indexFile, JSON.stringify(index, null, 2) + '\n');
        const format = (value: number | null, digits = 2) => (value === null ? '∞' : value.toFixed(digits));
        log(
          `  PSNR ${format(summary.psnr)} dB, temporal PSNR ${format(summary.temporalPsnr)} dB, sharpness ${format(summary.sharpness, 3)}`,
        );
      }
    }
  } finally {
    await browser.close();
  }
  return index;
}
