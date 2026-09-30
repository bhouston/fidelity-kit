import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { hashFile, type HashEntry } from './hash.js';

/**
 * Lazy content-hash map keyed by absolute path: a file is hashed (streamed, CRC32) only when its mtime or size differs
 * from the entry. Only the hash is kept, never the bytes, so memory stays flat however many images a suite has. Entries
 * can be pre-populated from `image-hashes.json`; they are trusted only while the file's stat still matches.
 */
export class HashStore {
  private entries = new Map<string, HashEntry>();
  /** Concurrent first requests for the same file (a visitor scrolling a page of images) share one hash pass. */
  private hashing = new Map<string, Promise<HashEntry>>();
  /** Bumped whenever the set of known hashes changes; drives the ETag of the hash listing. */
  version = 0;

  preload(path: string, entry: HashEntry) {
    this.entries.set(path, entry);
    this.version++;
  }

  async entryFor(path: string, mtimeMs: number, size: number): Promise<HashEntry> {
    const hit = this.entries.get(path);
    if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit;
    const key = `${path}\0${mtimeMs}\0${size}`;
    let pending = this.hashing.get(key);
    if (!pending) {
      pending = (async () => {
        const entry = { mtimeMs, size, hash: await hashFile(path) };
        this.entries.set(path, entry);
        this.version++;
        return entry;
      })().finally(() => this.hashing.delete(key));
      this.hashing.set(key, pending);
    }
    return pending;
  }

  /** Every hash that is valid right now: entries whose file changed or vanished are dropped. */
  async known(): Promise<Map<string, string>> {
    await Promise.all(
      [...this.entries].map(async ([path, e]) => {
        const s = await stat(path).catch(() => null);
        if (!s?.isFile() || s.mtimeMs !== e.mtimeMs || s.size !== e.size) {
          this.entries.delete(path);
          this.version++;
        }
      }),
    );
    return new Map([...this.entries].map(([path, e]) => [path, e.hash]));
  }
}

/** Used by `fileResponse` callers that don't bring their own store (the server has one per handler). */
const sharedStore = new HashStore();

/** Refuses paths that escape `root`. */
export function resolveInside(root: string, rel: string): string | null {
  const base = resolve(root);
  const full = resolve(base, rel);
  return full === base || full.startsWith(base + sep) ? full : null;
}

export const IMMUTABLE = 'public, max-age=31536000, immutable';

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
export function notModified(req: Request, etag: string, mtimeMs: number): boolean {
  const inm = req.headers.get('if-none-match');
  if (inm) return inm.trim() === '*' || inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
  const ims = Date.parse(req.headers.get('if-modified-since') ?? '');
  return Math.floor(mtimeMs / 1000) <= Math.floor(ims / 1000); // NaN (absent/invalid) compares false
}

/**
 * Serves a file with CDN-friendly validators: strong ETag (`"<size>-<crc32>"`, the content hash), Last-Modified, Content-Length, nosniff, and
 * 304 on If-None-Match / If-Modified-Since. The body is streamed from disk. `cacheControl` defaults to `no-cache`
 * (always revalidate); `immutableIf` is a `?v=` version that becomes `immutableCacheControl` only if it equals the file's
 * current hash (an unverified version keeps `cacheControl`). There is no Vary: the response never depends on request headers.
 */
export async function fileResponse(
  req: Request,
  path: string,
  opts: { cacheControl?: string; immutableIf?: string | null; store?: HashStore } = {},
): Promise<Response> {
  const s = await stat(path).catch(() => null);
  if (!s?.isFile()) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-cache' } });
  const { hash } = await (opts.store ?? sharedStore).entryFor(path, s.mtimeMs, s.size);
  const etag = `"${hash}"`;
  const verified = opts.immutableIf === hash;
  const headers = {
    ETag: etag,
    'Last-Modified': new Date(s.mtimeMs).toUTCString(),
    'Cache-Control': verified ? IMMUTABLE : (opts.cacheControl ?? 'no-cache'),
    'X-Content-Type-Options': 'nosniff',
  };
  if (notModified(req, etag, s.mtimeMs)) return new Response(null, { status: 304, headers });
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
    headers: { ...headers, ...bodyHeaders(path, s.size) },
  });
}

function bodyHeaders(path: string, size: number) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Content-Length': String(size) };
}

/**
 * Dev-mode variant: the file exactly as it is on disk right now, every time. No ETag, no Last-Modified, no hash cache,
 * conditional headers are ignored (always 200) and `Cache-Control: no-store` keeps browsers and proxies from reusing it.
 */
export async function freshFileResponse(path: string): Promise<Response> {
  const s = await stat(path).catch(() => null);
  if (!s?.isFile()) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
    headers: { ...bodyHeaders(path, s.size), 'Cache-Control': 'no-store' },
  });
}
