import { Link, getRouteApi } from '@tanstack/react-router';
import { Markdown } from './Markdown';
import { renderUrl, resolveView } from '#/lib/view';

const rootRoute = getRouteApi('__root__');
export function HomePage({ readme }: { readme: string | null }) {
  const { index, scenes, hashes, site } = rootRoute.useLoaderData();
  const hero = site?.registry.home.hero;
  const configured = site?.registry.scenes.find((scene) => scene.id === hero?.scene);
  const view = resolveView(index, { output: hero?.output, ref: hero?.renderer }, hashes);
  const scene =
    scenes.find((candidate) => candidate.path === (configured?.path ?? hero?.scene)) ??
    scenes.find((candidate) => renderUrl(candidate, view, hero?.renderer ?? view.ref));
  const renderer = hero?.renderer ?? view.ref;
  const image = scene ? renderUrl(scene, view, renderer) : undefined;
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-12">
      <h1 className="text-4xl font-semibold mb-8">{index.config.title}</h1>
      <div className="grid md:grid-cols-2 gap-8 items-start mb-10">
        <div>
          {readme ? (
            <Markdown>{readme}</Markdown>
          ) : (
            <p>Explore rendering fidelity, measure performance, and try scenes live.</p>
          )}
        </div>
        <figure className="border border-border bg-muted/20">
          {image && scene ? (
            <Link to="/" search={{ view: 'fidelity', scene: scene.path, renderer }}>
              <img className="w-full" src={image} alt={`${scene.title} rendered by ${view.label(renderer)}`} />
            </Link>
          ) : (
            <div className="aspect-[4/3] flex items-center justify-center">
              Fidelity renders appear here after capture.
            </div>
          )}
          {scene && (
            <figcaption className="p-3 text-sm text-muted-foreground">
              {scene.title} · {view.label(renderer)}
            </figcaption>
          )}
        </figure>
      </div>
      <div className="grid md:grid-cols-3 gap-6">
        {(
          [
            ['fidelity', 'Fidelity', 'Compare renderer images with reference renders and inspect image quality.'],
            [
              'performance',
              'Performance',
              'Explore frame rates, setup stages, and convergence by renderer, machine, and scene.',
            ],
            ['live', 'Live', 'Choose a scene and renderer, move around, and watch live measurements.'],
          ] as const
        ).map(([section, title, description]) => (
          <Link
            key={section}
            to="/"
            search={{ view: section }}
            className="block border border-border bg-card p-6 hover:bg-muted/20"
          >
            <h2 className="text-2xl font-semibold mb-3">{title}</h2>
            <p className="text-muted-foreground">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
