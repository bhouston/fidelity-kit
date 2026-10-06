import { processRun, type RunResult } from '../schema/index.js';
import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from './server.js';
import { Server } from 'node:http';
it('serves isolation headers, index and live reader assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-server-'));
  const results = await mkdtemp(join(tmpdir(), 'performance-data-'));
  await writeFile(join(results, 'README.md'), '# Suite introduction');
  await writeFile(join(root, 'index.html'), '<html>viewer</html>');
  const server = await startServer({ out: results, viewer: root, port: 0 });
  try {
    const response = await fetch(server.url + '/live');
    expect(response.status).toBe(200);
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    expect(await (await fetch(server.url + '/index.json')).json()).toEqual({
      schemaVersion: 2,
      machines: [],
      results: [],
    });
    const introduction = await fetch(server.url + '/README.md');
    expect(introduction.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(await introduction.text()).toBe('# Suite introduction');
    await rm(join(results, 'README.md'));
    expect((await fetch(server.url + '/README.md')).status).toBe(404);
    expect((await fetch(server.url + '/missing')).status).toBe(404);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
    await rm(results, { recursive: true, force: true });
  }
});

import { mkdir, rename } from 'node:fs/promises';
import { vi } from 'vitest';
async function subscribe(url: string) {
  const controller = new AbortController();
  const response = await fetch(`${url}/events`, { signal: controller.signal });
  const reader = response.body!.getReader();
  const events: { type: string; machineId?: string; rendererId?: string; sceneId?: string }[] = [];
  let ended = false;
  const task = (async () => {
    let text = '';
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = text.indexOf('\n\n')) !== -1) {
          const frame = text.slice(0, boundary);
          text = text.slice(boundary + 2);
          const data = frame.split('\n').find((line) => line.startsWith('data: '));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      ended = true;
    }
  })();
  return {
    events,
    task,
    get ended() {
      return ended;
    },
    close() {
      controller.abort();
      return task;
    },
  };
}
it('static serve disables watch metadata and SSE even after result edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-static-'));
  const server = await startServer({ out: root, viewer: root, port: 0 });
  try {
    expect((await fetch(`${server.url}/events`)).status).toBe(404);
    expect(await (await fetch(`${server.url}/index.json`)).json()).not.toHaveProperty('liveReload');
    await writeFile(join(root, 'README.md'), '# Changed');
    expect(await (await fetch(`${server.url}/index.json`)).json()).not.toHaveProperty('liveReload');
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('dev coalesces atomic writes, handles added/removed results and README, and closes pending watches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-watch-'));
  const directory = join(root, 'mac', 'test', 'cube');
  await mkdir(directory, { recursive: true });
  const server = await startServer({ out: root, viewer: root, port: 0, watchResults: true });
  const stream = await subscribe(server.url);
  try {
    expect(await (await fetch(`${server.url}/index.json`)).json()).toMatchObject({ liveReload: true });
    await vi.waitFor(() => expect(stream.events).toEqual([{ type: 'indexChanged' }]));
    const result = processRun({
      schemaVersion: 1,
      runId: 'test',
      entry: {
        id: 'cube',
        name: 'Cube',
        renderer: { id: 'test', name: 'Test Renderer' },
        scene: { id: 'cube', name: 'Spinning cube' },
        url: '/cube',
      },
      networkProfile: { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
      config: { durationMs: 100, vsync: 'on' },
      harness: { teardown: 2 },
      reporter: { frames: [] },
      status: 'ok',
    } as RunResult);
    const temp = join(directory, '.metrics.json.tmp');
    await writeFile(temp, JSON.stringify(result));
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(stream.events).toHaveLength(1); // Temporary writes (and parent metadata) stay silent.
    await rename(temp, join(directory, 'metrics.json'));
    await writeFile(join(root, 'README.md'), '# One');
    await writeFile(join(root, 'README.md'), '# Two');
    await vi.waitFor(() => expect(stream.events).toHaveLength(3), { timeout: 3000 });
    expect(stream.events.slice(1)).toEqual([
      { type: 'readmeChanged' },
      { type: 'resultChanged', machineId: 'mac', rendererId: 'test', sceneId: 'cube' },
    ]);
    expect((await (await fetch(`${server.url}/index.json`)).json()).results).toHaveLength(1);
    expect((await (await fetch(`${server.url}/mac/test/cube/metrics.json`)).json()).runId).toBe('test');
    // A partial metrics write must remain silent until a complete result is published.
    await writeFile(join(directory, 'metrics.json'), '{');
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(stream.events).toHaveLength(3);
    await writeFile(join(directory, 'metrics.json'), JSON.stringify({ ...result, runId: 'updated' }));
    await vi.waitFor(
      () =>
        expect(stream.events.some((event) => event.type === 'resultChanged') && stream.events.length > 3).toBe(true),
      { timeout: 3000 },
    );
    expect((await (await fetch(`${server.url}/mac/test/cube/metrics.json`)).json()).runId).toBe('updated');
    await new Promise((resolve) => setTimeout(resolve, 800));
    const beforeDeletion = stream.events.length;
    await rm(join(directory, 'metrics.json'));
    await rm(join(root, 'README.md'));
    await vi.waitFor(() => expect(stream.events).toHaveLength(beforeDeletion + 2), { timeout: 3000 });
    expect(stream.events.slice(beforeDeletion)).toEqual([
      { type: 'readmeChanged' },
      { type: 'resultChanged', machineId: 'mac', rendererId: 'test', sceneId: 'cube' },
    ]);
    expect((await fetch(`${server.url}/mac/test/cube/metrics.json`)).status).toBe(404);
    expect((await (await fetch(`${server.url}/index.json`)).json()).results).toHaveLength(0);
    const imported = await mkdtemp(join(tmpdir(), 'performance-import-'));
    await mkdir(join(imported, 'cube'));
    await writeFile(
      join(imported, 'cube', 'metrics.json'),
      JSON.stringify({ ...result, entry: { ...result.entry, renderer: { id: 'imported', name: 'Imported' } } }),
    );
    await rename(imported, join(root, 'mac', 'imported'));
    await vi.waitFor(() => expect(stream.events.at(-1)?.type).toBe('indexChanged'), { timeout: 3000 });
    expect((await (await fetch(`${server.url}/index.json`)).json()).results).toHaveLength(1);
    const beforeRemoval = stream.events.length;
    await rm(join(root, 'mac', 'imported'), { recursive: true });
    await vi.waitFor(() => expect(stream.events.length).toBeGreaterThan(beforeRemoval), { timeout: 3000 });
    expect((await (await fetch(`${server.url}/index.json`)).json()).results).toHaveLength(0);
    const beforeClose = stream.events.length;
    // Pending debounced changes must disappear when the server is shut down.
    await writeFile(join(root, 'README.md'), '# Pending');
    await server.close();
    await stream.task;
    expect(stream.ended).toBe(true);
    expect(stream.events).toHaveLength(beforeClose);
    await writeFile(join(root, 'README.md'), '# After close');
  } finally {
    await stream.close();
    if (server.server.listening) await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
it('benchmark live events remain available without enabling filesystem watching', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-live-'));
  const server = await startServer({ out: root, viewer: root, port: 0, live: true });
  const stream = await subscribe(server.url);
  try {
    await vi.waitFor(() => expect(stream.events).toHaveLength(1));
    server.publish({ type: 'resultChanged', machineId: 'mac', rendererId: 'test', sceneId: 'cube' });
    await vi.waitFor(() => expect(stream.events.at(-1)?.type).toBe('resultChanged'));
    expect(await (await fetch(`${server.url}/index.json`)).json()).toMatchObject({ liveReload: true });
  } finally {
    await stream.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('dev retries occupied ports and reports the actual bound URL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-port-'));
  const occupied = await startServer({ out: root, viewer: root, host: '127.0.0.1', port: 0 });
  let dev: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const port = Number(new URL(occupied.url).port);
    dev = await startServer({
      out: root,
      viewer: root,
      host: '127.0.0.1',
      port,
      watchResults: true,
      findAvailablePort: true,
    });
    expect(Number(new URL(dev.url).port)).toBeGreaterThan(port);
    expect((await fetch(`${dev.url}/index.json`)).status).toBe(200);
    expect(dev.server.listenerCount('error')).toBe(0);
    expect(dev.server.listenerCount('listening')).toBe(occupied.server.listenerCount('listening'));
  } finally {
    await dev?.close();
    await occupied.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('serve fails on an occupied configured port', async () => {
  const root = await mkdtemp(join(tmpdir(), 'performance-port-'));
  const occupied = await startServer({ out: root, viewer: root, host: '127.0.0.1', port: 0 });
  try {
    await expect(
      startServer({ out: root, viewer: root, host: '127.0.0.1', port: Number(new URL(occupied.url).port) }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect((await fetch(`${occupied.url}/index.json`)).status).toBe(200);
  } finally {
    await occupied.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  { code: 'EACCES', port: 4400 },
  { code: 'EADDRINUSE', port: 65535 },
])('dev stops on $code at port $port and closes its watcher', async ({ code, port }) => {
  const root = await mkdtemp(join(tmpdir(), 'performance-port-'));
  const error = Object.assign(new Error('Listen failed'), { code });
  const listen = vi.spyOn(Server.prototype, 'listen').mockImplementation(function (this: Server) {
    queueMicrotask(() => this.emit('error', error));
    return this;
  });
  const { watch } = await import('node:fs');
  const probe = watch(root);
  const prototype = Object.getPrototypeOf(probe);
  probe.close();
  const close = vi.spyOn(prototype, 'close');
  try {
    await expect(
      startServer({ out: root, viewer: root, port, watchResults: true, findAvailablePort: true }),
    ).rejects.toBe(error);
    expect(listen).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    listen.mockRestore();
    close.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
});
