import { Link, getRouteApi } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { TemporalRecord } from 'fidelity-kit';
import { formatMetric } from '#/lib/view';

const root = getRouteApi('__root__');

type Metric = 'psnr' | 'temporalPsnr' | 'sharpness';
const METRICS: { id: Metric; label: string; description: string }[] = [
  { id: 'psnr', label: 'Sequence PSNR (dB)', description: 'Error of every measured frame against the reference.' },
  {
    id: 'temporalPsnr',
    label: 'Temporal PSNR (dB)',
    description: 'Error of the frame-to-frame change: flicker, shimmering and lag. Higher is more stable.',
  },
  {
    id: 'sharpness',
    label: 'Sharpness',
    description:
      'Gradient energy relative to the reference: below 1 is blurrier, above 1 has extra edges (aliasing or noise).',
  },
];

/** Higher is better for PSNR; for sharpness the value closest to 1 is best. */
const quality = (metric: Metric, value: number | null | undefined) =>
  value === undefined
    ? -Infinity
    : value === null
      ? Infinity
      : metric === 'sharpness'
        ? -Math.abs(Math.log(value))
        : value;

/** Arithmetic mean of the finite values; infinite PSNR (identical images) is skipped. */
function mean(values: (number | null | undefined)[]) {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : undefined;
}

/** Renderer × scene table of dynamic (temporal) fidelity summaries. */
export function DynamicPage() {
  const { index, scenes, dynamic, site } = root.useLoaderData();
  const [metric, setMetric] = useState<Metric>('psnr');
  if (!dynamic) return <p className="p-6">No temporal fidelity results. Run `fidelity-kit temporal`.</p>;
  const labels = new Map(index.config.renderers.map((r) => [r.id, r.label ?? r.id]));
  const categories = new Map(index.config.renderers.map((r) => [r.id, r.category]));
  const present = new Set(Object.values(dynamic.results).flatMap((row) => Object.keys(row)));
  const renderers = [
    ...index.config.renderers.map((r) => r.id).filter((id) => present.has(id)),
    ...[...present].filter((id) => !labels.has(id)),
  ];
  const paths = Object.keys(dynamic.results).toSorted();
  const title = (path: string) => scenes.find((scene) => scene.path === path)?.title ?? path;
  const value = (path: string, renderer: string) => dynamic.results[path]?.[renderer]?.[metric];
  const missingLabel = (path: string, renderer: string) => {
    const definition = site?.registry.scenes.find((scene) => (scene.path ?? scene.id) === path);
    const selected = definition?.dynamic?.renderers ?? site?.registry.dynamic?.renderers;
    return selected && !selected.includes(renderer) ? 'Not applicable' : 'Missing result';
  };
  const digits = metric === 'sharpness' ? 3 : 2;
  const best = new Map(
    paths.map((path) => [path, Math.max(...renderers.map((renderer) => quality(metric, value(path, renderer))))]),
  );
  const description = METRICS.find((m) => m.id === metric)!.description;
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold">Temporal fidelity</h1>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Animated sequences compared frame by frame with{' '}
        <strong>{labels.get(dynamic.reference) ?? dynamic.reference}</strong>. Warm-up frames are excluded and the best
        value of each scene is bold. Means only average the scenes a renderer ran on (n), so compare renderers within a
        scene. {description}
      </p>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="sr-only">Metric</legend>
        {METRICS.map((m) => (
          <button
            aria-pressed={metric === m.id}
            className={`rounded border px-3 py-1 text-sm ${metric === m.id ? 'border-foreground bg-foreground text-background' : 'border-input'}`}
            key={m.id}
            onClick={() => setMetric(m.id)}
            type="button"
          >
            {m.label}
          </button>
        ))}
      </fieldset>
      <div className="overflow-x-auto">
        <table className="border-collapse font-mono text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-background p-2 text-left font-sans">Renderer</th>
              {paths.map((path) => (
                <th className="max-w-40 p-2 text-right align-bottom font-sans font-normal" key={path}>
                  <Link
                    className="underline underline-offset-4"
                    search={{ view: 'temporal', scene: path, output: dynamic.output, ref: dynamic.reference }}
                    to="/"
                  >
                    {title(path)}
                  </Link>
                </th>
              ))}
              <th className="p-2 text-right align-bottom font-sans">Mean (n)</th>
            </tr>
          </thead>
          <tbody>
            {renderers.map((renderer, row) => {
              const values = paths.map((path) => value(path, renderer));
              const covered = values.filter((v) => v !== undefined);
              const average = mean(values);
              const category = categories.get(renderer);
              const newCategory = row > 0 && category !== categories.get(renderers[row - 1]!);
              return (
                <tr
                  className={`border-b border-border ${newCategory ? 'border-t-2 border-t-foreground/30' : ''}`}
                  key={renderer}
                >
                  <th className="sticky left-0 whitespace-nowrap bg-background p-2 text-left font-sans font-normal">
                    {labels.get(renderer) ?? renderer}
                  </th>
                  {values.map((v, i) => (
                    <td
                      className={`p-2 text-right ${v !== undefined && quality(metric, v) === best.get(paths[i]!) ? 'font-bold' : ''}`}
                      key={paths[i]}
                    >
                      {v === undefined ? (
                        <span className="font-sans text-muted-foreground">{missingLabel(paths[i]!, renderer)}</span>
                      ) : (
                        formatMetric(v, digits)
                      )}
                    </td>
                  ))}
                  <td className="whitespace-nowrap p-2 text-right text-muted-foreground">
                    {formatMetric(average, digits)} ({covered.length})
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Per-frame PSNR and temporal PSNR of one dynamic comparison, loaded from its sidecar. */
export function TemporalSparkline({ url }: { url: string }) {
  const [record, setRecord] = useState<TemporalRecord | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((response) => (response.ok ? (response.json() as Promise<TemporalRecord>) : null))
      .then((json) => {
        if (!cancelled) setRecord(json);
      })
      .catch(() => {
        if (!cancelled) setRecord(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!record) return null;
  const series = [
    { values: record.perFrame.psnr, className: 'stroke-blue-500', label: 'PSNR' },
    { values: record.perFrame.temporalPsnr, className: 'stroke-amber-500', label: 'Temporal PSNR' },
  ];
  const finite = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (!finite.length) return null;
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const width = 400;
  const height = 80;
  const x = (i: number) => (i / Math.max(1, record.perFrame.psnr.length - 1)) * width;
  const y = (v: number) => height - 4 - ((v - low) / Math.max(1e-6, high - low)) * (height - 8);
  return (
    <figure className="mt-2 max-w-md">
      <svg aria-label="Per-frame PSNR" className="w-full border border-border" viewBox={`0 0 ${width} ${height}`}>
        {series.map((s) => (
          <polyline
            className={`fill-none ${s.className}`}
            key={s.label}
            points={s.values
              .map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
              .filter(Boolean)
              .join(' ')}
            strokeWidth={1.5}
          />
        ))}
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        Per frame, {formatMetric(low)}–{formatMetric(high)} dB: <span className="text-blue-500">PSNR</span> and{' '}
        <span className="text-amber-500">temporal PSNR</span>
      </figcaption>
    </figure>
  );
}
