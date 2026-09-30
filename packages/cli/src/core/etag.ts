import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

interface Entry {
  mtimeMs: number;
  size: number;
  etag: string;
}

/**
 * Lazy ETag cache keyed by path: a file is hashed (streamed, CRC32) only when its mtime or size changes. Only the
 * tag is cached, never the bytes, so memory stays flat however many images a suite has.
 */
const etags = new Map<string, Entry>();
/** Concurrent first requests for the same file (a visitor scrolling a page of images) share one hash pass. */
const hashing = new Map<string, Promise<Entry>>();

async function entryFor(path: string, mtimeMs: number, size: number): Promise<Entry> {
  const hit = etags.get(path);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit;
  const key = `${path}\0${mtimeMs}\0${size}`;
  let pending = hashing.get(key);
  if (!pending) {
    pending = (async () => {
      let crc = 0;
      for await (const chunk of createReadStream(path)) crc = crc32(chunk, crc);
      const entry = { mtimeMs, size, etag: `"${size.toString(36)}-${crc.toString(36)}"` };
      etags.set(path, entry);
      return entry;
    })().finally(() => hashing.delete(key));
    hashing.set(key, pending);
  }
  return pending;
}

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
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

/** True when the request's validators say the client's copy is current (If-None-Match wins over If-Modified-Since). */
function notModified(req: Request, etag: string, mtimeMs: number): boolean {
  const inm = req.headers.get('if-none-match');
  if (inm) return inm.trim() === '*' || inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
  const ims = Date.parse(req.headers.get('if-modified-since') ?? '');
  return Math.floor(mtimeMs / 1000) <= Math.floor(ims / 1000); // NaN (absent/invalid) compares false
}

/**
 * Serves a file with CDN-friendly validators: strong ETag (`"size-crc32"`), Last-Modified, Content-Length, nosniff, and
 * 304 on If-None-Match / If-Modified-Since. The body is streamed from disk. `cacheControl` defaults to `no-cache`
 * (always revalidate). There is no Vary: the response never depends on request headers.
 */
export async function fileResponse(
  req: Request,
  path: string,
  opts: { cacheControl?: string } = {},
): Promise<Response> {
  const s = await stat(path).catch(() => null);
  if (!s?.isFile()) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-cache' } });
  const { etag } = await entryFor(path, s.mtimeMs, s.size);
  const headers = {
    ETag: etag,
    'Last-Modified': new Date(s.mtimeMs).toUTCString(),
    'Cache-Control': opts.cacheControl ?? 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  if (notModified(req, etag, s.mtimeMs)) return new Response(null, { status: 304, headers });
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
    headers: {
      ...headers,
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Content-Length': String(s.size),
    },
  });
}
