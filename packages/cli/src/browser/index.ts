import type {
  BlockRecord,
  Environment,
  FrameRecord,
  MessageToReporter,
  PhaseMark,
  PhaseName,
} from '../schema/index.js';
import { createConvergenceSampler } from './convergence.js';
import type { ReferenceConfig } from '../schema/index.js';
import { observeDownloads } from './downloads.js';
import { attachWebGPU, attachWebGL } from './gpu.js';
import { attachThree } from './three.js';
import type { GpuTiming } from './gpu.js';
export interface ReporterOptions {
  /** Count GPU-completed batches instead of instrumenting individual frames. */
  throughput?: boolean;
  runId?: string;
  harnessOrigin?: string;
  enabled?: boolean;
  frameCapacity?: number;
  watchdogMs?: number;
  durationMs?: number;
  reference?: ReferenceConfig;
}
export interface Reporter {
  readonly enabled: boolean;
  readonly running: boolean;
  readonly entryId: string;
  readonly params: Record<string, unknown>;
  /** Attach the rendered canvas and load an optional reference before ready(). */
  convergence(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void>;
  onCapture(
    callback: () =>
      | HTMLCanvasElement
      | OffscreenCanvas
      | Blob
      | ArrayBuffer
      | Promise<HTMLCanvasElement | OffscreenCanvas | Blob | ArrayBuffer>,
  ): void;
  /** Returns an identity for overlapping phases; ending by name closes the latest open occurrence. */
  phaseStart(phase: PhaseName): number;
  phaseEnd(phase: PhaseName | number): void;
  ready(): void;
  startThroughput(): void;
  completedBatch(completedFrames: number): void;
  endThroughput(completedFrames: number): void;
  frameBegin(options?: { animationTime?: number }): number;
  frameEnd(token: number): void;
  frame(record: FrameRecord): void;
  frameGpu(token: number, timing: Pick<GpuTiming, 'gpuStart' | 'gpuEnd'>): void;
  environment(environment: Partial<Environment>): void;
  fail(error: unknown): void;
  dispose(): void;
  gpu: {
    attach: typeof attachWebGPU;
    attachWebGL: typeof attachWebGL;
    attachThree: typeof attachThree;
  };
}
declare global {
  interface Window {
    __performanceKitSend?: (message: unknown) => void;
    __performanceKitReceive?: (message: unknown) => void;
  }
}
export function createReporter(options: ReporterOptions = {}): Reporter {
  const originTime = performance.now();
  const now = () => (performance.now() - originTime) / 1000;
  const browser = typeof window !== 'undefined';
  const query = browser ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const runId = options.runId ?? query.get('performanceKitRunId') ?? '';
  const entryId = query.get('performanceKitEntryId') ?? '';
  const params: unknown = JSON.parse(query.get('performanceKitParams') ?? '{}');
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid workload params');
  const reference: ReferenceConfig | undefined =
    options.reference ??
    (query.has('performanceKitReference') ? JSON.parse(query.get('performanceKitReference')!) : undefined);
  let convergence: Awaited<ReturnType<typeof createConvergenceSampler>> | undefined;
  const navigationStart = 0;
  const durationMs = options.durationMs ?? Number(query.get('performanceKitDurationMs') ?? 5000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error('Invalid run duration');
  const origin = options.harnessOrigin ?? query.get('performanceKitOrigin') ?? '';
  const bridge = browser && typeof window.__performanceKitSend === 'function';
  const enabled = browser && (options.enabled ?? Boolean(runId && (bridge || (window.parent !== window && origin))));
  const downloads = enabled ? observeDownloads(originTime) : undefined;
  const downloadReports: ReturnType<NonNullable<typeof downloads>['snapshot']>[] = [];
  const environment: Partial<Environment> = {};
  let readyAt = 0;
  let disposed = false;
  let captureCallback: Parameters<Reporter['onCapture']>[0] | undefined;
  let seq = 0;
  let receivedSeq = -1;
  let state: 'init' | 'running' | 'ended' = 'init';
  const phases: PhaseMark[] = [];
  const ticks: number[] = [];
  const blocks: BlockRecord[] = [];
  // Fixed-width records avoid per-frame allocations; expanded outside measurement when the run completes.
  let capacity = options.frameCapacity ?? 30000;
  let data = new Float64Array(capacity * 4);
  let count = 0;
  let overflow = false;
  const explicit = new Map<number, FrameRecord>();
  let runStart = 0;
  let throughput: { completedFrames: number; elapsed: number } | undefined;
  let runTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let observer: PerformanceObserver | undefined;
  let drainBlocks: (() => void) | undefined;
  const send = (type: string, payload: unknown, transfer: Transferable[] = []) => {
    if (!enabled || disposed) return;
    const message = {
      protocol: 'performance-kit',
      protocolVersion: 1,
      runId,
      seq: seq++,
      type,
      sentAt: now(),
      payload,
    };
    if (window.__performanceKitSend) window.__performanceKitSend(message);
    else window.parent.postMessage(message, origin, transfer);
  };
  const error = (value: unknown) => {
    // Reference failures can explain setup/readback errors without publishing partial measurements.
    if (reference || options.throughput)
      send('error', { message: value instanceof Error ? value.message : String(value) });
    // Legacy runs retain their existing failure behavior.
    api.dispose();
  };
  const records = () =>
    Array.from({ length: count }, (_, index): FrameRecord => {
      const base = index * 4;
      return {
        ...explicit.get(index),
        cpuStart: data[base]!,
        cpuEnd: data[base + 1]!,
        ...(Number.isNaN(data[base + 2]!) ? {} : { animationTime: data[base + 2]! }),
      };
    });
  const finish = () => {
    if (state !== 'running' || disposed) return;
    const runEnd = now();
    state = 'ended';
    if (overflow) {
      error(new Error('Frame storage capacity exceeded; increase frameCapacity'));
      return;
    }
    downloadReports.push(downloads!.snapshot('post-load'));
    send('runEnd', {
      navigationStart,
      ready: readyAt,
      runStart,
      renderStart: options.throughput ? readyAt : runStart,
      runEnd,
      phases: phases.map((phase) => ({ ...phase })),
      environment,
      downloads: downloadReports,
      frames: records(),
      ...(throughput ? { throughput } : {}),
      blocks: blocks.slice(),
      watchdogTicks: ticks.slice(),
      ...(convergence ? { convergence: convergence.result() } : {}),
    });
  };
  const tick = () => {
    ticks.push(now());
    watchdog = setTimeout(tick, options.watchdogMs ?? 16);
  };
  const beginObservers = () => {
    tick();
    if (typeof PerformanceObserver === 'undefined') return;
    const supported = PerformanceObserver.supportedEntryTypes;
    const type = supported.includes('long-animation-frame')
      ? 'long-animation-frame'
      : supported.includes('longtask')
        ? 'longtask'
        : undefined;
    if (!type) return;
    const recordBlocks = (entries: PerformanceEntry[]) => {
      for (const entry of entries)
        blocks.push({
          start: Math.max(0, (entry.startTime - originTime) / 1000),
          end: Math.max(0, (entry.startTime + entry.duration - originTime) / 1000),
          source: type === 'longtask' ? 'longtask' : 'loaf',
          ...('scripts' in entry && Array.isArray(entry.scripts)
            ? {
                scripts: entry.scripts.map(
                  (script: {
                    startTime: number;
                    duration: number;
                    sourceURL?: string;
                    invoker?: string;
                    invokerType?: string;
                    sourceFunctionName?: string;
                    sourceCharPosition?: number;
                  }) => ({
                    start: Math.max(0, (script.startTime - originTime) / 1000),
                    end: Math.max(0, (script.startTime + script.duration - originTime) / 1000),
                    ...(script.sourceURL ? { sourceURL: script.sourceURL } : {}),
                    ...(script.invoker ? { invoker: script.invoker } : {}),
                    ...(script.invokerType ? { invokerType: script.invokerType } : {}),
                    ...(script.sourceFunctionName ? { sourceFunctionName: script.sourceFunctionName } : {}),
                    ...(script.sourceCharPosition !== undefined
                      ? { sourceCharPosition: script.sourceCharPosition }
                      : {}),
                  }),
                ),
              }
            : {}),
        });
    };
    drainBlocks = () => recordBlocks(observer?.takeRecords() ?? []);
    observer = new PerformanceObserver((list) => recordBlocks(list.getEntries()));
    observer.observe({ type, buffered: true });
  };
  const validate = (value: unknown): value is MessageToReporter => {
    if (!value || typeof value !== 'object') return false;
    const message = value as Record<string, unknown>;
    if (message.protocol !== 'performance-kit' || message.runId !== runId) return false;
    if (
      message.protocolVersion !== 1 ||
      !Number.isInteger(message.seq) ||
      (message.seq as number) !== receivedSeq + 1 ||
      typeof message.sentAt !== 'number' ||
      !Number.isFinite(message.sentAt) ||
      !message.payload ||
      typeof message.payload !== 'object'
    )
      throw new Error('Invalid protocol envelope or dropped/reordered sequence');
    if (
      Object.keys(message).some(
        (key) => !['protocol', 'protocolVersion', 'runId', 'seq', 'type', 'sentAt', 'payload'].includes(key),
      )
    )
      throw new Error('Unexpected protocol envelope properties');
    const payload = message.payload as Record<string, unknown>;
    const keys: Record<string, string[]> = {
      capture: ['mimeType'],
      abort: ['reason'],
    };
    const allowed = keys[String(message.type)];
    if (!allowed || Object.keys(payload).some((key) => !allowed.includes(key)))
      throw new Error('Invalid protocol type or payload properties');
    if (message.type === 'capture' && payload.mimeType !== 'image/png') throw new Error('Invalid capture mimeType');
    if (message.type === 'abort' && typeof payload.reason !== 'string') throw new Error('Invalid abort reason');
    receivedSeq = message.seq as number;
    return true;
  };
  const receive = async (value: unknown) => {
    try {
      if (!enabled || disposed || !validate(value)) return;
      switch (value.type) {
        case 'capture': {
          if (state !== 'ended') throw new Error('capture requires ended state');
          if (!captureCallback) throw new Error('No capture callback registered');
          const target = await captureCallback();
          let bytes: ArrayBuffer;
          if (target instanceof ArrayBuffer) bytes = target;
          else {
            const blob =
              target instanceof Blob
                ? target
                : 'convertToBlob' in target
                  ? await target.convertToBlob({ type: 'image/png' })
                  : await new Promise<Blob>((resolve, reject) =>
                      target.toBlob(
                        (capturedBlob) =>
                          capturedBlob ? resolve(capturedBlob) : reject(new Error('Canvas capture returned no blob')),
                        'image/png',
                      ),
                    );
            bytes = await blob.arrayBuffer();
          }
          send('capture', { at: now(), bytes }, [bytes]);
          break;
        }
        case 'abort':
          api.dispose();
          break;
      }
    } catch (cause) {
      error(cause);
    }
  };
  const listener = (event: MessageEvent) => {
    if (event.source === window.parent && event.origin === origin) void receive(event.data);
  };
  const api: Reporter = {
    enabled,
    get running() {
      return state === 'running' && !disposed;
    },
    entryId,
    params: params as Record<string, unknown>,
    async convergence(canvas) {
      if (!enabled || !reference) return;
      if (state !== 'init') throw new Error('Attach convergence canvas before ready()');
      try {
        convergence = await createConvergenceSampler(canvas, reference, now);
      } catch (cause) {
        error(cause);
        throw cause;
      }
      captureCallback ??= () => canvas;
    },
    onCapture(callback) {
      captureCallback = callback;
    },
    phaseStart(phase) {
      if (!enabled || disposed) return -1;
      if (!phase.trim()) {
        error('Phase name must not be empty');
        return -1;
      }
      const id = phases.length;
      const mark: PhaseMark = { id, phase, start: { clock: 'reporter', t: now() } };
      phases.push(mark);
      return id;
    },
    phaseEnd(phase) {
      if (!enabled || disposed) return;
      const mark = typeof phase === 'number' ? phases[phase] : phases.findLast((p) => p.phase === phase && !p.end);
      if (!mark || mark.end) {
        error(`Phase ${phase} ended before start`);
        return;
      }
      mark.end = { clock: 'reporter', t: now() };
    },
    ready() {
      if (!enabled || disposed) return;
      if (state !== 'init') {
        error('ready requires init state');
        return;
      }
      if (reference && !convergence)
        throw new Error('Call await reporter.convergence(canvas) before ready() for reference runs');
      if (phases[0]?.phase === 'load' && !phases[0].end) api.phaseEnd(0);
      // Stop all initialization instrumentation before allocating the measured window.
      clearTimeout(watchdog);
      drainBlocks?.();
      observer?.disconnect();
      downloadReports.push(downloads!.snapshot('load'));
      downloads?.dispose();
      if (!options.frameCapacity) {
        capacity = Math.max(capacity, count + Math.ceil(durationMs * 2));
        const expanded = new Float64Array(capacity * 4);
        expanded.set(data);
        data = expanded;
      }
      readyAt = now();
      if (options.throughput) return;
      state = 'running';
      runStart = readyAt;
      convergence?.start(runStart);
      runTimer = setTimeout(finish, durationMs);
    },
    startThroughput() {
      if (!enabled || disposed) return;
      if (!options.throughput || state !== 'init') throw new Error('Invalid throughput start');
      state = 'running';
      runStart = now();
      convergence?.start(runStart);
    },
    completedBatch(completedFrames) {
      if (state === 'running') convergence?.sample(now(), completedFrames);
    },
    endThroughput(completedFrames) {
      throughput = { completedFrames, elapsed: now() - runStart };
      finish();
    },
    frameBegin(frameOptions) {
      if (options.throughput) return -1;
      if (!enabled || disposed || state !== 'running') return -1;
      if (count >= capacity) {
        overflow = true;
        return -1;
      }
      const token = count++;
      const base = token * 4;
      data[base] = now();
      data[base + 1] = data[base]!;
      data[base + 2] = frameOptions?.animationTime ?? NaN;
      return token;
    },
    frameEnd(token) {
      if (token >= 0 && token < count && enabled && !disposed) {
        data[token * 4 + 1] = now();
        if (state === 'running') convergence?.sample(data[token * 4 + 1]!, token + 1);
      }
    },
    frame(record) {
      if (!enabled || disposed || state !== 'running') return;
      if (count >= capacity) {
        overflow = true;
        return;
      }
      const index = count++;
      const base = index * 4;
      data[base] = record.cpuStart;
      data[base + 1] = record.cpuEnd;
      data[base + 2] = record.animationTime ?? NaN;
      explicit.set(index, record);
      convergence?.sample(record.cpuEnd, index + 1);
    },
    frameGpu(token, timing) {
      if (token >= 0 && token < count)
        explicit.set(token, {
          ...explicit.get(token),
          cpuStart: data[token * 4]!,
          cpuEnd: data[token * 4 + 1]!,
          gpuStart:
            explicit.get(token)?.gpuStart && BigInt(explicit.get(token)!.gpuStart!) < BigInt(timing.gpuStart)
              ? explicit.get(token)!.gpuStart
              : timing.gpuStart,
          gpuEnd:
            explicit.get(token)?.gpuEnd && BigInt(explicit.get(token)!.gpuEnd!) > BigInt(timing.gpuEnd)
              ? explicit.get(token)!.gpuEnd
              : timing.gpuEnd,
        });
    },
    environment(value) {
      Object.assign(environment, value);
    },
    fail(cause) {
      if (!enabled || disposed) return;
      error(cause);
      api.dispose();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(runTimer);
      clearTimeout(watchdog);
      observer?.disconnect();
      downloads?.dispose();
      if (browser) {
        window.removeEventListener('message', listener);
        if (window.__performanceKitReceive === bridgeReceiver) delete window.__performanceKitReceive;
      }
    },
    gpu: {
      attach: (device, ringSize, maxPasses) =>
        attachWebGPU(enabled ? device : { ...device, features: { has: () => false } }, ringSize, maxPasses),
      attachWebGL: (gl, ringSize) =>
        attachWebGL(enabled ? gl : ({ getExtension: () => null } as unknown as WebGL2RenderingContext), ringSize),
      attachThree: (renderer, callback) =>
        attachThree(enabled ? renderer : {}, callback ?? ((value) => api.frameGpu(value.frame, value))),
    },
  };
  const bridgeReceiver = (value: unknown) => {
    void receive(value);
  };
  if (enabled) {
    window.addEventListener('message', listener);
    if (bridge) window.__performanceKitReceive = bridgeReceiver;
    Object.assign(environment, {
      userAgent: navigator.userAgent,
      crossOriginIsolated: globalThis.crossOriginIsolated,
      devicePixelRatio: window.devicePixelRatio,
      gpuTimestampsAvailable: false,
    });
    beginObservers();
    const load: PhaseMark = { id: 0, phase: 'load', start: { clock: 'reporter', t: navigationStart } };
    phases.push(load);
  }
  return api;
}
