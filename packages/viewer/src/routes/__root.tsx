import { Link, Outlet, createRootRoute, useRouter } from '@tanstack/react-router';
import { logoUrl } from 'fidelity-kit/paths';
import { useEffect } from 'react';
import { getSuite } from '#/lib/data';
import { listenForChanges } from '#/lib/live-reload';

export const Route = createRootRoute({
  loader: () => getSuite(),
  component: Root,
  errorComponent: ({ error }) => (
    <p className="mx-auto max-w-[1120px] px-4 py-8 text-destructive sm:px-6">
      {error instanceof Error ? error.message : String(error)}
    </p>
  ),
  notFoundComponent: () => <p className="mx-auto max-w-[1120px] px-4 py-8 text-muted-foreground sm:px-6">Not found.</p>,
});

function Root() {
  const { index, liveReload } = Route.useLoaderData();
  const router = useRouter();
  useEffect(() => listenForChanges(liveReload, () => router.invalidate()), [liveReload, router]);
  useEffect(() => {
    document.title = index.config.title;
  }, [index.config.title]);
  useEffect(() => {
    if (!index.config.logo) return;
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.href = logoUrl(index.config.logo);
    document.head.append(icon);
    return () => icon.remove();
  }, [index.config.logo]);
  return (
    <>
      <nav aria-label="Main navigation" className="border-b border-border bg-card px-6 py-3 flex gap-6">
        <Link to="/" search={{ view: 'home' }} className="font-semibold">
          {index.config.title}
        </Link>
        <Link to="/" search={{ view: 'fidelity' }}>
          Fidelity
        </Link>
        <Link to="/" search={{ view: 'performance' }}>
          Performance
        </Link>
        <Link to="/" search={{ view: 'live' }}>
          Live
        </Link>
      </nav>
      <main>
        <Outlet />
      </main>
      <footer className="mx-auto max-w-[1120px] px-4 py-8 text-center text-sm text-muted-foreground sm:px-6">
        Website powered by{' '}
        <a
          className="underline underline-offset-4 hover:text-foreground"
          href="https://github.com/bhouston/fidelity-kit"
          rel="noopener noreferrer"
          target="_blank"
        >
          Fidelity Kit
        </a>
      </footer>
    </>
  );
}
