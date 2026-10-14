import { Link, getRouteApi, notFound, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { MetricsRecord, TemporalSummary } from 'fidelity-kit';
import { ComparisonMetrics } from './ComparisonMetrics';
import { TemporalSparkline } from '#/components/DynamicPage';
import { temporalFile } from 'fidelity-kit/paths';
import { BookmarkHeading } from '#/components/BookmarkHeading';
import Header from '#/components/Header';
import { Markdown } from '#/components/Markdown';
import { ResultImage, type ImageSize } from '#/components/ResultImage';
import { ViewControls } from '#/components/ViewControls';
import { deltaUrl, fileUrl, metricsOf, renderUrl, resolveView, sceneSize, type ViewSearch } from '#/lib/view';

const root = getRouteApi('__root__');

const indexRoute = getRouteApi('/');

/** Detail page for `/?scene=<path>`; rendered by the index route. */
export function SceneDetail({
  path,
  readme,
  temporal = false,
}: {
  path: string;
  readme: string | null;
  temporal?: boolean;
}) {
  const { index: originalIndex, hashes, scenes, dynamic, site } = root.useLoaderData();
  const index =
    temporal && dynamic
      ? {
          ...originalIndex,
          config: {
            ...originalIndex.config,
            outputs: originalIndex.config.outputs.filter((output) => output.id === dynamic.output),
            renderers: originalIndex.config.renderers
              .filter((renderer) => renderer.id === dynamic.reference || Boolean(dynamic.results[path]?.[renderer.id]))
              .map((renderer) => ({ ...renderer, reference: renderer.id === dynamic.reference })),
          },
        }
      : {
          ...originalIndex,
          config: {
            ...originalIndex.config,
            outputs: originalIndex.config.outputs.filter(
              (output) => output.kind !== 'temporal' && output.id !== dynamic?.output,
            ),
          },
        };
  const requestedSearch = indexRoute.useSearch();
  const search = temporal ? { ...requestedSearch, view: 'temporal' as const } : requestedSearch;
  const scene = scenes.find((s) => s.path === path);
  const navigate = useNavigate({ from: '/' });
  if (
    !scene ||
    (!temporal && site?.registry.scenes.find((item) => (item.path ?? item.id) === path)?.staticFidelity === false)
  )
    throw notFound();
  const view = resolveView(
    index,
    temporal && dynamic ? { ...search, output: dynamic.output, ref: dynamic.reference } : search,
    hashes,
  );
  if (temporal && dynamic)
    view.compared = view.compared.filter((renderer) => Boolean(dynamic.results[path]?.[renderer]));
  const compared = view.compared;
  const sequence = site?.registry.scenes.find((item) => (item.path ?? item.id) === path)?.dynamic;
  const size =
    temporal && sequence ? { width: sequence.width, height: sequence.height } : sceneSize(index, scene, view);
  if (temporal) view.showDeltas = false;

  return (
    <>
      <Header logo={index.config.logo} scenePath={scene.path} search={search} title={index.config.title}>
        <ViewControls
          index={index}
          showDeltaControl={!temporal}
          onChange={(patch) =>
            void navigate({
              replace: true,
              search: (prev) => ({
                ...prev,
                ...patch,
                renderer: patch.renderers !== undefined ? undefined : prev.renderer,
              }),
            })
          }
          view={view}
        />
      </Header>
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 py-6 sm:px-6">
        <h1 className="text-xl font-semibold">
          {scene.title} · {temporal ? 'Temporal fidelity' : 'Static fidelity'}
        </h1>
        {readme ? <Markdown>{readme}</Markdown> : null}
        <section className="grid gap-4 md:grid-cols-4">
          {[view.ref, ...compared].map((r) => (
            <figure key={r}>
              {r === view.ref ? (
                <ResultImage alt={r} size={size} src={renderUrl(scene, view, r)} />
              ) : (
                <Link hash={`vs-${r}`} search={{ ...search, scene: scene.path }} to="/">
                  <ResultImage alt={r} size={size} src={renderUrl(scene, view, r)} />
                </Link>
              )}
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
            id={`vs-${r}`}
            key={r}
            label={view.label(r)}
            metrics={temporal ? undefined : metricsOf(index, scene, view, r)}
            isTemporal={temporal}
            reference={renderUrl(scene, view, view.ref)}
            refLabel={view.label(view.ref)}
            scenePath={scene.path}
            search={search}
            showDelta={view.showDeltas}
            size={size}
            temporal={
              temporal && dynamic && dynamic.output === view.output && dynamic.reference === view.ref
                ? dynamic.results[scene.path]?.[r]
                : undefined
            }
            temporalUrl={fileUrl(scene.path, view.output, temporalFile(r), hashes)}
          />
        ))}
      </div>
    </>
  );
}

function Comparison({
  id,
  scenePath,
  search,
  label,
  refLabel,
  reference,
  image,
  delta,
  showDelta,
  metrics,
  size,
  temporal,
  temporalUrl,
  isTemporal,
}: {
  id: string;
  scenePath: string;
  search: ViewSearch;
  label: string;
  refLabel: string;
  reference?: string;
  image?: string;
  delta?: string;
  showDelta: boolean;
  metrics?: MetricsRecord;
  size?: ImageSize;
  temporal?: TemporalSummary;
  temporalUrl: string;
  isTemporal: boolean;
}) {
  const [split, setSplit] = useState(50);
  return (
    <section>
      <BookmarkHeading
        anchor={
          <Link
            aria-label={`Link to ${refLabel} vs ${label}`}
            hash={id}
            search={{ ...search, scene: scenePath }}
            to="/"
          >
            #
          </Link>
        }
        as="h2"
        className="mb-2 font-semibold"
        id={id}
      >
        {refLabel} vs {label}
      </BookmarkHeading>
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
              <div
                className="pointer-events-none absolute inset-y-0 w-[3px] -translate-x-1/2 bg-blue-500"
                style={{ left: `${split}%` }}
              />
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
            <ResultImage alt={`${label} comparison`} size={size} unavailable />
          )}
          <figcaption className="mt-1 text-center text-sm text-muted-foreground">
            {refLabel} (left) / {label} (right) — drag to swipe
          </figcaption>
        </figure>
        {showDelta ? (
          <figure>
            <ResultImage alt={`${label} delta`} size={size} src={delta} unavailable={!reference || !image} />
            <figcaption className="mt-1 text-center text-sm text-muted-foreground">{label} delta</figcaption>
          </figure>
        ) : null}
      </div>
      <div className="mt-3">
        <ComparisonMetrics metrics={metrics} temporal={temporal} isTemporal={isTemporal} />
        {temporal ? <TemporalSparkline url={temporalUrl} /> : null}
      </div>
    </section>
  );
}
