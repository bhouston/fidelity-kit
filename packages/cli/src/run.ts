import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { processSuite } from './core/index.js';
import { assertViewerBuilt, createHandler, defaultCachePolicy, serve, type CachePolicy } from './server.js';

export interface RunArgs {
  root: string;
  port: number;
  host: string;
  process: boolean;
  maxAge?: number;
  staleWhileRevalidate?: number;
}

/** Shared by `serve` (cached, lazy ETags) and `dev` (always fresh). */
export async function run(argv: RunArgs, dev: boolean) {
  assertViewerBuilt();
  const root = resolve(argv.root);
  if (argv.process) {
    const r = await processSuite(root);
    console.log(`${r.computed} computed, ${r.skipped} up to date, ${r.failed.length} failed`);
  } else if (!existsSync(`${root}/index.json`)) {
    throw new Error(`No index.json in ${root}; run \`fidelity-kit process\` or drop --no-process.`);
  }
  const cache: CachePolicy = {
    maxAge: argv.maxAge ?? defaultCachePolicy.maxAge,
    staleWhileRevalidate: argv.staleWhileRevalidate ?? defaultCachePolicy.staleWhileRevalidate,
  };
  await serve(createHandler(root, { cache, dev }), argv.port, argv.host);
  console.log(`Serving ${root} at http://${argv.host}:${argv.port}${dev ? ' (dev: nothing cached)' : ''}`);
}
