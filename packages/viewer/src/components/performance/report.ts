import type { ProcessedResult, PhaseColorConfig } from 'fidelity-kit/schema';

export type SortKey = 'initTime' | 'avgFrameRate' | 'maxJitter' | 'worstResponsiveness' | 'download' | 'timeToTarget';
export type SortDirection = 'bestFirst' | 'worstFirst';
export type MetricGrade = 'good' | 'warn' | 'bad' | 'none';
export const gradeColors: Record<MetricGrade, string> = {
  good: 'rgb(34,197,94)',
  warn: 'rgb(249,115,22)',
  bad: 'rgb(239,68,68)',
  none: 'var(--muted-foreground)',
};
// Values are milliseconds except FPS and download bytes. A higher FPS is better; other metrics are lower-is-better.
export const metricTable = {
  initTime: { label: 'Init time', sign: 1, good: 250, warn: 500 },
  avgFrameRate: { label: 'Average frame rate', sign: -1, good: -60, warn: -30 },
  maxJitter: { label: 'Max jitter', sign: 1, good: 5, warn: 15 },
  worstResponsiveness: { label: 'Worst responsiveness', sign: 1, good: 50, warn: 300 },
  timeToTarget: { label: 'Time to PSNR', sign: 1, good: Infinity, warn: Infinity },
  download: { label: 'Download', sign: 1, good: Infinity, warn: Infinity },
} as const;
export function gradeMetric(key: SortKey, value: number | undefined): MetricGrade {
  if (key === 'download' || key === 'timeToTarget') return 'none';
  if (value === undefined || !Number.isFinite(value)) return 'none';
  const rule = metricTable[key],
    score = value * rule.sign;
  if (key === 'avgFrameRate') return score <= rule.good ? 'good' : score <= rule.warn ? 'warn' : 'bad';
  return score < rule.good ? 'good' : score < rule.warn ? 'warn' : 'bad';
}
const ms = (v: number | undefined) => (v === undefined ? undefined : v * 1000);
const missing = (v: number | undefined) => v === undefined || !Number.isFinite(v);
export function cardMetrics(result: ProcessedResult): Record<SortKey, number | undefined> {
  const s = result.statistics;
  return {
    initTime: ms(s.initDuration),
    timeToTarget: ms(result.convergence?.timeToTarget),
    avgFrameRate: s.averageFps,
    maxJitter: ms(s.maxJitter),
    worstResponsiveness: ms(s.worstResponsiveness),
    download: result.downloads?.reduce((total, report) => total + report.totalTransferBytes, 0),
  };
}
export function compareMetrics(a: ProcessedResult, b: ProcessedResult, key: SortKey, direction: SortDirection): number {
  const left = cardMetrics(a)[key],
    right = cardMetrics(b)[key];
  if (missing(left) || missing(right)) return Number(missing(left)) - Number(missing(right));
  return (left! - right!) * metricTable[key].sign * (direction === 'bestFirst' ? 1 : -1);
}
/** An unfinished phase extends to render start when it is available. */
export function phaseEnd(phase: { start: number; duration?: number }, renderStart?: number): number {
  return phase.duration === undefined ? (renderStart ?? phase.start) : phase.start + phase.duration;
}
export function phaseColor(name: string, colors?: PhaseColorConfig): string {
  if (colors && Object.hasOwn(colors, name)) return colors[name]!;
  if (name === 'unknown') return '#94a3b8';
  let hash = 2166136261;
  for (const character of name) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  // Reserve red/orange/green for metric grades; phase hues stay in the cyan/blue/violet range.
  return `hsl(${190 + ((hash >>> 0) % 111)} 65% 58%)`;
}
/** Four equal divisions using the requested ladder, extended for large stalls. */
export function chartScale(max: number) {
  let factor = 1;
  while (max > 400 * factor) factor *= 10;
  const step = [5, 10, 25, 50, 100].map((v) => v * factor).find((v) => 4 * v >= max) ?? 100 * factor;
  return { max: 4 * step, ticks: [0, 1, 2, 3, 4].map((v) => v * step) };
}
// Length prefixes keep renderer/scene pairs unique even when IDs contain separators. Results are
// unique within one machine; the selected machine is carried separately in the route.
export function resultId(result: ProcessedResult): string {
  return `${result.entry.renderer.id.length}-${result.entry.renderer.id}-${result.entry.scene.id}`;
}
export function readRoute(url: URL) {
  const sort = url.searchParams.get('performanceSort');
  return {
    sort: sort && Object.hasOwn(metricTable, sort) ? (sort as SortKey) : ('avgFrameRate' as SortKey),
    direction: url.searchParams.get('dir') === 'worstFirst' ? ('worstFirst' as const) : ('bestFirst' as const),
    result: url.searchParams.get('result'),
    query: url.searchParams.get('q') ?? '',
    machine: url.searchParams.get('machine') ?? '',
    renderer: url.searchParams.get('renderer') ?? '',
    scene: url.searchParams.get('scene') ?? '',
  };
}

/** Shared temporal geometry, including a permanent right margin for statistics and the PSNR axis. */
export function chartLayout(width: number, maxTime: number) {
  const left = 44,
    right = Math.max(left + 1, width - 160);
  const end = Math.max(maxTime, 0.001);
  return { left, right, x: (seconds: number) => left + (Math.min(end, Math.max(0, seconds)) / end) * (right - left) };
}
export function timeTicks(maxTime: number, plotWidth: number) {
  const desired = maxTime / Math.max(1, Math.floor(plotWidth / 50));
  const factor = 10 ** Math.floor(Math.log10(Math.max(desired, 0.001)));
  const step = [1, 2, 5, 10].map((value) => value * factor).find((value) => value >= desired) ?? 10 * factor;
  const ticks = Array.from({ length: Math.floor(maxTime / step) + 1 }, (_, index) =>
    Number((index * step).toPrecision(10)),
  );
  if (Math.abs(ticks.at(-1)! - maxTime) > 1e-8) {
    if (maxTime - ticks.at(-1)! < step * 0.6 && ticks.length > 1) ticks.pop();
    ticks.push(maxTime);
  }
  return ticks;
}
