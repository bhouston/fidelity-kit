import { afterEach, expect, test, vi } from 'vitest';
import { listenForChanges } from './live-reload';

class MockEventSource extends EventTarget {
  static instances: MockEventSource[] = [];
  close = vi.fn();
  constructor(public url: string) {
    super();
    MockEventSource.instances.push(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockEventSource.instances = [];
});

function setup() {
  vi.stubGlobal('EventSource', MockEventSource);
  const refresh = vi.fn();
  const cleanup = listenForChanges({ eventsUrl: 'data/events', revision: 'boot:0' }, refresh);
  return { refresh, cleanup, events: MockEventSource.instances[0]! };
}

test('refreshs once when results change, closes the channel, and cleans up on unmount', () => {
  const { events, refresh, cleanup } = setup();
  expect(events.url).toBe('data/events');
  events.dispatchEvent(new MessageEvent('ready', { data: 'boot:0' }));
  expect(refresh).not.toHaveBeenCalled();
  events.dispatchEvent(new MessageEvent('change', { data: 'boot:1' }));
  events.dispatchEvent(new MessageEvent('change', { data: 'boot:2' }));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(events.close).toHaveBeenCalledTimes(1);
  cleanup?.();
  expect(events.close).toHaveBeenCalledTimes(2);
});

test.each(['boot:1', 'new-boot:0'])(
  'refreshs when reconnecting after a missed update or server restart: %s',
  (revision) => {
    const { events, refresh } = setup();
    events.dispatchEvent(new MessageEvent('ready', { data: revision }));
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);

test('static sites and serve mode do not open a connection', () => {
  vi.stubGlobal('EventSource', MockEventSource);
  expect(listenForChanges(null, vi.fn())).toBeUndefined();
  expect(MockEventSource.instances).toHaveLength(0);
});
