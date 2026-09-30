import { createFileRoute, getRouteApi, notFound, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { MetricsRecord } from 'fidelity-kit';
import Header from '#/components/Header';
import { Markdown } from '#/components/Markdown';
import { ResultImage, type ImageSize } from '#/components/ResultImage';
import { ViewControls } from '#/components/ViewControls';
import { getReadme } from '#/lib/data';
import {
  deltaUrl,
  formatMetric,
  metricsOf,
  psnrClassName,
  renderUrl,
  resolveView,
  sceneSize,
  validateViewSearch,
} from '#/lib/view';

const root = getRouteApi('__root__');

export const Route = createFileRoute('/scenes/$')({
  validateSearch: validateViewSearch,
  loader: ({ params }) => getReadme(params._splat ?? ''),
  component: SceneDetail,
});

function SceneDetail() {
  const readme = Route.useLoaderData();
  const { index, hashes, scenes } = root.useLoaderData();
  const search = Route.useSearch();
  const path = Route.useParams()._splat ?? '';
  const scene = scenes.find((s) => s.path === path);
  const navigate = useNavigate({ from: Route.fullPath });
  if (!scene) throw notFound();
  const view = resolveView(index, search, hashes);
  const compared = view.compared.filter((r) => scene.images[view.output]?.includes(r));
  const size = sceneSize(index, scene, view);

  return (
    <>
      <Header scenePath={scene.path} search={search} title={index.config.title}>
        <ViewControls
          index={index}
          onChange={(patch) => void navigate({ replace: true, search: (prev) => ({ ...prev, ...patch }) })}
          view={view}
        />
      </Header>
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold">{scene.title}</h1>
        {readme ? <Markdown>{readme}</Markdown> : null}
        <section className="grid gap-4 md:grid-cols-4">
          {[view.ref, ...compared].map((r) => (
            <figure key={r}>
              <ResultImage alt={r} size={size} src={renderUrl(scene, view, r)} />
              <figcaption className="mt-1 text-center text-sm text-muted-foreground">
                {view.label(r)}
                {r === view.ref ? ' (reference)' : ''}
              </figcaption>
            </figure>
          ))}
        </section>
        {compared.map((r) => (
          <Comparison
            delta={view.showDeltas ? deltaUrl(index, scene, view, r) : undefined}
            image={renderUrl(scene, view, r)}
            key={r}
            label={view.label(r)}
            metrics={metricsOf(index, scene, view, r)}
            reference={renderUrl(scene, view, view.ref)}
            refLabel={view.label(view.ref)}
            showDelta={view.showDeltas}
            size={size}
          />
        ))}
      </div>
    </>
  );
}

function Comparison({
  label,
  refLabel,
  reference,
  image,
  delta,
  showDelta,
  metrics,
  size,
}: {
  label: string;
  refLabel: string;
  reference?: string;
  image?: string;
  delta?: string;
  showDelta: boolean;
  metrics?: MetricsRecord;
  size?: ImageSize;
}) {
  const [split, setSplit] = useState(50);
  return (
    <section>
      <h2 className="mb-2 font-semibold">
        {label} vs {refLabel}
      </h2>
      <div className={`grid gap-4 ${showDelta ? 'md:grid-cols-2' : ''}`}>
        <figure>
          {reference && image ? (
            <div className="relative select-none">
              <img
                alt={label}
                className="block w-full border border-border"
                decoding="async"
                loading="lazy"
                src={image}
              />
              <img
                alt={refLabel}
                className="absolute inset-0 block w-full border border-border"
                decoding="async"
                height={size?.height}
                loading="lazy"
                src={reference}
                width={size?.width}
                style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              />
              <div className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: `${split}%` }} />
              <input
                aria-label={`Compare split for ${label}`}
                className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
                max={100}
                min={0}
                onChange={(e) => setSplit(Number(e.currentTarget.value))}
                type="range"
                value={split}
              />
            </div>
          ) : (
            <ResultImage alt={`${label} comparison`} size={size} />
          )}
          <figcaption className="mt-1 text-center text-sm text-muted-foreground">
            {refLabel} (left) / {label} (right) — drag to swipe
          </figcaption>
        </figure>
        {showDelta ? (
          <figure>
            <ResultImage alt={`${label} delta`} size={size} src={delta} />
            <figcaption className="mt-1 text-center text-sm text-muted-foreground">{label} delta</figcaption>
          </figure>
        ) : null}
      </div>
      <div className="mt-3">
        {metrics ? (
          <dl className={`grid max-w-md grid-cols-2 gap-x-4 gap-y-1 p-2 font-mono text-sm ${psnrClassName(metrics)}`}>
            <dt>PSNR (dB)</dt>
            <dd>{formatMetric(metrics.psnr)}</dd>
            <dt>RMSE</dt>
            <dd>{formatMetric(metrics.rmse, 5)}</dd>
            <dt>MAE</dt>
            <dd>{formatMetric(metrics.mae, 5)}</dd>
            <dt>Max error</dt>
            <dd>{formatMetric(metrics.maxError, 5)}</dd>
            <dt>Size</dt>
            <dd>
              {metrics.width}×{metrics.height}
            </dd>
            <dt>Generated</dt>
            <dd>{metrics.generatedAt}</dd>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">No metrics yet. Run `fidelity-kit process`.</p>
        )}
      </div>
    </section>
  );
}
