import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixture = vi.hoisted(() => ({
  environment: {} as Record<string, unknown>,
  failure: undefined as string | undefined,
}));
const launch = vi.hoisted(() =>
  vi.fn(async () => ({
    userAgent: async () => 'pinned-test-chrome',
    close: async () => {},
    newPage: async () => ({
      createCDPSession: async () => ({ send: async () => {} }),
      setBypassServiceWorker: async () => {},
      setCacheEnabled: async () => {},
      emulateNetworkConditions: async () => {},
      goto: async () => {},
      close: async () => {},
      setViewport: async () => {},
      exposeFunction: async () => {},
      evaluate: async (fn: Function, input?: unknown) => {
        if (input) {
          if (fixture.failure) throw new Error(fixture.failure);
          return {
            harness: { iframeCreated: 0, runEndObserved: 0.11, teardown: 0.111 },
            reporter: { frames: [], runStart: 0.01, runEnd: 0.11 },
            messages: [],
            environment: fixture.environment,
            status: 'ok',
          };
        }
        if (fn.toString().includes('requestAdapter'))
          return {
            available: true,
            adapter: { description: 'Real GPU' },
            gpuTimestampsAvailable: true,
            crossOriginIsolated: true,
          };
        return true;
      },
    }),
  })),
);
vi.mock('puppeteer', () => ({ default: { launch } }));
import { defaultMachineId, runSuite, deadline } from './runner.js';
describe('runner lifecycle', () => {
  it('persists flat processed workloads with actual browser metadata and process recycling', async () => {
    const root = await mkdtemp(join(tmpdir(), 'performance-runner-'));
    try {
      const suite = join(root, 'registry.json');
      await writeFile(
        suite,
        JSON.stringify({
          schemaVersion: 1,
          name: 'runner',
          phaseColors: { assets: '#123456' },
          defaults: { capture: false },
          entries: [
            {
              id: 'cube',
              name: 'Cube',
              renderer: { id: 'test', name: 'Test Renderer' },
              scene: { id: 'cube', name: 'Spinning cube' },
              url: 'http://127.0.0.1/cube',
              durationMs: 100,
            },
            {
              id: 'sphere',
              name: 'Sphere',
              renderer: { id: 'test', name: 'Test Renderer' },
              scene: { id: 'sphere', name: 'Sphere' },
              url: '/sphere',
              durationMs: 100,
            },
          ],
        }),
      );
      const result = await runSuite({
        suite,
        out: join(root, 'results'),
        machine: 'bench',
        machineName: 'Bench Machine',
        port: 0,
        cooldownMs: 0,
        recycle: 1,
        chromeArgs: ['--use-angle=vulkan'],
        vsync: 'off',
      });
      expect(result.results).toHaveLength(2);
      expect(launch).toHaveBeenCalledTimes(2);
      expect(launch.mock.calls[0]![0].args).toContain('--use-angle=vulkan');
      const raw = JSON.parse(await readFile(join(result.out, 'bench/test/cube/metrics.json'), 'utf8'));
      expect(raw.environment.host.machineId).toBe('bench');
      expect(JSON.parse(await readFile(join(result.out, 'bench/machine.json'), 'utf8'))).toEqual({
        id: 'bench',
        name: 'Bench Machine',
      });
      expect(raw.environment.userAgent).toBe('pinned-test-chrome');
      expect(raw.environment.chromeFlags).toContain('--use-angle=vulkan');
      expect(raw.config.vsync).toBe('off');
      expect(raw.environment.chromeFlags).toContain('--disable-gpu-vsync');
      expect(raw.config.phaseColors).toEqual({ assets: '#123456' });
      expect(raw.environment.gpuAdapter).toEqual({ description: 'Real GPU' });
      expect(JSON.parse(await readFile(join(result.out, 'index.json'), 'utf8')).results).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('persists renderer software adapter errors and outer-clock timeouts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'performance-failure-'));
    const exitCode = process.exitCode;
    try {
      const suite = join(root, 'registry.json');
      await writeFile(
        suite,
        JSON.stringify({
          schemaVersion: 1,
          name: 'failures',
          defaults: { capture: false },
          entries: [
            {
              id: 'cube',
              name: 'Cube',
              renderer: { id: 'test', name: 'Test Renderer' },
              scene: { id: 'cube', name: 'Spinning cube' },
              url: 'http://127.0.0.1/cube',
              durationMs: 100,
            },
          ],
        }),
      );
      fixture.environment = { gpuAdapter: { description: 'SwiftShader selected by renderer' } };
      const software = await runSuite({ suite, out: join(root, 'software'), port: 0, cooldownMs: 0 });
      expect(software.results[0].status).toBe('error');
      expect(software.results[0].error?.message).toContain('Renderer selected a software GPU');
      fixture.environment = {};
      fixture.failure = 'Timeout during renderer page run';
      const timeout = await runSuite({ suite, out: join(root, 'timeout'), port: 0, cooldownMs: 0 });
      expect(timeout.results[0].status).toBe('timeout');
      expect(timeout.results[0].reporter.frames).toEqual([]);
      expect(
        JSON.parse(await readFile(join(timeout.out, defaultMachineId(), 'test/cube/metrics.json'), 'utf8')).status,
      ).toBe('timeout');
    } finally {
      fixture.environment = {};
      fixture.failure = undefined;
      process.exitCode = exitCode;
      await rm(root, { recursive: true, force: true });
    }
  });
  it('bounds a wedged renderer independently of the browser clock', async () => {
    await expect(deadline(new Promise(() => {}), 2, 'run')).rejects.toThrow('Timeout during run');
    expect(await deadline(Promise.resolve(7), 100, 'run')).toBe(7);
  });
});
it('derives a path-safe default machine ID from the host name', () => {
  expect(defaultMachineId('build001')).toBe('build001');
  expect(defaultMachineId('Bens MacBook Air.local')).toBe('bens-macbook-air.local');
  expect(defaultMachineId('-_Host_-')).toBe('host_');
  expect(defaultMachineId('!!!')).toBe('local');
});
