import type { RunResult, ProcessedResult } from './index.js';
import { uncoveredInitialization } from './initialization.js';

/** Linear interpolation between adjacent sorted observations, with endpoints clamped. */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].toSorted((a, b) => a - b);
  const index = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const low = Math.floor(index);
  return sorted[low]! + (sorted[Math.ceil(index)]! - sorted[low]!) * (index - low);
}
export interface Point {
  t: number;
  value: number;
}
export interface Block {
  start: number;
  end: number;
  sources: string[];
}
export function mergeBlocks(blocks: readonly Block[]): Block[] {
  const merged: Block[] = [];
  for (const b of [...blocks].toSorted((left, right) => left.start - right.start)) {
    if (b.end <= b.start) continue;
    const last = merged.at(-1);
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
      last.sources = [...new Set([...last.sources, ...b.sources])];
    } else merged.push({ ...b, sources: [...b.sources] });
  }
  return merged;
}
export function deriveRun(run: RunResult) {
  const start = run.reporter.runStart;
  const end = run.reporter.runEnd;
  // Measured bounds exclude frames outside the run.
  const frames =
    run.status !== 'ok' && start === undefined
      ? []
      : run.reporter.frames.filter(
          (f) => (start === undefined || f.cpuStart >= start) && (end === undefined || f.cpuStart <= end),
        );
  const intervals: Point[] = frames.slice(0, -1).flatMap((f, i) => {
    const value = (frames[i + 1]!.cpuStart - f.cpuStart) * 1000;
    return value > 0 ? [{ t: f.cpuStart, value }] : [];
  });
  const cpu = frames.map((f) => ({ t: f.cpuStart, value: (f.cpuEnd - f.cpuStart) * 1000 })).filter((p) => p.value >= 0);
  const gpu = frames.flatMap((f) => {
    if (f.gpuStart === undefined || f.gpuEnd === undefined) return [];
    const value = Number(BigInt(f.gpuEnd) - BigInt(f.gpuStart)) / 1e6;
    return value >= 0 ? [{ t: f.cpuStart, value }] : [];
  });
  const values = intervals.map((p) => p.value);
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
  const median = percentile(values, 0.5),
    p95 = percentile(values, 0.95),
    p99 = percentile(values, 0.99);
  const iqr = values.length ? percentile(values, 0.75)! - percentile(values, 0.25)! : undefined;
  const mad =
    median === undefined
      ? undefined
      : percentile(
          values.map((v) => Math.abs(v - median)),
          0.5,
        );
  const watchdog = (run.reporter.watchdogTicks ?? [])
    .slice(1)
    .map((t, i) => ({ t, value: Math.max(0, t - run.reporter.watchdogTicks![i]! - 0.016) * 1000 }));
  const blocks = mergeBlocks([
    ...(run.reporter.blocks ?? []).map((b) => ({
      start: b.start,
      end: b.end,
      sources: [b.source],
    })),
    ...watchdog
      .filter((p) => p.value >= 50)
      .map((p) => ({ start: p.t - p.value / 1000, end: p.t, sources: ['watchdog'] })),
  ]);
  const ready = run.reporter.renderStart;
  const initStart = run.reporter.navigationStart;
  const initMs = ready !== undefined && initStart !== undefined ? (ready - initStart) * 1000 : undefined;
  const initBlocks =
    initStart === undefined || ready === undefined
      ? []
      : blocks.flatMap((b) => {
          const clipped = {
            ...b,
            start: Math.max(b.start, initStart),
            end: Math.min(b.end, ready),
          };
          return clipped.end > clipped.start ? [clipped] : [];
        });
  const phases = (run.reporter.phases ?? []).map((p) => ({
    phase: p.phase,
    start: p.start.t,
    end: p.end?.t,
    durationMs: p.end ? (p.end.t - p.start.t) * 1000 : undefined,
  }));
  if (initStart !== undefined && ready !== undefined)
    phases.push(
      ...uncoveredInitialization(phases, initStart, ready).map((gap) => ({
        phase: 'unknown',
        start: gap.start,
        end: gap.end,
        durationMs: (gap.end - gap.start) * 1000,
      })),
    );
  phases.sort((a, b) => a.start - b.start);
  return {
    intervals,
    cpu,
    gpu,
    average,
    maxJitter: average === undefined ? undefined : values.reduce((max, v) => Math.max(max, Math.abs(v - average)), 0),
    worstResponsiveness: watchdog.length ? watchdog.reduce((max, p) => Math.max(max, p.value), 0) : undefined,
    median,
    p95,
    p99,
    iqr,
    mad,
    fps: median ? 1000 / median : undefined,
    initMs,
    unaccountedMs:
      initMs === undefined
        ? undefined
        : phases.filter((p) => p.phase === 'unknown').reduce((sum, p) => sum + (p.durationMs ?? 0), 0),
    phases,
    blocks,
    watchdog,
    initMaxBlockMs: Math.max(0, ...initBlocks.map((b) => (b.end - b.start) * 1000)),
    initBlockedMs: initBlocks.reduce((n, b) => n + (b.end - b.start) * 1000, 0),
  };
}
const throughputOf = (run: RunResult | ProcessedResult) =>
  run.schemaVersion === 3 ? run.throughput : run.reporter.throughput;
const throughputDuration = (run: RunResult | ProcessedResult) => {
  const throughput = throughputOf(run);
  return throughput?.completedFrames ? (throughput.elapsed * 1000) / throughput.completedFrames : undefined;
};
export function summarizeRuns(runs: readonly (RunResult | ProcessedResult)[]) {
  const medians = runs
    .filter((r) => r.status === 'ok')
    .map((r) =>
      throughputOf(r)
        ? throughputDuration(r)
        : r.schemaVersion === 3
          ? r.statistics.median === undefined
            ? undefined
            : r.statistics.median * 1000
          : deriveRun(r).median,
    )
    .filter((v): v is number => v !== undefined);
  const median = percentile(medians, 0.5),
    min = medians.length ? Math.min(...medians) : undefined,
    max = medians.length ? Math.max(...medians) : undefined;
  return {
    median,
    min,
    max,
    unstable: median !== undefined && median > 0 && (max! - min!) / median > 0.05,
    repetitions: medians.length,
  };
}
/** Normal approximation with tie correction and continuity correction. */
export function mannWhitney(a: readonly number[], b: readonly number[]) {
  if (!a.length || !b.length) return { u: 0, pValue: 1 };
  const joined = [...a.map((v) => ({ v, a: true })), ...b.map((v) => ({ v, a: false }))].toSorted((x, y) => x.v - y.v);
  let rankA = 0,
    ties = 0;
  for (let i = 0; i < joined.length;) {
    let j = i + 1;
    while (j < joined.length && joined[j]!.v === joined[i]!.v) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (joined[k]!.a) rankA += rank;
    ties += (j - i) ** 3 - (j - i);
    i = j;
  }
  const u = rankA - (a.length * (a.length + 1)) / 2,
    n = joined.length;
  const variance = ((a.length * b.length) / 12) * (n + 1 - ties / (n * (n - 1)));
  if (variance === 0) return { u, pValue: 1 };
  const z = Math.max(0, Math.abs(u - (a.length * b.length) / 2) - 0.5) / Math.sqrt(variance);
  const t = 1 / (1 + 0.2316419 * z),
    density = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const tail =
    density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return { u, pValue: Math.min(1, 2 * tail) };
}
const profileKey = (r: RunResult | ProcessedResult) =>
  JSON.stringify([
    r.networkProfile.name,
    r.schemaVersion === 1 ? r.networkProfile.latencyMs / 1000 : r.networkProfile.latency,
    r.networkProfile.downloadBytesPerSec,
    r.networkProfile.uploadBytesPerSec,
  ]);
export function compareRuns(
  a: readonly (RunResult | ProcessedResult)[],
  b: readonly (RunResult | ProcessedResult)[],
  options: { seed?: number; iterations?: number } = {},
) {
  const iterations = options.iterations ?? 2000;
  if (!Number.isFinite(iterations) || !Number.isInteger(iterations) || iterations < 1)
    throw new Error('Bootstrap iterations must be a positive finite integer');
  if (options.seed !== undefined && !Number.isFinite(options.seed)) throw new Error('Bootstrap seed must be finite');
  if (!a.length || !b.length) throw new Error('Comparison requires runs in both groups');
  if (new Set([...a, ...b].map((r) => r.config.vsync)).size !== 1)
    throw new Error('Cannot compare different vsync modes');

  if (new Set([...a, ...b].map(profileKey)).size !== 1) throw new Error('Cannot compare different network profiles');
  const modes = new Set([...a, ...b].map((r) => Boolean(throughputOf(r))));
  if (modes.size > 1) throw new Error('Cannot compare completed-frame throughput with historical frame timing');
  const observations = (runs: readonly (RunResult | ProcessedResult)[]) =>
    runs
      .filter((r) => r.status === 'ok')
      .map((r) => {
        if (throughputOf(r)) {
          const duration = throughputDuration(r);
          return duration === undefined ? [] : [duration];
        }
        return r.schemaVersion === 3
          ? r.measuredIntervals.map((v) => v * 1000)
          : deriveRun(r).intervals.map((p) => p.value);
      })
      .filter((v) => v.length);
  const av = observations(a),
    bv = observations(b);
  if (!av.length || !bv.length) throw new Error('Comparison requires measured frames');
  const medianA = percentile(av.flat(), 0.5)!,
    medianB = percentile(bv.flat(), 0.5)!;
  let state = options.seed ?? 42;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const sample = (groups: number[][]) =>
    Array.from({ length: groups.length }, () => groups[Math.floor(random() * groups.length)]!).flat();
  const ratios = Array.from({ length: iterations }, () => percentile(sample(av), 0.5)! / percentile(sample(bv), 0.5)!);
  const confidenceInterval: [number, number] = [percentile(ratios, 0.025)!, percentile(ratios, 0.975)!];
  // Single repetitions cannot estimate run-to-run uncertainty: do not claim significance.
  const verdict =
    av.length < 2 || bv.length < 2
      ? 'no detectable difference'
      : confidenceInterval[1] < 1
        ? 'faster'
        : confidenceInterval[0] > 1
          ? 'slower'
          : 'no detectable difference';
  return {
    medianA,
    medianB,
    ratio: medianA / medianB,
    confidenceInterval,
    verdict,
    ...mannWhitney(av.flat(), bv.flat()),
  };
}
