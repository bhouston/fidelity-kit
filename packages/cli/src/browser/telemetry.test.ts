import { expect, it } from 'vitest';
import { createLiveTelemetry, type FrameMetric, type SetupMetric } from './telemetry.js';

it('keeps loading frames out of live FPS and reports completed and open setup phases at readiness', () => {
  let clock = 100;
  const setup: SetupMetric[] = [];
  const frames: FrameMetric[] = [];
  const telemetry = createLiveTelemetry(
    (metric) => setup.push(metric),
    (metric) => frames.push(metric),
    () => clock,
  );
  const loadingFrame = telemetry.reporter.frameBegin();
  clock = 120;
  telemetry.reporter.frameEnd(loadingFrame);
  telemetry.sample();
  expect(setup).toEqual([]);
  expect(frames).toEqual([]);
  const outer = telemetry.reporter.phaseStart('assets');
  clock = 130;
  telemetry.reporter.phaseStart('assets');
  clock = 140;
  telemetry.reporter.phaseEnd('assets'); // The most recently opened phase with that name.
  clock = 150;
  telemetry.reporter.phaseEnd(outer);
  telemetry.reporter.phaseStart('pipeline');
  clock = 200;
  telemetry.reporter.ready();
  expect(setup).toEqual([
    {
      totalMs: 100,
      phases: [
        { name: 'load', startMs: 0, durationMs: 100 },
        { name: 'assets', startMs: 20, durationMs: 30 },
        { name: 'assets', startMs: 30, durationMs: 10 },
        { name: 'pipeline', startMs: 50, durationMs: 50 },
      ],
    },
  ]);
  clock = 1200;
  telemetry.sample();
  expect(frames).toEqual([{ seconds: 1, fps: 0, cpuMs: 0 }]);
});

it('uses actual sample elapsed time and resets the window instead of accumulating FPS forever', () => {
  let clock = 0;
  const frames: FrameMetric[] = [];
  const telemetry = createLiveTelemetry(
    () => {},
    (metric) => frames.push(metric),
    () => clock,
  );
  telemetry.reporter.ready();
  for (const duration of [4, 6]) {
    const token = telemetry.reporter.frameBegin();
    clock += duration;
    telemetry.reporter.frameEnd(token);
  }
  clock = 2000; // A delayed one-second interval must not double the apparent FPS.
  telemetry.sample();
  telemetry.sample(); // A zero-length window produces no extra sample.
  clock = 2500;
  const token = telemetry.reporter.frameBegin();
  clock += 3;
  telemetry.reporter.frameEnd(token);
  clock = 3000;
  telemetry.sample();
  expect(frames).toEqual([
    { seconds: 2, fps: 1, cpuMs: 5 },
    { seconds: 3, fps: 1, cpuMs: 3 },
  ]);
});
