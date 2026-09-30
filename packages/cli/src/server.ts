import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fileResponse, resolveInside } from './core/etag.js';

/** The prebuilt viewer SPA (built by `pnpm build` into packages/cli/viewer, shipped in the npm package). */
export const viewerDir = fileURLToPath(new URL('../viewer', import.meta.url));

export function assertViewerBuilt() {
  if (!existsSync(`${viewerDir}/index.html`)) throw new Error(`Viewer not built (${viewerDir}). Run \`pnpm build\`.`);
}

/** The only suite files the viewer may read; also what `build` exports. */
export function isDataFile(rel: string): boolean {
  if (rel.split('/').some((s) => s.startsWith('.') || s === '..')) return false;
  return rel === 'index.json' || rel === 'README.md' || rel.endsWith('/README.md') || rel.endsWith('.avif');
}

/** `/data/*` = the suite (allowlisted files); everything else = the viewer SPA (hash routing, so no fallback needed). */
export function createHandler(root: string, assets = viewerDir) {
  return async (req: Request): Promise<Response> => {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const notFound = new Response('Not found', { status: 404 });
    if (path.startsWith('/data/')) {
      const rel = path.slice('/data/'.length);
      const full = isDataFile(rel) ? resolveInside(root, rel) : null;
      return full ? fileResponse(req, full) : notFound;
    }
    const rel = path === '/' ? 'index.html' : path.slice(1);
    const full = resolveInside(assets, rel);
    return full ? fileResponse(req, full, { immutable: rel.startsWith('assets/') }) : notFound;
  };
}

export function serve(handler: (req: Request) => Promise<Response>, port: number, host: string): Promise<Server> {
  const server = createServer(async (nreq, nres) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (typeof v === 'string') headers.set(k, v);
    const res =
      nreq.method === 'GET' || nreq.method === 'HEAD'
        ? await handler(new Request(`http://${headers.get('host') ?? 'localhost'}${nreq.url}`, { headers })).catch(
            (e) => new Response(String(e), { status: 500 }),
          )
        : new Response('Method not allowed', { status: 405 });
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    if (nreq.method === 'HEAD' || !res.body) return void nres.end();
    // Stream with backpressure; a client that navigates away just aborts its transfer.
    await pipeline(Readable.fromWeb(res.body as never), nres).catch(() => {});
  });
  return new Promise((resolve) => server.listen(port, host, 1024, () => resolve(server)));
}
