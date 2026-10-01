import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createLiveReload, watchLiveReload } from './live-reload.js';
import { createHandler, serve } from './server.js';

afterEach(() => vi.useRealTimers());
const decode = (value?: Uint8Array) => new TextDecoder().decode(value);

test('broadcasts one update to all clients five seconds after the last publication', async () => {
  vi.useFakeTimers();
  const live = createLiveReload();
  const a = live.response(new Request('http://x/data/events')).body!.getReader();
  const b = live.response(new Request('http://x/data/events')).body!.getReader();
  try {
    const revision = live.revision();
    expect(decode((await a.read()).value)).toContain(`event: ready\ndata: ${revision}`);
    await b.read();
    live.notify();
    await vi.advanceTimersByTimeAsync(4000);
    live.notify();
    await vi.advanceTimersByTimeAsync(4999);
    expect(live.revision()).toBe(revision);
    await vi.advanceTimersByTimeAsync(1);
    expect(live.revision()).not.toBe(revision);
    expect(decode((await a.read()).value)).toContain(`event: change\ndata: ${live.revision()}`);
    expect(decode((await b.read()).value)).toContain('event: change');
    await a.cancel();
    live.notify();
    await vi.advanceTimersByTimeAsync(5000);
    expect(decode((await b.read()).value)).toContain('event: change');
  } finally {
    live.close();
  }
  expect((await b.read()).done).toBe(true);
});

test('handshake carries current revision after reconnect and shutdown cancels pending notifications', async () => {
  vi.useFakeTimers();
  const live = createLiveReload();
  live.notify();
  await vi.advanceTimersByTimeAsync(5000);
  const response = live.response(new Request('http://x/data/events'));
  expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const reader = response.body!.getReader();
  expect(decode((await reader.read()).value)).toContain(live.revision());
  const revision = live.revision();
  live.notify();
  live.close();
  await vi.advanceTimersByTimeAsync(5000);
  expect(live.revision()).toBe(revision);
  expect((await reader.read()).done).toBe(true);
});

test('dev advertises the channel, serve does not, and HTTP disconnects clean up streams', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fk-live-http-'));
  await writeFile(join(root, 'index.json'), '{}');
  const live = createLiveReload(20);
  const handler = createHandler(root, { dev: true, liveReload: live });
  const server = await serve(handler, 0, '127.0.0.1');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const url = `http://127.0.0.1:${address.port}`;
    const index = await fetch(`${url}/data/index.json`);
    expect(index.headers.get('X-Fidelity-Events')).toBe('data/events');
    expect(index.headers.get('X-Fidelity-Revision')).toBe(live.revision());
    await index.text();
    const head = await fetch(`${url}/data/events`, { method: 'HEAD' });
    expect(head.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await head.text()).toBe('');
    const abort = new AbortController();
    const response = await fetch(`${url}/data/events`, { signal: abort.signal });
    const reader = response.body!.getReader();
    expect(decode((await reader.read()).value)).toContain('event: ready');
    live.notify();
    expect(decode((await reader.read()).value)).toContain('event: change');
    abort.abort();
    await reader.cancel().catch(() => {});
    const ordinary = createHandler(root, { liveReload: live });
    const normalIndex = await ordinary(new Request('http://x/data/index.json'));
    expect(normalIndex.headers.get('X-Fidelity-Events')).toBeNull();
    await normalIndex.text();
    expect((await ordinary(new Request('http://x/data/events'))).status).toBe(404);
  } finally {
    live.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('watches external index and README publications but ignores temporary and input files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fk-live-watch-'));
  const live = createLiveReload();
  const notify = vi.spyOn(live, 'notify');
  const watcher = await watchLiveReload(root, live);
  try {
    await writeFile(join(root, 'index.json.tmp'), '{}');
    await writeFile(join(root, 'renderer.png'), 'image');
    await writeFile(join(root, 'index.json'), '{}');
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await writeFile(join(root, 'README.md'), '# Updated');
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2), { timeout: 4000 });
  } finally {
    await watcher.close();
    live.close();
    await rm(root, { recursive: true, force: true });
  }
});
