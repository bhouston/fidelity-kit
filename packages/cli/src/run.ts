import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { processSuite } from './core/index.js';
import { createProgress } from './progress.js';
import { assertViewerBuilt, createHandler, defaultCachePolicy, serve, type CachePolicy } from './server.js';
import { watchResults, type ResultsWatcher } from './watch.js';

export interface RunArgs {
  root: string;
  port?: number;
  host: string;
  process: boolean;
  watch?: boolean;
  concurrency?: number;
  quiet?: boolean;
  maxAge?: number;
  staleWhileRevalidate?: number;
}

/** Shared by `serve` (cached, lazy ETags) and `dev` (always fresh). */
export async function run(argv: RunArgs, dev: boolean) {
  assertViewerBuilt();
  const root = resolve(argv.root);
  const watching = dev && argv.watch;
  const progress = createProgress(dev ? 'dev' : 'serve', argv.quiet || !dev);
  if (argv.process && !watching) {
    const r = await processSuite(root, { concurrency: argv.concurrency, onProgress: progress.update }).finally(
      progress.finish,
    );
    if (!argv.quiet) console.log(`${r.computed} computed, ${r.skipped} up to date, ${r.failed.length} failed`);
    if (r.failed.length)
      throw new Error(
        `Failed to compare ${r.failed.length} image pair(s): ${r.failed.map((f) => `${f.file}: ${f.error}`).join('; ')}`,
      );
  } else if (!argv.process && !existsSync(`${root}/index.json`)) {
    throw new Error(`No index.json in ${root}; run \`fidelity-kit process\` or drop --no-process.`);
  }
  const cache: CachePolicy = {
    maxAge: argv.maxAge ?? defaultCachePolicy.maxAge,
    staleWhileRevalidate: argv.staleWhileRevalidate ?? defaultCachePolicy.staleWhileRevalidate,
  };
  let watcher: ResultsWatcher | undefined;
  if (watching) {
    watcher = await watchResults(
      root,
      (update) => {
        progress.finish();
        if (!argv.quiet && (update.computed || update.failed.length))
          console.log(`${update.computed} computed, ${update.failed.length} failed`);
        for (const f of update.failed) console.error(`FAILED ${f.file}: ${f.error}`);
      },
      { concurrency: argv.concurrency, process: argv.process, onProgress: progress.update },
    );
  }
  const server = await serve(createHandler(root, { cache, dev }), argv.port, argv.host).catch(async (error) => {
    await watcher?.close();
    throw error;
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not determine the viewer port');
  const host = argv.host === '0.0.0.0' ? 'localhost' : argv.host === '::' ? '::1' : argv.host;
  const urlHost = host.includes(':') ? `[${host}]` : host;
  if (!argv.quiet) {
    console.log(`Serving ${root}${dev ? ' (dev: nothing cached)' : ''}`);
    console.log(`  Local: http://${urlHost}:${address.port}/`);
  }
}
