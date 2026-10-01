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
  const reload = vi.fn();
  const cleanup = listenForChanges({ eventsUrl: 'data/events', revision: 'boot:0' }, reload);
  return { reload, cleanup, events: MockEventSource.instances[0]! };
}

test('reloads once when results change, closes the channel, and cleans up on unmount', () => {
  const { events, reload, cleanup } = setup();
  expect(events.url).toBe('data/events');
  events.dispatchEvent(new MessageEvent('ready', { data: 'boot:0' }));
  expect(reload).not.toHaveBeenCalled();
  events.dispatchEvent(new MessageEvent('change', { data: 'boot:1' }));
  events.dispatchEvent(new MessageEvent('change', { data: 'boot:2' }));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(events.close).toHaveBeenCalledTimes(1);
  cleanup?.();
  expect(events.close).toHaveBeenCalledTimes(2);
});

test.each(['boot:1', 'new-boot:0'])(
  'reloads when reconnecting after a missed update or server restart: %s',
  (revision) => {
    const { events, reload } = setup();
    events.dispatchEvent(new MessageEvent('ready', { data: revision }));
    expect(reload).toHaveBeenCalledTimes(1);
  },
);

test('static sites and serve mode do not open a connection', () => {
  vi.stubGlobal('EventSource', MockEventSource);
  expect(listenForChanges(null)).toBeUndefined();
  expect(MockEventSource.instances).toHaveLength(0);
});
