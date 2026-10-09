import { HomePage } from '#/components/HomePage';

import { Link, createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { SceneNode, SuiteIndex } from 'fidelity-kit';
import { BookmarkHeading } from '#/components/BookmarkHeading';
import Header from '#/components/Header';
import { Markdown } from '#/components/Markdown';
import { ResultImage } from '#/components/ResultImage';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { SortSelect, ViewControls } from '#/components/ViewControls';
import { SceneDetail } from '#/components/SceneDetail';
import { getPreamble, getReadme } from '#/lib/data';
import {
  allTags,
  deltaUrl,
  formatMetric,
  metricsOf,
  psnrClassName,
  renderUrl,
  resolveView,
  sceneSize,
  selectScenes,
  validateViewSearch,
  type View,
  type ViewSearch,
} from '#/lib/view';

const PerformancePage = lazy(() =>
  import('#/components/performance/main').then((module) => ({ default: module.PerformancePage })),
);
const LivePage = lazy(() => import('#/components/LivePage').then((module) => ({ default: module.LivePage })));
const root = getRouteApi('__root__');

export const Route = createFileRoute('/')({
  validateSearch: validateViewSearch,
  loaderDeps: ({ search }) => ({
    scene: search.view === 'fidelity' || (!search.view && search.scene) ? search.scene : undefined,
  }),
  // the page content: a scene's README (`?scene=`) or the suite preamble
  loader: ({ deps }) => (deps.scene ? getReadme(deps.scene) : getPreamble()),
  component: Index,
});

function Index() {
  const content = Route.useLoaderData();
  const { scene, view } = Route.useSearch();
  if (view === 'live')
    return (
      <Suspense fallback={<p className="p-6">Loading live viewer…</p>}>
        <LivePage />
      </Suspense>
    );
  if (view === 'performance')
    return (
      <Suspense fallback={<p className="p-6">Loading performance results…</p>}>
        <PerformancePage />
      </Suspense>
    );
  if ((!view && !scene) || view === 'home') return <HomePage readme={content} />;
  return scene ? <SceneDetail path={scene} readme={content} /> : <SceneList preamble={content} />;
}

function SceneList({ preamble }: { preamble: string | null }) {
  const { index, hashes, scenes } = root.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const update = (patch: Partial<ViewSearch>) =>
    void navigate({ replace: true, search: (prev) => ({ ...prev, ...patch }) });
  const view = resolveView(index, search, hashes);
  const shown = selectScenes(index, scenes, search, view);
  const [q, setQ] = useState(search.q ?? '');
  const tags = allTags(scenes);
  const families = [...new Set(scenes.map((s) => s.category ?? 'Other'))];
  const selectedFamilies = new Set(search.groups?.split(',') ?? families);
  const active = search.tags?.split(',') ?? [];

  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = q.trim() ? q : undefined;
      if (next !== search.q) update({ q: next });
    }, 300);
    return () => window.clearTimeout(id);
  });

  const toggleTag = (t: string) => {
    const next = active.includes(t) ? active.filter((x) => x !== t) : [...active, t];
    update({ tags: next.length ? next.join(',') : undefined });
  };

  return (
    <>
      <Header logo={index.config.logo} search={search} title={index.config.title}>
        <Input
          aria-label="Filter scenes"
          className="md:w-64"
          onChange={(e) => setQ(e.currentTarget.value)}
          placeholder="Scene Filter"
          type="text"
          value={q}
        />
        {families.length > 1 && (
          <details className="relative text-sm">
            <summary className="cursor-pointer rounded border border-input px-3 py-2">
              Scene families ({selectedFamilies.size}/{families.length})
            </summary>
            <div className="absolute z-50 mt-1 max-h-[65dvh] overflow-y-auto rounded border border-border bg-card p-2 shadow-lg">
              <button type="button" className="px-2 py-1" onClick={() => update({ groups: undefined })}>
                All
              </button>
              <button type="button" className="px-2 py-1" onClick={() => update({ groups: '-' })}>
                None
              </button>
              {families.map((family) => (
                <label key={family} className="flex items-center gap-2 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedFamilies.has(family)}
                    onChange={() => {
                      const next = new Set(selectedFamilies);
                      if (next.has(family)) next.delete(family);
                      else next.add(family);
                      update({ groups: next.size === families.length ? undefined : [...next].join(',') || '-' });
                    }}
                  />
                  {family}
                </label>
              ))}
            </div>
          </details>
        )}
        <SortSelect onChange={(sort) => update({ sort })} value={search.sort ?? 'name'} />
        <ViewControls index={index} onChange={update} view={view} />
        <span className="shrink-0 text-sm text-muted-foreground">
          {shown.length}/{scenes.length}
        </span>
      </Header>
      <div className="flex w-full flex-col gap-6 px-4 py-6 sm:px-6">
        {preamble ? <Markdown>{preamble}</Markdown> : null}
        {tags.length ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <Button
                key={t}
                onClick={() => toggleTag(t)}
                size="sm"
                variant={active.includes(t) ? 'default' : 'outline'}
              >
                {t}
              </Button>
            ))}
          </div>
        ) : null}
        <section>
          {shown.length ? (
            shown.map((scene, i) => (
              <div key={scene.path}>
                {groupOf(scene) !== groupOf(shown[i - 1]) ? (
                  <h2 className="mt-6 border-b border-border pb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {groupOf(scene) || 'Scenes'}
                  </h2>
                ) : null}
                <SceneRow index={index} scene={scene} search={search} view={view} />
              </div>
            ))
          ) : (
            <div className="border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              {scenes.length === 0 ? 'No scenes found. Run `fidelity-kit process <root>`.' : 'No scenes match.'}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

const groupOf = (s?: SceneNode) => (s ? (s.category ?? s.path.split('/').slice(0, -1).join(' / ')) : undefined);

function SceneRow({
  index,
  scene,
  search,
  view,
}: {
  index: SuiteIndex;
  scene: SceneNode;
  search: ViewSearch;
  view: View;
}) {
  const compared = view.compared;
  const size = sceneSize(index, scene, view);
  const version = view.hashes[scene.path];
  return (
    // content-visibility: off-screen rows are neither rendered nor (with reserved image sizes) requested
    <article
      className={`border-b border-border py-4 last:border-b-0 ${version ? 'reloaded' : ''}`}
      // a live update gives the scene a new version: remounting replays the flash
      key={version}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 420px' }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <BookmarkHeading
          anchor={
            <Link aria-label={`Link to ${scene.title}`} hash={scene.path} search={search} to="/">
              #
            </Link>
          }
          as="h3"
          className="text-base font-semibold"
          id={scene.path}
        >
          <Link search={{ ...search, view: 'fidelity', scene: scene.path }} to="/">
            {scene.title}
          </Link>
        </BookmarkHeading>
        {scene.tags.map((t) => (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" key={t}>
            {t}
          </span>
        ))}
      </div>
      <div
        className="mt-3 grid items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
        style={{ gridTemplateColumns: `auto repeat(${compared.length + 1}, minmax(0, 1fr))` }}
      >
        <span />
        <span className="truncate text-center">{view.label(view.ref)} (reference)</span>
        {compared.map((r) => (
          <span className="truncate text-center" key={r}>
            {view.label(r)}
          </span>
        ))}
        <span className="text-right">Render</span>
        <SceneLink scene={scene} search={search}>
          <ResultImage alt={`${scene.title}: ${view.ref}`} size={size} src={renderUrl(scene, view, view.ref)} />
        </SceneLink>
        {compared.map((r) => (
          <SceneLink scene={scene} search={search} hash={`vs-${r}`} key={r}>
            <ResultImage alt={`${scene.title}: ${r}`} size={size} src={renderUrl(scene, view, r)} />
          </SceneLink>
        ))}
        {view.showDeltas ? (
          <>
            <span className="text-right">Delta</span>
            <span />
            {compared.map((r) => (
              <SceneLink scene={scene} search={search} hash={`vs-${r}`} key={r}>
                <ResultImage
                  alt={`${scene.title}: ${r} delta`}
                  unavailable={!renderUrl(scene, view, view.ref) || !renderUrl(scene, view, r)}
                  size={size}
                  src={deltaUrl(index, scene, view, r)}
                />
              </SceneLink>
            ))}
          </>
        ) : null}
        <span className="text-right">Metrics</span>
        <span />
        {compared.map((r) => {
          const m = metricsOf(index, scene, view, r);
          return (
            <dl className={`grid grid-cols-2 gap-x-2 self-stretch p-2 font-mono text-xs ${psnrClassName(m)}`} key={r}>
              <dt>PSNR</dt>
              <dd className="text-right">{m ? formatMetric(m.psnr) : '–'}</dd>
            </dl>
          );
        })}
      </div>
    </article>
  );
}

/** Opens the scene page, scrolled to `hash` (a renderer's comparison) when given. */
function SceneLink({
  scene,
  search,
  hash,
  children,
}: {
  scene: SceneNode;
  search: ViewSearch;
  hash?: string;
  children: ReactNode;
}) {
  return (
    <Link
      hash={hash}
      search={{
        ...search,
        view: 'fidelity',
        scene: scene.path,
        renderer: hash?.startsWith('vs-') ? hash.slice(3) : undefined,
      }}
      to="/"
    >
      {children}
    </Link>
  );
}
