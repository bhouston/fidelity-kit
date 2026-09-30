import { Outlet, createRootRoute } from '@tanstack/react-router';
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
  return (
    <main>
      <Outlet />
    </main>
  );
}
