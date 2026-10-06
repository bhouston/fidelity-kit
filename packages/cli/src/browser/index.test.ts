// oxlint-disable typescript/no-explicit-any -- Protocol mocks intentionally model browser objects.
import { expect, it } from 'vitest';
import { createReporter } from './index.js';
import { attachWebGPU } from './gpu.js';
it('reporter safely becomes a no-op outside harness', () => {
  const reporter = createReporter();
  expect(reporter.enabled).toBe(false);
  expect(reporter.frameBegin()).toBe(-1);
  reporter.phaseStart('load');
  reporter.phaseEnd('load');
  reporter.ready();
  reporter.frameEnd(-1);
  reporter.dispose();
});
it('WebGPU helper does not allocate queries when timestamp-query is unavailable', () => {
  const timing = attachWebGPU({
    features: new Set(),
    createQuerySet() {
      throw Error('must not allocate');
    },
    createBuffer() {
      throw Error('must not allocate');
    },
  });
  expect(timing.available).toBe(false);
  expect(timing.begin(0)).toBeUndefined();
  timing.dispose();
});

import { afterEach, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function fixture(options: Parameters<typeof createReporter>[0] = {}) {
  vi.useFakeTimers();
  const messages: Record<string, any>[] = [];
  let listener: ((event: { source: unknown; origin: string; data: unknown }) => void) | undefined;
  const parent = { postMessage: (message: Record<string, any>) => messages.push(message) };
  let elapsed = 100;
  vi.stubGlobal('performance', { now: () => elapsed, setResourceTimingBufferSize() {}, getEntriesByType: () => [] });
  vi.stubGlobal('window', {
    location: {
      search:
        '?performanceKitRunId=test&performanceKitOrigin=https%3A%2F%2Fharness.example&performanceKitDurationMs=20',
    },
    parent,
    devicePixelRatio: 1,
    addEventListener(_type: string, callback: typeof listener) {
      listener = callback;
    },
    removeEventListener() {},
  });
  vi.stubGlobal('navigator', { userAgent: 'test' });
  vi.stubGlobal('PerformanceObserver', undefined);
  const reporter = createReporter(options);
  const command = (type: string, payload: unknown, origin = 'https://harness.example') =>
    listener?.({
      source: parent,
      origin,
      data: { protocol: 'performance-kit', protocolVersion: 1, runId: 'test', seq: 0, sentAt: 0, type, payload },
    });
  return {
    reporter,
    messages,
    command,
    advance: (ms: number) => {
      elapsed += ms;
    },
  };
}
it('buffers all phases and metadata, stops probes and emits one complete seconds-offset report', async () => {
  const f = fixture();
  f.advance(10);
  f.reporter.phaseEnd('load');
  const outer = f.reporter.phaseStart('assets');
  const inner = f.reporter.phaseStart('assets');
  f.advance(10);
  f.reporter.phaseEnd(inner);
  f.reporter.phaseEnd(outer);
  f.reporter.environment({ api: 'webgpu' });
  expect(f.messages).toEqual([]);
  f.reporter.ready();
  expect(f.reporter.running).toBe(true);
  expect(vi.getTimerCount()).toBe(1); // Only the one end-of-run deadline survives.
  const token = f.reporter.frameBegin({ animationTime: 2 });
  f.advance(2);
  f.reporter.frameEnd(token);
  f.reporter.frameGpu(token, { gpuStart: '100', gpuEnd: '200' });
  f.command('abort', { reason: 'attack' }, 'https://attacker.example');
  await vi.advanceTimersByTimeAsync(19);
  expect(f.messages).toEqual([]);
  f.advance(18);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.messages).toHaveLength(1);
  expect(f.reporter.running).toBe(false);
  const result = f.messages[0]!.payload;
  expect(f.messages[0]!.type).toBe('runEnd');
  expect(result.navigationStart).toBe(0);
  expect(result.runStart).toBe(0.02);
  expect(result.runEnd).toBe(0.04);
  expect(result.frames).toEqual([{ cpuStart: 0.02, cpuEnd: 0.022, animationTime: 2, gpuStart: '100', gpuEnd: '200' }]);
  expect(result.phases.map((p: { id: number }) => p.id)).toEqual([0, 1, 2]);
  expect(result.phases.every((p: { end?: unknown }) => p.end)).toBe(true);
  expect(result.environment.api).toBe('webgpu');
  expect(result.downloads).toHaveLength(2);
  expect(result.watchdogTicks.every((t: number) => t <= result.runStart)).toBe(true);
  await vi.advanceTimersByTimeAsync(100);
  expect(f.messages).toHaveLength(1);
  f.reporter.dispose();
});
it.each(['failure', 'abort', 'dispose', 'overflow'])('never flushes partial measurements on %s', async (reason) => {
  const f = fixture({ frameCapacity: 1 });
  f.reporter.ready();
  f.reporter.frameEnd(f.reporter.frameBegin());
  if (reason === 'failure') f.reporter.fail(new Error('failed'));
  if (reason === 'abort') f.command('abort', { reason: 'cancelled' });
  if (reason === 'dispose') f.reporter.dispose();
  if (reason === 'overflow') f.reporter.frameBegin();
  await vi.advanceTimersByTimeAsync(100);
  expect(f.messages).toEqual([]);
  expect(f.reporter.frameBegin()).toBe(-1);
});

it('reference failures explain the cause without emitting partial measurements', () => {
  const f = fixture({ reference: { image: '/reference.png' } });
  f.reporter.fail(new Error('Convergence dimensions must match'));
  expect(f.messages).toHaveLength(1);
  expect(f.messages[0]).toMatchObject({ type: 'error', payload: { message: 'Convergence dimensions must match' } });
  expect(f.messages[0]!.payload).not.toHaveProperty('frames');
});
it('convergence attachment remains a no-op without a harness or reference', async () => {
  vi.stubGlobal(
    'Image',
    vi.fn(() => {
      throw new Error('No reference load expected');
    }),
  );
  const reporter = createReporter({ reference: { image: '/reference.png' } });
  await reporter.convergence({} as HTMLCanvasElement);
  const f = fixture();
  await f.reporter.convergence({} as HTMLCanvasElement);
  f.reporter.dispose();
});

it('disables per-frame GPU query instrumentation in completed-frame throughput mode', () => {
  const f = fixture({ throughput: true });
  expect(f.reporter.enabled).toBe(true);
  const device = {
    features: new Set(['timestamp-query']),
    createQuerySet() {
      throw new Error('Throughput must not allocate individual-frame queries');
    },
    createBuffer() {
      throw new Error('Throughput must not allocate timing readbacks');
    },
  };
  try {
    const gpu = f.reporter.gpu.attach(device);
    expect(gpu.available).toBe(false);
    expect(gpu.begin(0)).toBeUndefined();
    const context = {
      getExtension() {
        throw new Error('Throughput must not enable GL frame timers');
      },
    };
    expect(f.reporter.gpu.attachWebGL(context as unknown as WebGL2RenderingContext).available).toBe(false);
    expect(f.reporter.gpu.attachThree({ backend: { device } }).available).toBe(false);
  } finally {
    f.reporter.dispose();
  }
});
