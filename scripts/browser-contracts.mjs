import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCubeServer } from './cube-server.mjs';
const require = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const cli = fileURLToPath(new URL('../packages/cli/dist/bin.js', import.meta.url));
const chrome =
  process.env.CHROME_EXECUTABLE ??
  (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : puppeteer.executablePath());
try {
  await access(chrome);
} catch {
  throw new Error(
    `Chrome not found at ${chrome}. Install it with "cd packages/cli && pnpm exec puppeteer browsers install chrome" or set CHROME_EXECUTABLE.`,
  );
}
const work = await mkdtemp(join(tmpdir(), 'fidelity-cube-'));
const renderer = await createCubeServer();
const parent = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(
    '<!doctype html><body><script>window.events=[];addEventListener("message", e => events.push(e.data));</script></body>',
  );
});
await new Promise((done) => parent.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${parent.address().port}`;
const execute = (args) =>
  promisify(execFile)(
    process.execPath,
    [cli, ...args, '--chrome-arg=--no-sandbox', '--chrome-arg=--enable-unsafe-swiftshader'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
let browser;
try {
  const registry = {
    schemaVersion: 1,
    title: 'Cube contract fixture',
    renderServer: { developmentUrl: renderer.url, entry: 'index.html' },
    renderers: [{ id: 'cube', name: 'WebGL cube' }],
    scenes: [{ id: 'cube', name: 'Spinning cube', fidelity: { width: 320, height: 240, frames: 3 } }],
    performance: {
      default: {
        defaults: { vsync: 'off', capture: true },
        entries: [{ renderer: 'cube', scene: 'cube', durationMs: 5000, params: { width: 320, height: 240 } }],
      },
    },
  };
  const registryFile = join(work, 'registry.json');
  await writeFile(registryFile, JSON.stringify(registry));
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(origin);
  const live = new URL(renderer.url);
  live.search = new URLSearchParams({
    fidelityKitMode: 'live',
    fidelityKitOrigin: origin,
    fidelityKitSession: 'cube-live',
    fidelityKitParams: JSON.stringify({ width: 320, height: 240 }),
    // Even an accidental harness run ID must not enable persistence in live mode.
    performanceKitRunId: 'must-stay-disabled',
    performanceKitOrigin: origin,
  });
  await page.evaluate((url) => {
    const frame = document.createElement('iframe');
    frame.src = url;
    document.body.append(frame);
  }, live.href);
  await page.waitForFunction(() => window.events.some((event) => event.kind === 'frame'));
  const events = await page.evaluate(() => window.events);
  assert.equal(events.filter((event) => event.kind === 'setup').length, 1);
  assert.ok(events.findIndex((event) => event.kind === 'setup') < events.findIndex((event) => event.kind === 'frame'));
  assert.ok(events.find((event) => event.kind === 'frame').data.fps > 0);
  assert.ok(events.every((event) => event.protocol === 'fidelity-kit-host-v1' && event.token === 'cube-live'));
  const frame = page.frames().find((item) => item.url() === live.href);
  const canvas = await frame.$('canvas');
  const stats = await sharp(await canvas.screenshot({ type: 'png' })).stats();
  assert.ok(
    stats.channels.some((channel) => channel.stdev > 10),
    'Cube must produce a visible 3D image',
  );
  await frame.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await frame.evaluate(() => window.__cube.disposed), true);
  assert.equal(await frame.$('canvas'), null);

  // The initial setup draw counts toward the requested fidelity frame count.
  const capture = new URL(renderer.url);
  capture.search = new URLSearchParams({
    fidelityKitMode: 'capture',
    fidelityKitParams: JSON.stringify({ frames: 3 }),
  });
  await page.goto(capture.href);
  await page.waitForFunction(() => '__fidelityKitCapture' in window);
  assert.deepEqual(await page.evaluate(() => [window.__cube.submitted, window.__cube.completed]), [3, 3]);
  await browser.close();
  browser = undefined;
  await execute(['render', '--registry', registryFile, '--out', join(work, 'fidelity'), '--executable-path', chrome]);
  const image = join(work, 'fidelity/cube/beauty/cube.avif');
  const metadata = await sharp(image).metadata();
  assert.deepEqual([metadata.width, metadata.height], [320, 240]);
  assert.ok((await sharp(image).stats()).channels.some((channel) => channel.stdev > 10));
  // Software GPU is allowed for correctness CI only. These are not comparative hardware measurements.
  await execute([
    'benchmark',
    '--registry',
    registryFile,
    '--out',
    join(work, 'performance'),
    '--machine',
    'contract',
    '--cooldown-ms',
    '0',
    '--allow-software',
    '--chrome-arg=--enable-unsafe-swiftshader',
    '--executable-path',
    chrome,
  ]);
  const metrics = JSON.parse(await readFile(join(work, 'performance/contract/cube/cube/metrics.json'), 'utf8'));
  assert.equal(metrics.status, 'ok');
  assert.equal(metrics.config.vsync, 'off');
  assert.ok(metrics.throughput.elapsed >= 5);
  assert.ok(metrics.throughput.completedFrames > 0);
  assert.equal(metrics.statistics.frameCount, metrics.throughput.completedFrames);
  assert.equal(metrics.statistics.cpuSampleCount, 0);
  assert.equal(metrics.statistics.intervalCount, 0);
  assert.ok(metrics.environment.chromeFlags.includes('--disable-gpu-vsync'));
  assert.ok(metrics.environment.chromeFlags.includes('--disable-frame-rate-limit'));
  registry.renderers[0].params = { failSetup: true };
  await writeFile(registryFile, JSON.stringify(registry));
  await assert.rejects(
    execute(['render', '--registry', registryFile, '--out', join(work, 'failure'), '--executable-path', chrome]),
    /Cube setup failed/,
  );
  await assert.rejects(access(join(work, 'failure/cube/beauty/cube.avif')));
  console.log(
    'Passed cube contracts: cross-origin live telemetry without persistence, visible GPU rendering, disposal, exact completed capture frames, render CLI, sustained GPU-completed throughput without frame timing, surfaced setup failures.',
  );
} finally {
  await browser?.close();
  await renderer.close();
  parent.closeAllConnections();
  await new Promise((done) => parent.close(done));
  if (!process.env.KEEP_BROWSER_ARTIFACTS) await rm(work, { recursive: true, force: true });
  else console.log(`Browser contract artifacts: ${work}`);
}
