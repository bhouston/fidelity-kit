import { watch, type FSWatcher } from 'chokidar';
import { relative, resolve, sep } from 'node:path';
import { processChanges, type ProcessResult } from './core/process.js';
import type { ProgressCallback } from './core/progress.js';

export interface ResultsWatcher {
  close(): Promise<void>;
}

/** Shared by `process --watch` and `dev`. Writes are serialized and collected while a pass is running. */
export async function watchResults(
  root: string,
  onResult: (result: ProcessResult) => void = () => {},
  onProgress?: ProgressCallback,
): Promise<ResultsWatcher> {
  const base = resolve(root);
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let closed = false;
  const relevant = (path: string) => {
    const rel = relative(base, path).split(sep).join('/');
    if (rel === 'fidelity.json' || rel.endsWith('/scene.json')) return rel;
    if (rel.endsWith('.avif') && !rel.includes('.vs-')) return rel;
    return null;
  };
  const flush = () => {
    timer = undefined;
    if (!pending.size || closed) return;
    const paths = [...pending];
    pending.clear();
    running = running
      .then(async () => {
        try {
          onResult(await processChanges(base, paths, onProgress));
        } catch (error) {
          console.error('Watch update failed:', error);
        }
      })
      .finally(() => {
        if (pending.size && !timer && !closed) timer = setTimeout(flush, 250);
      });
  };
  const watcher: FSWatcher = watch(base, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    ignored: (path, stats) => !!stats?.isFile() && !relevant(path),
  });
  watcher.on('all', (_event, path) => {
    const rel = relevant(path);
    if (!rel || closed) return;
    pending.add(rel);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 250);
  });
  watcher.on('error', (error) => console.error('Watch error:', error));
  await new Promise<void>((resolveReady, reject) => {
    watcher.once('ready', resolveReady);
    watcher.once('error', reject);
  });
  return {
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await watcher.close();
      await running;
    },
  };
}
