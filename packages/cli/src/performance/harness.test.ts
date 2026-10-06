import { it, expect, vi } from 'vitest';
import { harnessRun } from './harness.js';
it('preserves inbound arrival order despite reversed validator delays and transferred capture bytes', async () => {
  let sequence = 0,
    activeValidators = 0,
    maxActiveValidators = 0;
  const validationOrder: number[] = [];
  const source: { [key: string]: unknown } = {};
  const emit = (type: string, payload: Record<string, unknown>) => {
    (source.__performanceKitSend as (message: unknown) => void)({
      protocol: 'performance-kit',
      protocolVersion: 1,
      runId: 'test',
      seq: sequence++,
      type,
      sentAt: performance.timeOrigin + performance.now(),
      payload,
    });
  };
  source.addEventListener = () => {};
  source.removeEventListener = () => {};
  source.validateEnvelope = async (
    message: { seq: number; type: string; payload: Record<string, unknown> },
    bytes?: number[],
  ) => {
    activeValidators++;
    maxActiveValidators = Math.max(maxActiveValidators, activeValidators);
    // An immediately following message would finish first without the queue.
    await new Promise((done) => setTimeout(done, message.seq % 2 === 0 ? 15 : 0));
    validationOrder.push(message.seq);
    activeValidators--;
    if (message.type === 'capture') expect(bytes).toEqual([137, 80, 78, 71]);
  };
  const commands: string[] = [];
  source.__performanceKitReceive = (message: { type: string; payload: Record<string, unknown> }) => {
    const at = performance.timeOrigin + performance.now();
    commands.push(message.type);
    if (message.type === 'capture') emit('capture', { at, bytes: Uint8Array.of(137, 80, 78, 71).buffer });
  };
  vi.stubGlobal('window', source);
  vi.stubGlobal('document', { createElement: () => ({ style: {}, remove: () => {} }) });
  vi.stubGlobal(
    'MessageEvent',
    // oxlint-disable-next-line typescript/no-extraneous-class -- Constructible MessageEvent substitute.
    class {
      constructor(_type: string, properties: Record<string, unknown>) {
        Object.assign(this, properties);
      }
    },
  );
  try {
    const promise = harnessRun({
      runId: 'test',
      url: 'http://127.0.0.1/demo',
      durationMs: 10,
      initTimeoutMs: 2000,
      capture: true,
      width: 640,
      height: 480,
      isolation: 'page',
    });
    const at = 0.02;
    emit('runEnd', {
      navigationStart: 0,
      ready: at,
      renderStart: at,
      runStart: at,
      runEnd: at + 0.01,
      frames: [{ cpuStart: at, cpuEnd: at + 0.001 }],
      blocks: [],
      watchdogTicks: [],
      downloads: [],
      environment: { userAgent: 'test' },
      phases: [
        { id: 0, phase: 'assets', start: { clock: 'reporter', t: 0 }, end: { clock: 'reporter', t: at } },
        { id: 1, phase: 'assets', start: { clock: 'reporter', t: 0.01 }, end: { clock: 'reporter', t: at } },
      ],
    });

    const result = await promise;
    expect(result.status).toBe('ok');
    expect(commands).toEqual(['capture']);
    expect(result.harness).not.toHaveProperty('startSent');
    expect(maxActiveValidators).toBe(1);
    expect(validationOrder).toEqual(Array.from({ length: sequence }, (_, index) => index));
    expect(result.capture?.bytes).toEqual([137, 80, 78, 71]);
    expect(result).not.toHaveProperty('clockSync');
    expect(result.harness.captureSent).toBeGreaterThanOrEqual(result.harness.runEndObserved!);
    expect(result.reporter.frames).toHaveLength(1);
    expect(result.reporter.phases).toHaveLength(2);
    expect(result.reporter.phases?.map((p) => p.id)).toEqual([0, 1]);
    expect(result.reporter.phases?.every((p) => p.end !== undefined)).toBe(true);
    expect(result.reporter.renderStart).toBe(result.reporter.ready);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('times out without collecting or requesting partial measurements from a hung renderer', async () => {
  vi.useFakeTimers();
  const commands: string[] = [];
  vi.stubGlobal('window', {
    addEventListener() {},
    removeEventListener() {},
    validateEnvelope: async () => {},
    __performanceKitReceive: (message: { type: string }) => commands.push(message.type),
  });
  vi.stubGlobal('document', { createElement: () => ({ style: {}, remove() {} }) });
  try {
    const run = harnessRun({
      runId: 'hung',
      url: 'https://renderer.example',
      durationMs: 10,
      initTimeoutMs: 20,
      capture: true,
      width: 100,
      height: 100,
      isolation: 'page',
    });
    await vi.advanceTimersByTimeAsync(31);
    const result = await run;
    expect(result.status).toBe('timeout');
    expect(result.reporter).toEqual({ frames: [] });
    expect(result.environment).toEqual({});
    expect(result.messages).toEqual([]);
    expect(result.capture).toBeUndefined();
    expect(commands).toEqual(['abort']);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
