import { randomUUID } from 'node:crypto';
import { relative, resolve, sep } from 'node:path';
import { watch } from 'chokidar';

export const liveReloadPath = '/data/events';

/** One trailing debounce shared by all clients; revisions catch updates missed during reconnects. */
export function createLiveReload(debounceMs = 5000) {
  const boot = randomUUID();
  let version = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const clients = new Set<{ send(message: string): void; close(): void }>();
  const revision = () => `${boot}:${version}`;
  const frame = (event: string) => `event: ${event}\ndata: ${revision()}\n\n`;
  return {
    revision,
    notify() {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        version++;
        for (const client of clients) client.send(frame('change'));
      }, debounceMs);
      timer.unref();
    },
    response(req: Request): Response {
      const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      };
      if (closed) return new Response(null, { status: 503, headers });
      if (req.method === 'HEAD') return new Response(null, { headers });
      let dispose: (() => void) | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          const client = {
            send(message: string) {
              // A stalled reader reconnects instead of accumulating an unbounded queue.
              if ((controller.desiredSize ?? 0) <= 0) return client.close();
              controller.enqueue(encoder.encode(message));
            },
            close() {
              dispose?.();
              controller.close();
            },
          };
          const heartbeat = setInterval(() => client.send(': keepalive\n\n'), 15000);
          heartbeat.unref();
          dispose = () => {
            clearInterval(heartbeat);
            clients.delete(client);
          };
          clients.add(client);
          client.send(frame('ready'));
        },
        cancel() {
          dispose?.();
        },
      });
      return new Response(body, { headers });
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const client of clients) client.close();
    },
  };
}

export type LiveReload = ReturnType<typeof createLiveReload>;

/** Observe published results (including external processing) and viewer README content. */
export async function watchLiveReload(root: string, liveReload: LiveReload) {
  const base = resolve(root);
  const relevant = (path: string) => {
    const rel = relative(base, path).split(sep).join('/');
    return (
      rel === 'index.json' ||
      rel === 'site.json' ||
      rel === 'performance/index.json' ||
      rel === 'README.md' ||
      rel.endsWith('/README.md')
    );
  };
  const watcher = watch(base, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    ignored: (path, stats) => !!stats?.isFile() && !relevant(path),
  });
  watcher.on('all', (event, path) => {
    if (event === 'unlinkDir' || relevant(path)) liveReload.notify();
  });
  watcher.on('error', (error) => console.error('Live reload watch error:', error));
  try {
    await new Promise<void>((resolveReady, reject) => {
      watcher.once('ready', resolveReady);
      watcher.once('error', reject);
    });
  } catch (error) {
    await watcher.close();
    throw error;
  }
  return watcher;
}
