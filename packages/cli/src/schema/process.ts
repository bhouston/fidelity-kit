import type { ProcessedResult, RunResult } from './index.js';
import { deriveRun, percentile, type Point } from './derive.js';

export const MAX_TIMELINE_POINTS = 512;
const costSeconds = (milliseconds: number) => Math.round(milliseconds * 100) / 100000;
const duration = (milliseconds: number | undefined) => (milliseconds === undefined ? undefined : milliseconds / 1000);
/** Keep both endpoints and each time-ordered bucket's extrema without altering statistics. */
export function downsampleExtrema(points: readonly Point[], limit = MAX_TIMELINE_POINTS): Point[] {
  if (!Number.isInteger(limit) || limit < 4 || limit > MAX_TIMELINE_POINTS)
    throw new Error('Point limit must be an integer from 4 to 512');
  if (points.length <= limit) return points.map((point) => ({ ...point }));
  const buckets = Math.floor((limit - 2) / 2);
  const result: Point[] = [{ ...points[0]! }];
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = 1 + Math.floor((bucket * (points.length - 2)) / buckets);
    const end = 1 + Math.floor(((bucket + 1) * (points.length - 2)) / buckets);
    let min = start,
      max = start;
    for (let index = start + 1; index < end; index++) {
      if (points[index]!.value < points[min]!.value) min = index;
      if (points[index]!.value > points[max]!.value) max = index;
    }
    for (const index of [...new Set([min, max])].toSorted((a, b) => a - b)) result.push({ ...points[index]! });
  }
  result.push({ ...points.at(-1)! });
  return result;
}
function optional(key: string, value: number | undefined) {
  return value === undefined ? {} : { [key]: value };
}
function longest<T extends { start: number; end: number }>(records: T[], limit: number): T[] {
  return records
    .toSorted((a, b) => b.end - b.start - (a.end - a.start))
    .slice(0, limit)
    .toSorted((a, b) => a.start - b.start);
}
const select = (points: Point[], limit = MAX_TIMELINE_POINTS) =>
  downsampleExtrema(points, limit).map((point) => point.t);
/** All statistics use complete measured raw data; only display indices are reduced. */
export function processRun(run: RunResult): ProcessedResult {
  const full = deriveRun(run);
  const eligible =
    run.status !== 'ok' && run.reporter.runStart === undefined
      ? []
      : run.reporter.frames.filter(
          (frame) =>
            (run.reporter.runStart === undefined || frame.cpuStart >= run.reporter.runStart) &&
            (run.reporter.runEnd === undefined || frame.cpuStart <= run.reporter.runEnd),
        );
  const visible = run.reporter.frames.filter(
    (frame) =>
      (run.reporter.ready === undefined || frame.cpuStart >= run.reporter.ready) &&
      (run.reporter.runEnd === undefined || frame.cpuStart <= run.reporter.runEnd),
  );
  const frameTimes = visible.map((frame) => frame.cpuStart);
  const cpuDurations = visible.map((frame) => (frame.cpuEnd >= frame.cpuStart ? frame.cpuEnd - frame.cpuStart : null));
  const gpuDurations = visible.map((frame) => {
    if (frame.gpuStart === undefined || frame.gpuEnd === undefined) return null;
    const value = Number(BigInt(frame.gpuEnd) - BigInt(frame.gpuStart)) / 1e6;
    return value >= 0 ? costSeconds(value) : null;
  });
  const intervalIndices = select(
    visible.slice(0, -1).flatMap((frame, index) => {
      const value = visible[index + 1]!.cpuStart - frame.cpuStart;
      return value > 0 ? [{ t: index, value }] : [];
    }),
  );
  const cpuIndices = select(
    visible.flatMap((frame, index) =>
      cpuDurations[index] === null ? [] : [{ t: index, value: frame.cpuEnd - frame.cpuStart }],
    ),
  );
  const gpuIndices = select(
    visible.flatMap((frame, index) =>
      gpuDurations[index] === null
        ? []
        : [{ t: index, value: Number(BigInt(frame.gpuEnd!) - BigInt(frame.gpuStart!)) / 1e6 }],
    ),
    510,
  );
  const frameIndices = [
    ...new Set([...intervalIndices, ...cpuIndices, ...gpuIndices, ...(visible.length ? [0, visible.length - 1] : [])]),
  ].toSorted((a, b) => a - b);
  const ticks = (run.reporter.watchdogTicks ?? []).filter(
    (tick) => run.reporter.runEnd === undefined || tick <= run.reporter.runEnd,
  );
  const watchdogTimes = ticks.slice();
  const watchdogIndices = select(
    ticks.slice(1).map((tick, index) => ({ t: index + 1, value: Math.max(0, tick - ticks[index]! - 0.016) })),
  );
  const statistics: ProcessedResult['statistics'] = {
    frameCount: run.reporter.throughput?.completedFrames ?? eligible.length,
    intervalCount: full.intervals.length,
    cpuSampleCount: full.cpu.length,
    gpuSampleCount: full.gpu.length,
    initMaxBlockDuration: full.initMaxBlockMs / 1000,
    initBlockedDuration: full.initBlockedMs / 1000,
    phaseDurations: Object.create(null) as Record<string, number>,
    ...optional('averageFrameDuration', duration(full.average)),
    ...optional(
      'averageFps',
      run.reporter.throughput
        ? run.reporter.throughput.completedFrames / run.reporter.throughput.elapsed
        : full.average
          ? 1000 / full.average
          : undefined,
    ),
    ...optional('maxJitter', duration(full.maxJitter)),
    ...optional('worstResponsiveness', duration(full.worstResponsiveness)),
    ...optional('median', duration(full.median)),
    ...optional('p95', duration(full.p95)),
    ...optional('p99', duration(full.p99)),
    ...optional('iqr', duration(full.iqr)),
    ...optional('mad', duration(full.mad)),
    ...optional('typicalFps', full.fps),
    ...optional('tailFps', full.p95 ? 1000 / full.p95 : undefined),
    ...optional('initDuration', duration(full.initMs)),
    ...optional('unaccountedDuration', duration(full.unaccountedMs)),
    ...optional(
      'cpuMedian',
      duration(
        percentile(
          full.cpu.map((point) => point.value),
          0.5,
        ),
      ),
    ),
    ...optional(
      'cpuP95',
      duration(
        percentile(
          full.cpu.map((point) => point.value),
          0.95,
        ),
      ),
    ),
    ...optional(
      'gpuMedian',
      duration(
        percentile(
          full.gpu.map((point) => point.value),
          0.5,
        ),
      ),
    ),
    ...optional(
      'gpuP95',
      duration(
        percentile(
          full.gpu.map((point) => point.value),
          0.95,
        ),
      ),
    ),
  };
  for (const phase of full.phases)
    if (phase.durationMs !== undefined && phase.durationMs >= 0)
      statistics.phaseDurations[phase.phase] = (statistics.phaseDurations[phase.phase] ?? 0) + phase.durationMs;

  for (const name of Object.keys(statistics.phaseDurations)) statistics.phaseDurations[name]! /= 1000;
  const phases: ProcessedResult['timeline']['phases'] = full.phases.map((phase) => ({
    phase: phase.phase,
    start: phase.start,
    ...optional('duration', duration(phase.durationMs)),
  }));
  const blocks = longest(full.blocks, 256).map((block) => ({
    start: block.start,
    duration: block.end - block.start,
    sources: [...block.sources],
  }));
  const maxTime = run.reporter.runEnd ?? Math.max(0, ...frameTimes, ...watchdogTimes);
  return {
    schemaVersion: 3,
    ...(run.reporter.convergence
      ? {
          convergence: {
            ...structuredClone(run.reporter.convergence),
            ...(() => {
              const convergence = run.reporter.convergence!;
              const start = run.reporter.runStart ?? run.reporter.ready ?? 0;
              const reached = convergence.samples.find(
                (sample) =>
                  sample.at >= start &&
                  (run.reporter.runEnd === undefined || sample.at <= run.reporter.runEnd) &&
                  (sample.psnr === null || sample.psnr >= convergence.targetPsnr),
              );
              return reached ? { timeToTarget: reached.at - start, framesToTarget: reached.frame } : {};
            })(),
          },
        }
      : {}),
    runId: run.runId,
    screenshot: run.capture !== undefined,
    ...(run.reporter.throughput ? { throughput: { ...run.reporter.throughput } } : {}),
    networkProfile: {
      name: run.networkProfile.name,
      latency: run.networkProfile.latencyMs / 1000,
      downloadBytesPerSec: run.networkProfile.downloadBytesPerSec,
      uploadBytesPerSec: run.networkProfile.uploadBytesPerSec,
    },
    ...(run.reporter.downloads
      ? {
          downloads: structuredClone(run.reporter.downloads),
        }
      : {}),
    ...(run.suiteName === undefined ? {} : { suiteName: run.suiteName }),
    entry: structuredClone(run.entry),
    config: {
      duration: run.config.durationMs / 1000,
      vsync: run.config.vsync,
      ...(run.config.phaseColors === undefined ? {} : { phaseColors: { ...run.config.phaseColors } }),
    },
    ...(run.environment === undefined ? {} : { environment: structuredClone(run.environment) }),
    status: run.status,
    ...(run.error === undefined ? {} : { error: { ...run.error } }),
    statistics,
    timeline: {
      maxTime,
      ...optional('renderStart', run.reporter.renderStart),
      ...optional('ready', run.reporter.ready),
      ...optional('runStart', run.reporter.runStart),
      ...optional('runEnd', run.reporter.runEnd),
      frameTimes,
      cpuDurations,
      gpuDurations,
      frameIndices,
      watchdogTimes,
      watchdogIndices,
      watchdogPeriod: 0.016,
      phases,
      blocks,
    },
    measuredIntervals: full.intervals.map((point) => point.value / 1000),
    timing: {
      harness: { ...run.harness },
      reporter: Object.fromEntries(
        ['navigationStart', 'ready', 'renderStart', 'runStart', 'runEnd'].flatMap((key) => {
          const value = run.reporter[key as keyof typeof run.reporter];
          return typeof value === 'number' ? [[key, value]] : [];
        }),
      ),
    },
  };
}
