import type { SessionReporter } from './host.js';

export interface SetupMetric {
  totalMs: number;
  phases: { name: string; startMs: number; durationMs: number }[];
}
export interface FrameMetric {
  seconds: number;
  fps: number;
  cpuMs: number;
}

/** Local UI telemetry only: no protocol messages, persisted results, or finite run window. */
export function createLiveTelemetry(
  onSetup: (metric: SetupMetric) => void,
  onFrame: (metric: FrameMetric) => void,
  now = () => performance.now(),
) {
  const started = now();
  const phases = [{ name: 'load', startMs: 0, endMs: undefined as number | undefined }];
  let readyAt: number | undefined;
  let sampleAt = started;
  let frames = 0;
  let cpuMs = 0;
  const reporter: SessionReporter = {
    phaseStart(name) {
      phases.push({ name, startMs: now() - started, endMs: undefined });
      return phases.length - 1;
    },
    phaseEnd(id) {
      const phase =
        typeof id === 'number' ? phases[id] : phases.findLast((p) => p.name === id && p.endMs === undefined);
      if (phase) phase.endMs = now() - started;
    },
    environment() {},
    async convergence() {},
    ready() {
      readyAt = sampleAt = now();
      onSetup({
        totalMs: readyAt - started,
        phases: phases.map((p) => ({
          name: p.name,
          startMs: p.startMs,
          durationMs: (p.endMs ?? readyAt! - started) - p.startMs,
        })),
      });
    },
    frameBegin() {
      return readyAt === undefined ? -1 : now();
    },
    frameEnd(token) {
      if (token < 0) return;
      frames++;
      cpuMs += now() - token;
    },
  };
  return {
    reporter,
    sample() {
      if (readyAt === undefined) return;
      const time = now();
      const elapsed = time - sampleAt;
      if (elapsed <= 0) return;
      onFrame({ seconds: (time - readyAt) / 1000, fps: (frames * 1000) / elapsed, cpuMs: frames ? cpuMs / frames : 0 });
      sampleAt = time;
      frames = cpuMs = 0;
    },
  };
}
