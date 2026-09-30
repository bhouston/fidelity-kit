import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import { getSuite } from '#/lib/data';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
  loader: () => getSuite(),
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: loaderData?.index.config.title ?? 'Fidelity' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => <p className="mx-auto max-w-[1120px] px-4 py-8 text-muted-foreground sm:px-6">Not found.</p>,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-screen antialiased">
        <main>{children}</main>
        <Scripts />
      </body>
    </html>
  );
}
