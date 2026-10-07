import { performanceSiteIndex } from './site-index.js';
import { createServer, type ServerResponse } from 'node:http';
import { readFile, stat, mkdir, readdir } from 'node:fs/promises';
import { watch, lstatSync, readFileSync, type FSWatcher } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, sep } from 'node:path';
import { readReportIndex, processResults, processResult, viewerDirectory } from './storage.js';
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
export async function startServer(options: {
  out: string;
  host?: string;
  port?: number;
  findAvailablePort?: boolean;
  rendererRoot?: string;
  viewer?: string;
  watchResults?: boolean;
  live?: boolean;
}) {
  const clients = new Set<ServerResponse>();
  const liveReload = options.watchResults === true;
  const eventsEnabled = liveReload || options.live === true;
  const publish = (event: unknown) => {
    for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  let watcher: FSWatcher | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const changedPaths = new Set<string>();
  const knownDirectories = new Set<string>(['']);
  const ownWrites = new Map<string, string>();
  const recordWrite = (file: string, contents: string) => ownWrites.set(file, contents);
  let processing = Promise.resolve();
  let closing = false;
  const flush = () => {
    const paths = [...changedPaths];
    changedPaths.clear();
    processing = processing.then(async () => {
      if (closing) return;
      if (paths.includes('README.md')) publish({ type: 'readmeChanged' });
      // Machine folders, renderer folders and machine.json renames can affect many results at once.
      const broad =
        paths.includes('') ||
        paths.some(
          (path) =>
            path !== 'README.md' &&
            path !== 'index.json' &&
            (path.split('/').length < 3 ||
              /^\d{4}-/.test(path.split('/')[1] ?? '') ||
              /^[^/]+\/machine\.json$/.test(path)),
        );
      const triples = new Set(
        paths
          .filter((path) => path && path !== 'README.md' && path !== 'index.json')
          .map((path) => path.split('/').slice(0, 3).join('/'))
          .filter((path) => path.split('/').length === 3),
      );
      if (broad) {
        try {
          await processResults(options.out, recordWrite);
          if (!closing) publish({ type: 'indexChanged' });
        } catch (error) {
          console.error('Unable to process changed results:', (error as Error).message);
        }
        return;
      }
      for (const triple of triples) {
        const [machineId, rendererId, sceneId] = triple.split('/');
        const needsProcessing = paths.some(
          (path) => path === triple || path === `${triple}/metrics.json` || path === `${triple}/screenshot.avif`,
        );
        let ready = !needsProcessing;
        if (needsProcessing)
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              await processResult(options.out, machineId!, rendererId!, sceneId!, recordWrite);
              ready = true;
              break;
            } catch (error) {
              if (attempt === 3) {
                console.error('Unable to process changed result:', (error as Error).message);
                break;
              }
              await new Promise((done) => setTimeout(done, 500));
            }
          }
        if (ready && !closing) publish({ type: 'resultChanged', machineId, rendererId, sceneId });
      }
      if (paths.includes('index.json') && !closing) publish({ type: 'indexChanged' });
    });
  };
  const stopWatching = () => {
    clearTimeout(debounce);
    changedPaths.clear();
    watcher?.close();
    watcher = undefined;
  };
  if (liveReload) {
    await mkdir(options.out, { recursive: true });
    await processResults(options.out, recordWrite);
    const findDirectories = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        knownDirectories.add(path);
        await findDirectories(resolve(directory, entry.name), path);
      }
    };
    await findDirectories(options.out, '');
    watcher = watch(options.out, { recursive: true }, (_event, filename) => {
      const path = filename?.toString().split(sep).join('/') ?? '';
      // Atomic writers publish a final rename; temporary files never trigger report refreshes.
      if (path.split('/').some((part) => part.startsWith('.') || /(?:\.tmp|\.temp|\.swp|~)$/i.test(part))) return;
      if (ownWrites.has(path)) {
        try {
          if (readFileSync(resolve(options.out, path), 'utf8') === ownWrites.get(path)) return;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT' && ownWrites.get(path) === '') return;
        }
      }
      let directory = knownDirectories.has(path);
      try {
        const info = lstatSync(resolve(options.out, path));
        if (info.isSymbolicLink()) return;
        if (info.isDirectory()) {
          // An imported renderer folder can appear in one atomic directory rename. Existing
          // directory metadata changes also accompany ignored temporary file writes.
          if (directory) return;
          knownDirectories.add(path);
          directory = true;
        }
      } catch {
        if (directory) {
          for (const known of knownDirectories)
            if (known === path || known.startsWith(`${path}/`)) knownDirectories.delete(known);
        }
      }
      if (
        !directory &&
        path &&
        !/(?:^|\/)(?:raw\.json|metrics\.json|screenshot\.avif|reference\.png|diff\.png|machine\.json)$/i.test(path) &&
        path !== 'README.md' &&
        path !== 'index.json'
      )
        return;
      changedPaths.add(path);
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        flush();
      }, 500);
      debounce.unref();
    });
    watcher.on('error', (error) => {
      console.error('Performance results watch failed:', error.message);
      publish({ type: 'watchError', message: error.message });
      stopWatching();
    });
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'no-store');
    try {
      let path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (path === '/data/index.json' || path === '/data/image-hashes.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify(
            path.endsWith('image-hashes.json') ? {} : performanceSiteIndex(await readReportIndex(options.out)),
          ),
        );
        return;
      }
      if (path === '/data/README.md') path = '/README.md';
      if (path.startsWith('/data/performance/')) path = path.slice('/data/performance'.length);
      if (path.endsWith('/reference.png')) res.setHeader('Access-Control-Allow-Origin', '*');
      if (path === '/events') {
        if (!eventsEnabled) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': connected\n\n');
        res.write(`data: ${JSON.stringify({ type: 'indexChanged' })}\n\n`);
        const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
        heartbeat.unref();
        clients.add(res);
        res.on('close', () => {
          clearInterval(heartbeat);
          clients.delete(res);
        });
        return;
      }
      if (path === '/index.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            ...(await readReportIndex(options.out)),
            ...(liveReload || options.live === true ? { liveReload: true } : {}),
          }),
        );
        return;
      }
      if (path === '/harness') {
        res.setHeader('Content-Type', 'text/html');
        res.end(
          '<!doctype html><html><head><title>fidelity-kit benchmark harness</title></head><body style="margin:0"></body></html>',
        );
        return;
      }
      const isResult =
        /^\/[^/]+\/(?:\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\/)?[^/]+\/[^/]+\/(?:raw\.json|metrics\.json|screenshot\.avif|reference\.png|diff\.png)$/.test(
          path,
        ) || path === '/README.md';
      const reporter = path.startsWith('/reporter/');
      const root = resolve(
        reporter
          ? dirname(fileURLToPath(import.meta.resolve('../browser/index.js')))
          : (options.rendererRoot ?? (isResult ? options.out : (options.viewer ?? (await viewerDirectory())))),
      );
      let file = resolve(
        root,
        '.' + (reporter ? path.slice('/reporter'.length) : path === '/' || path === '/live' ? '/index.html' : path),
      );
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      try {
        if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
      } catch {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
      res.end(await readFile(file));
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end('Server error');
    }
  });
  try {
    let port = options.port ?? 4400;
    while (true) {
      try {
        await new Promise<void>((accept, reject) => {
          const onError = (error: Error) => {
            server.removeListener('listening', onListening);
            reject(error);
          };
          const onListening = () => {
            server.removeListener('error', onError);
            accept();
          };
          server.once('error', onError);
          server.once('listening', onListening);
          try {
            server.listen(port, options.host ?? 'localhost');
          } catch (error) {
            server.removeListener('error', onError);
            server.removeListener('listening', onListening);
            reject(error);
          }
        });
        break;
      } catch (error) {
        if (!options.findAvailablePort || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port >= 65535)
          throw error;
        port += 1;
      }
    }
  } catch (error) {
    stopWatching();
    throw error;
  }
  server.once('close', stopWatching);
  const address = server.address();
  const host = options.host ?? 'localhost';
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://${host}:${port}`,
    server,
    publish,
    async close() {
      closing = true;
      stopWatching();
      await processing;
      for (const client of clients) client.end();
      await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
    },
  };
}
