import { createReadStream } from 'node:fs';
import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import pLimit from 'p-limit';
import { z } from 'zod';
import { isDataFile, isImageFile } from './paths.js';
import type { ProgressCallback } from './progress.js';

export const HASHES_FILE = 'image-hashes.json';

export interface HashEntry {
  hash: string;
  size: number;
  mtimeMs: number;
}

const fileSchema = z.object({
  version: z.literal(1),
  files: z.record(z.string(), z.object({ hash: z.string(), size: z.number(), mtimeMs: z.number() })),
});

/**
 * Content hash shared by the ETag and the `?v=` URL version: `<size>-<crc32>` in base36. Streamed, so memory stays flat
 * however large the file is. Fast and non-cryptographic: it detects change, it is not a security boundary.
 */
export async function hashFile(path: string): Promise<string> {
  let crc = 0;
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    crc = crc32(chunk, crc);
    size += chunk.length;
  }
  return `${size.toString(36)}-${crc.toString(36)}`;
}

/** The entries of `<root>/image-hashes.json`; empty when it is missing or malformed (they are only a cache). */
export async function readHashFile(root: string): Promise<Record<string, HashEntry>> {
  try {
    return fileSchema.parse(JSON.parse(await readFile(join(root, HASHES_FILE), 'utf8'))).files;
  } catch {
    return {};
  }
}

export interface HashSuiteOptions {
  /** Parallel file reads; defaults to `os.availableParallelism()`. */
  concurrency?: number;
  /** Injectable for tests. */
  hash?: (path: string) => Promise<string>;
  onProgress?: ProgressCallback;
}
export interface HashSuiteResult {
  hashed: number;
  reused: number;
  total: number;
}

/**
 * Writes `<root>/image-hashes.json` for every served image. Incremental: an entry whose size and mtimeMs are unchanged
 * is reused without reading the file. Output is sorted and timestamp-free, so unchanged files give identical bytes.
 */
export async function hashSuite(root: string, opts: HashSuiteOptions = {}): Promise<HashSuiteResult> {
  root = resolve(root);
  const { concurrency = availableParallelism(), hash = hashFile } = opts;
  const limit = pLimit(Math.max(1, Math.floor(concurrency)));
  const previous = await readHashFile(root);
  const rels: string[] = [];
  const pending = [''];
  let scanned = 0;
  const scanProgress = () =>
    opts.onProgress?.({ phase: 'Scanning', completed: scanned, total: scanned + pending.length, unit: 'directories' });
  scanProgress();
  while (pending.length) {
    const dir = pending.pop()!;
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) pending.push(rel);
      else if (entry.isFile() && isImageFile(rel) && isDataFile(rel)) rels.push(rel);
    }
    scanned++;
    scanProgress();
  }
  rels.sort();
  let reused = 0;
  let completed = 0;
  const hashProgress = () => opts.onProgress?.({ phase: 'Hashing', completed, total: rels.length, unit: 'images' });
  hashProgress();
  const entries = await Promise.all(
    rels.map((rel) =>
      limit(async (): Promise<[string, HashEntry]> => {
        try {
          const s = await stat(join(root, rel));
          const old = previous[rel];
          if (old && old.size === s.size && old.mtimeMs === s.mtimeMs) {
            reused++;
            return [rel, old];
          }
          return [rel, { hash: await hash(join(root, rel)), size: s.size, mtimeMs: s.mtimeMs }];
        } finally {
          completed++;
          hashProgress();
        }
      }),
    ),
  );
  const out = join(root, HASHES_FILE);
  opts.onProgress?.({ phase: 'Writing hashes', completed: 0, total: 1, unit: 'files' });
  const tmp = `${out}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ version: 1, files: Object.fromEntries(entries) }, null, 2)}\n`);
  await rename(tmp, out);
  opts.onProgress?.({ phase: 'Writing hashes', completed: 1, total: 1, unit: 'files' });
  return { hashed: entries.length - reused, reused, total: entries.length };
}
