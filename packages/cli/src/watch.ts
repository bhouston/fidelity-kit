import { watch, type FSWatcher } from 'chokidar';
import { relative, resolve, sep } from 'node:path';
import { SuiteProcessor, type ProcessOptions, type ProcessResult } from './core/process.js';

export interface ResultsWatcher {
  close(): Promise<void>;
}

/** One processor and one batch in flight. Generated files are excluded before they reach either queue. */
export async function watchResults(
  root: string,
  onResult: (result: ProcessResult) => void = () => {},
  opts: ProcessOptions & { process?: boolean } = {},
): Promise<ResultsWatcher> {
  const base = resolve(root);
  const processor = await SuiteProcessor.create(base, opts);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let closed = false;
  let initializing = true;
  let pending = false;
  let configWarning = false;
  const rel = (path: string) => relative(base, path).split(sep).join('/');
  const relevant = (path: string) => path === 'fidelity.json' || processor.sceneForInput(path) !== null;
  const flush = () => {
    timer = undefined;
    if (closed) return;
    processor.settle();
    if (initializing || running || !pending) return;
    pending = false;
    if (!processor.needsFlush) return;
    running = processor
      .flush()
      .then(onResult)
      .catch((error) => console.error('Watch update failed:', error))
      .finally(() => {
        running = undefined;
        if (pending && !timer && !closed) timer = setTimeout(flush, 250);
      });
  };
  const watcher: FSWatcher = watch(base, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    ignored: (path, stats) => !!stats?.isFile() && !relevant(rel(path)),
  });
  watcher.on('all', (event, path) => {
    const input = rel(path);
    if (closed) return;
    if (input === 'fidelity.json') {
      if (!configWarning)
        console.warn('fidelity.json changed; restart to apply renderer, output, or configuration changes.');
      configWarning = true;
      return;
    }
    if (event === 'unlinkDir') processor.removeDirectory(input, true);
    else {
      if (event === 'addDir' || !relevant(input)) return;
      processor.notify([input], true);
    }
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 250);
  });
  watcher.on('error', (error) => console.error('Watch error:', error));
  try {
    await new Promise<void>((resolveReady, reject) => {
      watcher.once('ready', resolveReady);
      watcher.once('error', reject);
    });
    // Observe before scanning so changes during initial processing cannot fall through a startup gap.
    onResult(await processor.initialize(opts.process ?? true));
    initializing = false;
    if (pending && !timer) timer = setTimeout(flush, 250);
  } catch (error) {
    closed = true;
    if (timer) clearTimeout(timer);
    await watcher.close();
    throw error;
  }
  return {
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      await watcher.close();
      await running;
      // Finish source events already accepted before shutdown.
      processor.settle();
      if (pending && processor.needsFlush) onResult(await processor.flush());
    },
  };
}
