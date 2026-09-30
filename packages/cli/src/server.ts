import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fileResponse, freshFileResponse, resolveInside } from './core/etag.js';

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

export interface CachePolicy {
  /** Seconds an image is served from cache without contacting the origin. */
  maxAge: number;
  /** Seconds after that a stale image may be served while a background refresh runs (also used for stale-if-error). */
  staleWhileRevalidate: number;
}
export const defaultCachePolicy: CachePolicy = { maxAge: 300, staleWhileRevalidate: 86400 };

export interface HandlerOptions {
  /** Directory of the built viewer. */
  assets?: string;
  /** Image cache policy (serve mode). */
  cache?: CachePolicy;
  /** Dev mode: every file is served fresh with `no-store`, no ETag/Last-Modified, no conditional requests. */
  dev?: boolean;
}

/**
 * `/data/*` = the suite (allowlisted files); everything else = the viewer SPA (hash routing, so no fallback needed).
 * Serve mode: images are shared-cacheable per `cache`; `index.json`, READMEs and `index.html` always revalidate (cheap
 * 304s) so a re-run of `process` shows up immediately; hashed `/assets/*` are immutable. Dev mode: nothing is cached.
 */
export function createHandler(
  root: string,
  { assets = viewerDir, cache = defaultCachePolicy, dev = false }: HandlerOptions = {},
) {
  const imageCache = `public, max-age=${cache.maxAge}, stale-while-revalidate=${cache.staleWhileRevalidate}, stale-if-error=${cache.staleWhileRevalidate}`;
  const send = (req: Request, file: string, cacheControl?: string) =>
    dev ? freshFileResponse(file) : fileResponse(req, file, { cacheControl });
  return async (req: Request): Promise<Response> => {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const notFound = new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': dev ? 'no-store' : 'no-cache' },
    });
    if (path.startsWith('/data/')) {
      const rel = path.slice('/data/'.length);
      const full = isDataFile(rel) ? resolveInside(root, rel) : null;
      return full ? send(req, full, rel.endsWith('.avif') ? imageCache : undefined) : notFound;
    }
    const rel = path === '/' ? 'index.html' : path.slice(1);
    const full = resolveInside(assets, rel);
    return full
      ? send(req, full, rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : undefined)
      : notFound;
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
