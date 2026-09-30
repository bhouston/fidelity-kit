import { readFile, stat } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { resolve, sep } from 'node:path';

interface Entry {
  mtimeMs: number;
  size: number;
  etag: string;
  body: Buffer;
}

/** Lazy in-memory cache keyed by path: a file is re-read and re-hashed only when its mtime or size changes. */
// ponytail: bodies are held in memory (fine for MBs of AVIF); switch to streaming if suites reach GBs.
const cache = new Map<string, Entry>();

/** Refuses paths that escape `root`. */
export function resolveInside(root: string, rel: string): string | null {
  const base = resolve(root);
  const full = resolve(base, rel);
  return full === base || full.startsWith(base + sep) ? full : null;
}

const TYPES: Record<string, string> = {
  avif: 'image/avif',
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  json: 'application/json',
  md: 'text/markdown; charset=utf-8',
};

/** Strong ETag `"size-crc32"`; 304 on `If-None-Match`. `immutable` is for URLs versioned by the ETag (`?v=`). */
export async function fileResponse(req: Request, path: string, opts: { immutable?: boolean } = {}): Promise<Response> {
  const s = await stat(path).catch(() => null);
  if (!s?.isFile()) return new Response('Not found', { status: 404 });
  let e = cache.get(path);
  if (!e || e.mtimeMs !== s.mtimeMs || e.size !== s.size) {
    const body = await readFile(path);
    e = { mtimeMs: s.mtimeMs, size: s.size, etag: `"${s.size.toString(36)}-${crc32(body).toString(36)}"`, body };
    cache.set(path, e);
  }
  const headers = {
    ETag: e.etag,
    'Cache-Control': opts.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (
    req.headers
      .get('if-none-match')
      ?.split(',')
      .some((t) => t.trim() === e.etag)
  ) {
    return new Response(null, { status: 304, headers });
  }
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return new Response(new Uint8Array(e.body), {
    headers: { ...headers, 'Content-Type': TYPES[ext] ?? 'application/octet-stream' },
  });
}
