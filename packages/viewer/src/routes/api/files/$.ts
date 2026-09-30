import { createFileRoute } from '@tanstack/react-router';
import { fileResponse, resolveInside } from '@fidelity-kit/core/etag';
import { suiteRoot } from '#/lib/suite.server';

/** `/api/files/<scene path>/<output>/<file>.avif`: images only, confined to the suite root. ETag + 304 revalidation. */
export const Route = createFileRoute('/api/files/$')({
  server: {
    handlers: {
      GET: ({ params, request }) => {
        const rel = decodeURIComponent(params._splat ?? '');
        const path =
          rel.endsWith('.avif') && !rel.split('/').some((s) => s.startsWith('.'))
            ? resolveInside(suiteRoot(), rel)
            : null;
        return path ? fileResponse(request, path) : new Response('Not found', { status: 404 });
      },
    },
  },
});
