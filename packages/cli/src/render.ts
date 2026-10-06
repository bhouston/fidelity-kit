import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { parseRegistry, rendererParams, rendererUrl } from './registry.js';
import { chromeFlags } from './performance/schedule.js';

export interface RenderOptions {
  registry: string;
  rootUrl?: string;
  out: string;
  renderer?: string[];
  scene?: string[];
  executablePath?: string;
  chromeArgs?: string[];
  headful?: boolean;
  frames?: number;
}
/** Fidelity has no machine dimension; every browser capture uses the same host as performance and live. */
export async function renderSuite(options: RenderOptions) {
  const suite = parseRegistry(JSON.parse(await readFile(resolve(options.registry), 'utf8')));
  const scenes = suite.scenes.filter((s) => !options.scene || options.scene.includes(s.id));
  const renderers = suite.renderers.filter((r) => (options.renderer ? options.renderer.includes(r.id) : r.enabled));
  if (!scenes.length || !renderers.length) throw new Error('No scenes or renderers match');
  const browserRenderers = renderers.filter((r) => r.kind === 'browser');
  const browser = browserRenderers.length
    ? await puppeteer.launch({
        headless: !options.headful,
        executablePath: options.executablePath,
        args: [...chromeFlags('on'), ...(options.chromeArgs ?? [])],
      })
    : undefined;
  try {
    for (const renderer of renderers)
      for (const scene of scenes) {
        const relative = scene.path ?? scene.id;
        if (relative.split(/[\\/]/).some((s) => s === '..' || s.startsWith('.')) || relative.startsWith('/'))
          throw new Error(`Unsafe scene path ${relative}`);
        const file = join(resolve(options.out), relative, 'beauty', `${renderer.id}.avif`);
        await mkdir(dirname(file), { recursive: true });
        const params = {
          seed: 1,
          ...rendererParams(suite, renderer.id, scene.id),
          width: scene.fidelity.width,
          height: scene.fidelity.height,
          frames: options.frames ?? scene.fidelity.frames,
        };
        console.log(`${scene.id} / ${renderer.id}`);
        if (renderer.kind === 'external') {
          const job = {
            renderer: renderer.id,
            scenes: [scene.id],
            outDir: resolve(options.out),
            samples: typeof renderer.params.samples === 'number' ? renderer.params.samples : params.frames,
            width: params.width,
            height: params.height,
          };
          const [command, ...args] = renderer.command!;
          await promisify(execFile)(
            command!,
            args.map((arg) => arg.replaceAll('{job}', JSON.stringify(job)).replaceAll('{output}', file)),
            { maxBuffer: 16 * 1024 * 1024 },
          );
          continue;
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
      }
  } finally {
    await browser?.close();
  }
}
