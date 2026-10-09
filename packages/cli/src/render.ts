import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { selectNames } from './select.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { parseRegistry, rendererParams, rendererUrl } from './registry.js';
import { runCaptureLanes } from './capture-lanes.js';
import { chromeFlags } from './performance/schedule.js';

export interface RenderOptions {
  registry: string;
  rootUrl?: string;
  out: string;
  renderer?: string[];
  scene?: string[];
  /** Comma-separated globs matched against registry IDs. */
  renderers?: string;
  scenes?: string;
  missingOnly?: boolean;
  executablePath?: string;
  chromeArgs?: string[];
  headful?: boolean;
  frames?: number;
  /** Project-owned capture policy overrides, excluding identity and viewport settings. */
  captureParams?: Record<string, unknown>;
  externalLane?: 'cpu' | 'gpu';
}
/** Fidelity has no machine dimension; every browser capture uses the same host as performance and live. */
export async function renderSuite(options: RenderOptions) {
  for (const key of ['renderer', 'scene', 'width', 'height', 'frames'])
    if (key in (options.captureParams ?? {})) throw new Error(`Capture parameters cannot override ${key}`);
  const suite = parseRegistry(JSON.parse(await readFile(resolve(options.registry), 'utf8')));
  const sceneIds =
    options.scenes === undefined
      ? undefined
      : selectNames(
          suite.scenes.map((s) => s.id),
          options.scenes,
          'scene',
        );
  const rendererIds =
    options.renderers === undefined
      ? undefined
      : selectNames(
          suite.renderers.map((r) => r.id),
          options.renderers,
          'renderer',
        );
  const scenes = suite.scenes.filter(
    (s) => (!options.scene || options.scene.includes(s.id)) && (!sceneIds || sceneIds.includes(s.id)),
  );
  const renderers = suite.renderers.filter(
    (r) =>
      (options.renderer ? options.renderer.includes(r.id) : rendererIds ? true : r.enabled) &&
      (!rendererIds || rendererIds.includes(r.id)),
  );
  if (!scenes.length || !renderers.length) throw new Error('No scenes or renderers match');
  const jobs = [];
  for (const renderer of renderers)
    for (const scene of scenes) {
      const relative = scene.path ?? scene.id;
      if (relative.split(/[\\/]/).some((s) => s === '..' || s.startsWith('.')) || relative.startsWith('/'))
        throw new Error(`Unsafe scene path ${relative}`);
      const file = join(resolve(options.out), relative, 'beauty', `${renderer.id}.avif`);
      if (options.missingOnly && existsSync(file)) {
        console.log(`${scene.id} / ${renderer.id}: skipped (image already exists)`);
        continue;
      }
      jobs.push({ renderer, scene, file });
    }
  const browserRenderers = jobs.filter(({ renderer }) => renderer.kind === 'browser');
  const browser = browserRenderers.length
    ? await puppeteer.launch({
        headless: !options.headful,
        executablePath: options.executablePath,
        args: [...chromeFlags('on'), ...(options.chromeArgs ?? [])],
      })
    : undefined;
  try {
    await runCaptureLanes(
      jobs,
      ({ renderer, scene }) => {
        if (
          renderer.kind === 'external' &&
          options.externalLane &&
          scene.externalCaptureLane &&
          options.externalLane !== scene.externalCaptureLane
        )
          throw new Error(`Scene ${scene.id} requires the ${scene.externalCaptureLane} export lane`);
        const lane =
          renderer.kind === 'browser'
            ? 'gpu'
            : (options.externalLane ?? scene.externalCaptureLane ?? renderer.captureLane ?? 'gpu');
        return lane === 'either' ? ['cpu', 'gpu'] : [lane];
      },
      async ({ renderer, scene, file }, lane) => {
        await mkdir(dirname(file), { recursive: true });
        const params: Record<string, unknown> & { width: number; height: number; frames: number } = {
          seed: 1,
          ...rendererParams(suite, renderer.id, scene.id),
          ...options.captureParams,
          width: scene.fidelity.width,
          height: scene.fidelity.height,
          frames: options.frames ?? scene.fidelity.frames,
        };
        console.log(`${scene.id} / ${renderer.id}`);
        if (renderer.kind === 'external') {
          const job = {
            ...params,
            captureLane: lane,
            renderer: renderer.id,
            scenes: [scene.id],
            outDir: resolve(options.out),
            samples: typeof params.samples === 'number' ? params.samples : params.frames,
            width: params.width,
            height: params.height,
          };
          const [command, ...args] = renderer.command!;
          await promisify(execFile)(
            command!,
            args.map((arg) => arg.replaceAll('{job}', JSON.stringify(job)).replaceAll('{output}', file)),
            { maxBuffer: 16 * 1024 * 1024 },
          );
          return;
        }
        const page = await browser!.newPage();
        try {
          await page.setViewport({ width: params.width, height: params.height, deviceScaleFactor: 1 });
          const url = rendererUrl(suite, 'development', options.rootUrl);
          url.searchParams.set('fidelityKitMode', 'capture');
          url.searchParams.set('fidelityKitParams', JSON.stringify(params));
          await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForFunction(() => '__fidelityKitCapture' in window || '__fidelityKitError' in window, {
            timeout: 300000,
          });
          await page.evaluate(() => {
            const error = (window as unknown as { __fidelityKitError?: string }).__fidelityKitError;
            if (error) throw new Error(error);
          });
          const canvas = await page.$('canvas');
          if (!canvas) throw new Error('Render host did not produce a canvas');
          // Compositor readback works after GPU completion, including canvases without preserved drawing buffers.
          const image = await canvas.screenshot({ type: 'png' });
          await sharp(image).avif({ quality: 90, chromaSubsampling: '4:4:4' }).toFile(file);
        } finally {
          await page.close();
        }
      },
    );
  } finally {
    await browser?.close();
  }
}
