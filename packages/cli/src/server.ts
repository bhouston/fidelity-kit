import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative, resolve as resolvePath, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import {
  fileResponse,
  freshFileResponse,
  HashStore,
  IMMUTABLE,
  notModified,
  readHashFile,
  resolveInside,
} from './core/index.js';
import { isDataFile, isImageFile } from './core/paths.js';
import { liveReloadPath, type LiveReload } from './live-reload.js';

/** The prebuilt viewer SPA (built by `pnpm build` into packages/cli/viewer, shipped in the npm package). */
export const viewerDir = fileURLToPath(new URL('../viewer', import.meta.url));

export function assertViewerBuilt() {
  if (!existsSync(`${viewerDir}/index.html`)) throw new Error(`Viewer not built (${viewerDir}). Run \`pnpm build\`.`);
}

export { isDataFile };

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
  /**
   * Dev mode: every file is served fresh with `no-store`, no ETag/Last-Modified, no conditional requests. Nothing is
   * hashed: `/data/image-hashes.json` is an empty `{}` (a 404 would log a console error in the browser), `?v=` is ignored and `image-hashes.json` is not even loaded.
   */
  dev?: boolean;
  /** Dev-only result change channel. */
  liveReload?: LiveReload;
}

/**
 * `/data/*` = the suite (allowlisted files); everything else = the viewer SPA (the detail page is `/?scene=`, so no path fallback is needed).
 * Serve mode: images are shared-cacheable per `cache`; `index.json`, READMEs and `index.html` always revalidate (cheap
 * 304s) so a re-run of `process` shows up immediately; hashed `/assets/*` are immutable. Dev mode: nothing is cached.
 * Serve mode also keeps a lazy content-hash map (pre-populated from `<root>/image-hashes.json`), lists it at
 * `/data/image-hashes.json`, and serves `image?v=<hash>` as immutable only when `<hash>` is the file's current hash.
 */
export function createHandler(
  root: string,
  { assets = viewerDir, cache = defaultCachePolicy, dev = false, liveReload }: HandlerOptions = {},
) {
  const imageCache = `public, max-age=${cache.maxAge}, stale-while-revalidate=${cache.staleWhileRevalidate}, stale-if-error=${cache.staleWhileRevalidate}`;
  const store = new HashStore();
  const bootId = Date.now().toString(36); // keeps ETags of the hash listing from colliding across restarts
  const base = resolvePath(root);
  const realBase = realpath(base);
  const loaded = dev
    ? undefined
    : readHashFile(root).then((files) => {
        for (const [rel, e] of Object.entries(files)) store.preload(resolvePath(base, rel), e);
      });
  const send = (req: Request, file: string, cacheControl?: string, immutableIf?: string | null) =>
    dev ? freshFileResponse(file) : fileResponse(req, file, { cacheControl, immutableIf, store });
  /** `{ "<rel path>": "<hash>" }` for every hash known right now (entries whose file changed are dropped first). */
  const hashListing = async (req: Request) => {
    await loaded;
    const known = await store.known();
    const body = JSON.stringify(
      Object.fromEntries(
        [...known]
          .filter(([p]) => isImageFile(p))
          .map(([p, h]) => [relative(base, p).split(sep).join('/'), h] as const)
          .toSorted(([a], [b]) => (a < b ? -1 : 1)),
      ),
    );
    const headers = { ETag: `"${bootId}-${store.version.toString(36)}"`, 'Cache-Control': 'no-cache' };
    if (notModified(req, headers.ETag, Infinity)) return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, 'Content-Type': 'application/json' } });
  };
  return async (req: Request): Promise<Response> => {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const notFound = new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': dev ? 'no-store' : 'no-cache' },
    });
    if (path === liveReloadPath) return dev && liveReload ? liveReload.response(req) : notFound;
    if (path.startsWith('/data/')) {
      const rel = path.slice('/data/'.length);
      if (rel === 'image-hashes.json')
        return dev
          ? new Response('{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
          : hashListing(req);
      const full = isDataFile(rel) ? resolveInside(root, rel) : null;
      if (!full) return notFound;
      const [realRoot, realFile] = await Promise.all([realBase, realpath(full).catch(() => null)]);
      if (!realFile || (!realFile.startsWith(realRoot + sep) && realFile !== realRoot)) return notFound;
      await loaded;
      const isImage = isImageFile(rel);
      // Snapshot before reading so an update during the fetch is caught by the SSE handshake.
      const revision = liveReload?.revision();
      const response = await send(
        req,
        full,
        isImage ? imageCache : undefined,
        isImage ? new URL(req.url).searchParams.get('v') : null,
      );
      if (dev && liveReload && rel === 'index.json' && response.ok) {
        response.headers.set('X-Fidelity-Events', liveReloadPath.slice(1));
        response.headers.set('X-Fidelity-Revision', revision!);
      }
      return response;
    }
    const rel = path === '/' ? 'index.html' : path.slice(1);
    const full = resolveInside(assets, rel);
    return full ? send(req, full, rel.startsWith('assets/') ? IMMUTABLE : undefined) : notFound;
  };
}

export async function serve(
  handler: (req: Request) => Promise<Response>,
  port: number | undefined,
  host: string,
): Promise<Server> {
  for (let candidate = port ?? 3000; candidate <= 65535; candidate++) {
    try {
      return await listen(handler, candidate, host);
    } catch (error) {
      if (port !== undefined || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No open port available from 3000 to 65535');
}

function listen(handler: (req: Request) => Promise<Response>, port: number, host: string): Promise<Server> {
  const server = createServer(async (nreq, nres) => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (typeof v === 'string') headers.set(k, v);
    const res =
      nreq.method === 'GET' || nreq.method === 'HEAD'
        ? await handler(
            new Request(`http://${headers.get('host') ?? 'localhost'}${nreq.url}`, { headers, method: nreq.method }),
          ).catch((e) => new Response(String(e), { status: 500 }))
        : new Response('Method not allowed', { status: 405 });
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    if (nreq.method === 'HEAD' || !res.body) return void nres.end();
    // Stream with backpressure; a client that navigates away just aborts its transfer.
    await pipeline(Readable.fromWeb(res.body as never), nres).catch(() => {});
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, 1024, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
