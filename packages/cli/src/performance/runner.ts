import { createInterface } from 'node:readline/promises';
import { loadReference } from './convergence.js';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, hostname, platform, release } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer, { type Browser } from 'puppeteer';
import { ulid } from 'ulid';
import { assertMessageToHarness } from '../schema/index.js';
import type { RunResult, Environment } from '../schema/index.js';
import { configureNetwork, resolveNetworkProfile } from './network.js';
import { harnessRun } from './harness.js';
import { chromeFlags, isSoftwareAdapter, scheduleSuite } from './schedule.js';
import { loadSuite, safeEntryId, writeRun, atomicWrite, writeMachine, chooseBenchmarkSession } from './storage.js';
import { startServer } from './server.js';
export interface RunOptions {
  suite: string;
  rootUrl?: string;
  collection?: string;
  out: string;
  /** Results folder for this benchmark machine; defaults to a slug of the host name. */
  machine?: string;
  /** Resume an existing dated run, or `latest`. */
  session?: string;
  /** Start a new run without an interactive prompt. */
  newRun?: boolean;
  /** Display name saved in `<machine>/machine.json`, such as "MacBook Air M3". */
  machineName?: string;
  renderer?: string[];
  scene?: string[];
  headful?: boolean;
  live?: boolean;
  host?: string;
  port?: number;
  rendererRoot?: string;
  rendererPort?: number;
  seed?: number;
  cooldownMs?: number;
  recycle?: number;
  width?: number;
  height?: number;
  isolation?: 'iframe' | 'page';
  allowSoftware?: boolean;
  executablePath?: string;
  /** Extra Chrome command-line flags, such as `--use-angle=vulkan` for hardware WebGPU in headless Linux. */
  chromeArgs?: string[];
  /** Throughput measurements require off; capped runs are rejected. */
  vsync?: 'on' | 'off';
  failOnError?: boolean;
}
export async function deadline<T>(promise: Promise<T>, timeoutMs: number, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout during ${phase}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function defaultMachineId(name = hostname()): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[^a-z0-9]+|-+$/g, '') || 'local'
  );
}
export async function runSuite(options: RunOptions): Promise<{ out: string; session: string; results: RunResult[] }> {
  for (const [name, value] of [
    ['width', options.width],
    ['height', options.height],
    ['recycle', options.recycle],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1))
      throw new Error(`${name} must be a positive integer`);
  }
  if (options.cooldownMs !== undefined && (!Number.isFinite(options.cooldownMs) || options.cooldownMs < 0))
    throw new Error('cooldown-ms must be nonnegative');
  const suite = await loadSuite(options.suite, options.collection);
  const suiteSource = JSON.parse(await readFile(options.suite, 'utf8')) as {
    renderServer?: { developmentUrl: string };
  };
  const isolation = options.isolation ?? (suiteSource.renderServer ? 'page' : 'iframe');
  const rootUrl = options.rootUrl ?? suiteSource.renderServer?.developmentUrl;
  const networkProfile = resolveNetworkProfile(suite);
  const schedule = scheduleSuite(suite, options);
  if (!schedule.length) throw new Error('No suite entries match the filters');
  for (const { entry } of schedule) safeEntryId(entry.id);
  const out = resolve(options.out);
  const machineId = safeEntryId(options.machine ?? defaultMachineId());
  const ask =
    process.stdin.isTTY && process.stdout.isTTY
      ? async (latest: string): Promise<'new' | 'existing'> => {
          const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try {
            for (;;) {
              const answer = (
                await prompt.question(
                  `Latest run: ${latest} UTC. Create a [n]ew run or [a]dd to the existing run? [n/a] `,
                )
              )
                .trim()
                .toLowerCase();
              if (['n', 'new'].includes(answer)) return 'new';
              if (['a', 'add', 'existing'].includes(answer)) return 'existing';
            }
          } finally {
            prompt.close();
          }
        }
      : undefined;
  const session = await chooseBenchmarkSession(out, machineId, options, ask);
  if (options.machineName) await writeMachine(out, { id: machineId, name: options.machineName });
  if (options.vsync === 'on' || suite.defaults?.vsync === 'on')
    throw new Error('Throughput benchmarks require vsync off');
  const vsync = 'off' as const;
  const flags = [...chromeFlags(vsync), ...(options.chromeArgs ?? [])];
  const host = { os: `${platform()} ${release()}`, cpu: cpus()[0]?.model ?? 'unknown', machineId };
  let gitCommit: string | undefined;
  try {
    gitCommit = (await promisify(execFile)('git-dedup', ['rev-parse', 'HEAD'])).stdout.trim();
  } catch {}
  let environmentProbe: Environment = {
    userAgent: '',
    gpuTimestampsAvailable: false,
    crossOriginIsolated: false,
    devicePixelRatio: 1,
    host,
    chromeFlags: flags,
  };
  const server = await startServer({ out, host: options.host, port: options.port, live: options.live });
  let rendererServer: Awaited<ReturnType<typeof startServer>> | undefined;
  let browser: Browser | undefined;
  const results: RunResult[] = [];
  try {
    if (options.rendererRoot)
      rendererServer = await startServer({
        out,
        host: '127.0.0.1',
        port: options.rendererPort ?? 4401,
        rendererRoot: options.rendererRoot,
      });
    console.log(`Results: ${join(out, machineId, session)}`);
    if (options.live) console.log(`Benchmark monitor (while running): ${server.url}/?view=performance`);
    const launch = async () => {
      browser = await puppeteer.launch({
        headless: !options.headful,
        args: flags,
        executablePath: options.executablePath,
      });
      const probe = await browser.newPage();
      await probe.goto(server.url + '/harness');
      const gpu = await probe.evaluate(async () => {
        const nav = navigator as Navigator & {
          gpu?: {
            requestAdapter: () => Promise<{ info?: unknown; features?: Set<string> } | null>;
          };
        };
        // Headless Chrome on Linux/Vulkan can return null for the first adapter request while the GPU
        // process initializes; retrying here also warms it up for the measured pages.
        let adapter = await nav.gpu?.requestAdapter();
        for (let attempt = 0; nav.gpu && !adapter && attempt < 30; attempt++) {
          await new Promise((done) => setTimeout(done, 100));
          adapter = await nav.gpu.requestAdapter();
        }
        const info = adapter?.info as { vendor?: string; architecture?: string; description?: string } | undefined;
        const gl = document.createElement('canvas').getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return {
          adapter: { vendor: info?.vendor, architecture: info?.architecture, description: info?.description },
          gpuTimestampsAvailable: adapter?.features?.has('timestamp-query') ?? false,
          crossOriginIsolated: globalThis.crossOriginIsolated,
          renderer: debug ? gl?.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER),
          available: !!adapter || !!gl,
          api: adapter ? ('webgpu' as const) : ('webgl2' as const),
        };
      });
      await probe.close();
      environmentProbe = {
        ...environmentProbe,
        userAgent: await browser.userAgent(),
        gpuTimestampsAvailable: gpu.gpuTimestampsAvailable,
        crossOriginIsolated: gpu.crossOriginIsolated,
        gpuAdapter: gpu.adapter,
        api: gpu.api,
      };
      if (!gpu.available) throw new Error('No GPU API available in Chrome');
      if (isSoftwareAdapter(gpu) && !options.allowSoftware)
        throw new Error(
          `Software GPU rejected: ${JSON.stringify(gpu)}. Pass --allow-software only for functional testing.`,
        );
    };
    await launch();
    for (let i = 0; i < schedule.length; i++) {
      if (i > 0 && options.recycle && i % options.recycle === 0) {
        await browser?.close();
        await launch();
      }
      const { entry } = schedule[i]!;
      const runId = ulid();
      const page = await browser!.newPage();
      await configureNetwork(page, networkProfile);
      await page.setViewport({
        width: options.width ?? 1920,
        height: options.height ?? 1080,
        deviceScaleFactor: 1,
      });
      await page.exposeFunction('validateEnvelope', (message: unknown, bytes?: number[]) => {
        if (bytes) (message as { payload: { bytes: ArrayBuffer } }).payload.bytes = Uint8Array.from(bytes).buffer;
        assertMessageToHarness(message);
      });
      const url = new URL(entry.url, options.rootUrl ?? rendererServer?.url ?? rootUrl ?? server.url);
      url.searchParams.set('performanceKitRunId', runId);
      url.searchParams.set('performanceKitEntryId', entry.id);
      url.searchParams.set('performanceKitDurationMs', String(entry.durationMs));
      url.searchParams.set('performanceKitParams', JSON.stringify(entry.params ?? {}));
      url.searchParams.set('performanceKitOrigin', new URL(server.url).origin);
      const reference = entry.reference ? await loadReference(entry.reference.image, options.suite) : undefined;
      if (entry.reference && reference) {
        const file = `${machineId}/${session}/${entry.renderer.id}/${entry.scene.id}/reference.png`;
        await atomicWrite(join(out, file), reference);
        url.searchParams.set(
          'performanceKitReference',
          JSON.stringify({
            ...entry.reference,
            image: new URL(file, server.url + '/').href,
          }),
        );
      }
      const input = {
        runId,
        url: url.href,
        durationMs: entry.durationMs,
        initTimeoutMs: suite.defaults?.initTimeoutMs ?? 60000,
        capture: Boolean(reference) || (suite.defaults?.capture ?? true),
        width: options.width ?? 1920,
        height: options.height ?? 1080,
        isolation,
      };
      console.log(`[${i + 1}/${schedule.length}] ${entry.id}`);
      let payload: Awaited<ReturnType<typeof harnessRun>>;
      try {
        if (isolation === 'page') {
          await page.evaluateOnNewDocument(
            (source, runInput) => {
              (window as unknown as { __performanceKitResult: Promise<unknown> }).__performanceKitResult = new Function(
                `return (${source})`,
              )()(runInput);
            },
            harnessRun.toString(),
            input,
          );
          await page.goto(url.href, {
            waitUntil: 'domcontentloaded',
            timeout: input.initTimeoutMs,
          });
          payload = await deadline(
            page.evaluate(
              async () =>
                await (
                  window as unknown as {
                    __performanceKitResult: Promise<Awaited<ReturnType<typeof harnessRun>>>;
                  }
                ).__performanceKitResult,
            ),
            input.initTimeoutMs * 3 + input.durationMs + 10000,
            'renderer page run',
          );
        } else {
          await page.goto(server.url + '/harness');
          payload = await deadline(
            page.evaluate(harnessRun, input),
            input.initTimeoutMs * 3 + input.durationMs + 10000,
            'iframe run',
          );
        }
      } catch (error) {
        const timestamp = 0;
        payload = {
          harness: { iframeCreated: timestamp, teardown: timestamp },
          reporter: { frames: [] },
          messages: [],
          environment: {},
          status: /timeout/i.test((error as Error).message) ? 'timeout' : 'error',
          error: { message: (error as Error).message },
          capture: undefined,
        };
      }
      const capture = payload.capture;
      const environment = {
        ...environmentProbe,
        userAgent: environmentProbe.userAgent,
        gpuTimestampsAvailable: environmentProbe.gpuTimestampsAvailable,
        crossOriginIsolated: await deadline(
          page.evaluate(() => crossOriginIsolated),
          2000,
          'isolation probe',
        ).catch(() => false),
        devicePixelRatio: 1,
        chromeFlags: flags,
        host,
        gitCommit,
        ...(payload.environment as Partial<Environment>),
      };
      if (isSoftwareAdapter(environment.gpuAdapter) && !options.allowSoftware) {
        payload.status = 'error';
        payload.error = {
          message: `Renderer selected a software GPU: ${JSON.stringify(environment.gpuAdapter)}. Pass --allow-software only for functional testing.`,
        };
      }
      const result = {
        schemaVersion: 1,
        runId,
        suiteName: suite.name,
        networkProfile,
        entry: { id: entry.id, name: entry.name, renderer: entry.renderer, scene: entry.scene, url: entry.url },
        config: {
          durationMs: entry.durationMs,
          vsync,
        },
        environment,
        harness: payload.harness,
        messages: payload.messages,
        reporter: payload.reporter,
        status: payload.status,
        ...(payload.error ? { error: payload.error } : {}),
        ...(capture ? { capture: { file: 'screenshot.avif', at: capture.at } } : {}),
      } as RunResult;
      await page.close();
      if (suite.phaseColors) Object.assign(result.config, { phaseColors: suite.phaseColors });
      await writeRun(out, machineId, result, capture ? Uint8Array.from(capture.bytes) : undefined, reference, session);
      results.push(result);
      server.publish({
        type: 'resultChanged',
        session,
        machineId,
        rendererId: entry.renderer.id,
        sceneId: entry.scene.id,
      });
      if (i + 1 < schedule.length) await new Promise((done) => setTimeout(done, options.cooldownMs ?? 2000));
    }
  } finally {
    await browser?.close();
    await rendererServer?.close();
    await server.close();
  }
  if (options.failOnError !== false && results.some((result) => result.status !== 'ok')) process.exitCode = 1;
  return { out, session, results };
}
