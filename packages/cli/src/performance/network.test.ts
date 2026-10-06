import { expect, it, vi } from 'vitest';
import { applyNetworkProfile, configureNetwork, networkProfiles, resolveNetworkProfile } from './network.js';
import type { CDPSession, Page } from 'puppeteer';
import type { Suite } from '../schema/index.js';
it('resolves named and custom profiles and rejects ambiguous or missing profiles', () => {
  const suite = { defaults: { networkProfile: '3g' } } as Suite;
  expect(resolveNetworkProfile(suite).downloadBytesPerSec).toBe(50000);
  expect(() => resolveNetworkProfile({ ...suite, defaults: { networkProfile: 'oops' } })).toThrow('Unknown');
  expect(() =>
    resolveNetworkProfile({ ...suite, networkProfiles: [networkProfiles[0]!, networkProfiles[0]!] }),
  ).toThrow('Duplicate');
});
it('disables cache and applies conditions in protocol order', async () => {
  const send = vi.fn(async () => {});
  await applyNetworkProfile({ send } as unknown as CDPSession, networkProfiles[2]!);
  expect(send.mock.calls).toEqual([
    ['Network.enable'],
    ['Network.setCacheDisabled', { cacheDisabled: true }],
    [
      'Network.emulateNetworkConditions',
      { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750 },
    ],
  ]);
});
it('registers CDP conditions with Puppeteer so auto-attached iframe targets inherit them', async () => {
  const send = vi.fn(async () => {}),
    cache = vi.fn(async () => {}),
    bypass = vi.fn(async () => {}),
    emulate = vi.fn(async () => {});
  const page = {
    createCDPSession: async () => ({ send }),
    setCacheEnabled: cache,
    setBypassServiceWorker: bypass,
    emulateNetworkConditions: emulate,
  } as unknown as Page;
  await configureNetwork(page, networkProfiles[2]!);
  expect(cache).toHaveBeenCalledWith(false);
  expect(bypass).toHaveBeenCalledWith(true);
  expect(emulate).toHaveBeenCalledWith({ offline: false, latency: 150, download: 200000, upload: 93750 });
});
