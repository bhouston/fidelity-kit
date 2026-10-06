import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRenderHost, hostProtocol, type RenderSession } from './host.js';

// A controlled session tests lifecycle guarantees; real GPU rendering is tested by test:browser.
const reporter = vi.hoisted(() => ({ enabled: false, dispose: vi.fn() }));
vi.mock('./index.js', () => ({ createReporter: vi.fn(() => reporter) }));

let hide: () => void;
let tick: FrameRequestCallback;
let messages: { protocol: string; kind: string; token: string; data: unknown }[];
let clock: number;
function locationFor(mode: string, params: Record<string, unknown> = {}) {
  vi.stubGlobal('location', {
    search: new URLSearchParams({
      fidelityKitMode: mode,
      fidelityKitParams: JSON.stringify(params),
      fidelityKitOrigin: 'https://site.example/path/',
      fidelityKitSession: 'session-token',
    }).toString(),
  });
}
function session(): RenderSession {
  return {
    canvas: { width: 320, height: 240 } as HTMLCanvasElement,
    draw: vi.fn(),
    complete: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clock = 0;
  messages = [];
  vi.stubGlobal('performance', { now: () => clock });
  vi.stubGlobal('document', { body: {} });
  vi.stubGlobal('window', {
    parent: {
      postMessage(message: (typeof messages)[number], origin: string) {
        expect(origin).toBe('https://site.example');
        messages.push(message);
      },
    },
    addEventListener(_name: string, listener: () => void) {
      hide = listener;
    },
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    tick = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared render host contracts', () => {
  it('awaits GPU completion for each capture advance before making the image available', async () => {
    locationFor('capture', { frames: 3 });
    const rendered = session();
    const operations: string[] = [];
    rendered.draw = () => operations.push('draw');
    rendered.complete = async () => {
      await Promise.resolve();
      operations.push('complete');
    };
    await mountRenderHost(async (_params, _reporter, _host, interactive) => {
      expect(interactive).toBe(false);
      // The factory renders the initial frame during setup.
      return rendered;
    });
    expect(operations).toEqual(['draw', 'complete', 'draw', 'complete']);
    expect(messages).toEqual([
      { protocol: hostProtocol, token: 'session-token', kind: 'complete', data: { width: 320, height: 240 } },
    ]);
    hide();
    expect(rendered.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('captures accumulated renderers by requested samples instead of requested frames', async () => {
    locationFor('capture', { frames: 1, samples: 5 });
    const rendered = session();
    let samples = 1;
    rendered.accumulated = () => samples;
    rendered.draw = vi.fn(() => samples++);
    await mountRenderHost(async () => rendered);
    expect(samples).toBe(5);
    expect(rendered.complete).toHaveBeenCalledTimes(4);
    expect(messages.at(-1)?.kind).toBe('complete');
    hide();
  });

  it('publishes setup after ready and local frame summaries once per second, then stops on unload', async () => {
    locationFor('live', { scene: 'cube' });
    const rendered = session();
    await mountRenderHost(async (params, local, _host, interactive) => {
      expect(params).toEqual({ scene: 'cube' });
      expect(interactive).toBe(true);
      expect(messages).toEqual([]);
      const phase = local.phaseStart('shader');
      clock = 10;
      local.phaseEnd(phase);
      local.ready();
      rendered.draw = vi.fn(() => {
        const token = local.frameBegin();
        clock += 2;
        local.frameEnd(token);
      });
      return rendered;
    });
    expect(messages.map((m) => m.kind)).toEqual(['setup', 'ready']);
    expect(messages[0]?.data).toMatchObject({
      totalMs: 10,
      phases: [{ name: 'load' }, { name: 'shader', durationMs: 10 }],
    });
    tick(11);
    clock = 1010;
    await vi.advanceTimersByTimeAsync(999);
    expect(messages).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(messages[2]).toMatchObject({ kind: 'frame', data: { fps: 1, cpuMs: 2, seconds: 1 } });
    expect(messages.every((m) => m.protocol === hostProtocol)).toBe(true);
    hide();
    const count = messages.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(messages).toHaveLength(count);
    expect(rendered.dispose).toHaveBeenCalledOnce();
  });

  it('releases a session that finishes loading after the page was unloaded', async () => {
    locationFor('live');
    const rendered = session();
    let resolve!: (session: RenderSession) => void;
    const mounted = mountRenderHost(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    hide();
    resolve(rendered);
    await mounted;
    expect(rendered.dispose).toHaveBeenCalledOnce();
    expect(messages).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ frames: 0 }, { frames: 1.5 }, { samples: -1 }])(
    'rejects invalid capture bounds %j and disposes resources',
    async (params) => {
      locationFor('capture', params);
      const rendered = session();
      await expect(mountRenderHost(async () => rendered)).rejects.toThrow(/Invalid .* count/);
      expect(rendered.draw).not.toHaveBeenCalled();
      expect(rendered.dispose).toHaveBeenCalledOnce();
      expect(messages.at(-1)?.kind).toBe('error');
      expect(messages.some((m) => m.kind === 'complete')).toBe(false);
    },
  );

  it('reports a live drawing failure and releases timers and rendering resources', async () => {
    locationFor('live');
    const rendered = session();
    rendered.draw = () => {
      throw new Error('device lost');
    };
    await mountRenderHost(async () => rendered);
    tick(16);
    expect(messages.at(-1)).toMatchObject({ kind: 'error', data: 'Error: device lost' });
    expect(rendered.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
