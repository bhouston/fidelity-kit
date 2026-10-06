// oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG charts need an accessible image role, not an img element.
import type { FrameMetric, SetupMetric } from './browser/telemetry.js';

const phaseColors = ['var(--chart-load)', 'var(--chart-process)', 'var(--chart-compile)'];
const ms = (value: number) => `${value.toFixed(1)} ms`;

export function SetupChart({ setup }: { setup?: SetupMetric }) {
  return (
    <section className="live-panel" aria-label="Setup time chart">
      <h2>
        Setup time <small>Until first completed frame</small>
      </h2>
      {setup ? (
        <>
          <strong>{ms(setup.totalMs)}</strong>
          <svg viewBox="0 0 1000 40" role="img" aria-label="Load, process and compile setup timeline">
            {setup.phases.map((phase, index) => (
              <rect
                key={phase.name}
                x={(phase.startMs / setup.totalMs) * 1000}
                width={Math.max(1, (phase.durationMs / setup.totalMs) * 1000)}
                y="0"
                height="40"
                fill={phaseColors[index]}
              >
                <title>
                  {phase.name}: {ms(phase.durationMs)}
                </title>
              </rect>
            ))}
          </svg>
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {setup.phases.map((phase) => (
                <tr key={phase.name}>
                  <td>{phase.name}</td>
                  <td>{ms(phase.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p>Setup measurements appear after the first frame completes.</p>
      )}
    </section>
  );
}

export interface TimeSeriesSample {
  seconds: number;
  value: number;
  detail?: string;
}

/** A reusable elapsed-time line chart; callers provide samples and axis labels. */
export function TimeSeriesChart({
  samples,
  yLabel,
  xLabel = 's',
  minMaximum = 1,
  label,
}: {
  samples: TimeSeriesSample[];
  yLabel: string;
  xLabel?: string;
  minMaximum?: number;
  label: string;
}) {
  const maximum = Math.max(minMaximum, ...samples.map((sample) => sample.value));
  const start = samples.length > 1 ? samples[0]!.seconds : 0;
  const end = Math.max(start + 10, samples.at(-1)?.seconds ?? 10);
  const x = (seconds: number) => 50 + ((seconds - start) / (end - start)) * 930;
  const y = (value: number) => 170 - (value / maximum) * 150;
  const points = samples.map((sample) => `${x(sample.seconds)},${y(sample.value)}`).join(' ');
  return (
    <svg viewBox="0 0 1000 210" role="img" aria-label={`${label}, ${samples.length} samples`}>
      <text x="50" y="12">
        {yLabel}
      </text>
      {[0, 0.5, 1].map((fraction) => (
        <g key={fraction}>
          <line x1="50" x2="980" y1={y(maximum * fraction)} y2={y(maximum * fraction)} stroke="var(--chart-grid)" />
          <text x="42" y={y(maximum * fraction) + 4} textAnchor="end">
            {Math.round(maximum * fraction)}
          </text>
        </g>
      ))}
      <polyline fill="none" stroke="var(--foreground)" strokeWidth="2" points={points} />
      {samples.map((sample) => (
        <circle key={sample.seconds} cx={x(sample.seconds)} cy={y(sample.value)} r="3" fill="var(--foreground)">
          <title>
            {sample.detail ?? `${sample.seconds.toFixed(1)} ${xLabel}: ${sample.value.toFixed(1)} ${yLabel}`}
          </title>
        </circle>
      ))}
      <text x="50" y="198">
        {start.toFixed(0)} {xLabel}
      </text>
      <text x="980" y="198" textAnchor="end">
        {end.toFixed(0)} {xLabel}
      </text>
    </svg>
  );
}

export function FrameChart({ frames }: { frames: FrameMetric[] }) {
  const latest = frames.at(-1);
  return (
    <section className="live-panel" aria-label="Frame rate chart">
      <h2>
        Frame rate <small>Updated once per second · last 300 samples</small>
      </h2>
      <div className="live-summary">
        <strong aria-label="Live frame rate">{latest ? `${latest.fps.toFixed(1)} FPS` : '— FPS'}</strong>
        <span>{latest ? `${ms(latest.cpuMs)} CPU / frame` : 'Waiting for frames'}</span>
      </div>
      <TimeSeriesChart
        label="Frame rate timeline"
        yLabel="FPS"
        minMaximum={60}
        samples={frames.map((frame) => ({
          seconds: frame.seconds,
          value: frame.fps,
          detail: `${frame.seconds.toFixed(1)} s: ${frame.fps.toFixed(1)} FPS, ${ms(frame.cpuMs)} CPU`,
        }))}
      />
    </section>
  );
}
