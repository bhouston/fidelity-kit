import { Outlet, createRootRoute } from '@tanstack/react-router';
import { logoUrl } from 'fidelity-kit/paths';
import { useEffect } from 'react';
import { getSuite } from '#/lib/data';

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
  const { index } = Route.useLoaderData();
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
