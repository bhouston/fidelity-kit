import type { CDPSession, Page } from 'puppeteer';
import type { NetworkProfile, Suite } from '../schema/index.js';
export const networkProfiles: NetworkProfile[] = [
  { name: 'unthrottled', latencyMs: 0, downloadBytesPerSec: -1, uploadBytesPerSec: -1 },
  { name: 'fast-4g', latencyMs: 20, downloadBytesPerSec: 4_000_000, uploadBytesPerSec: 1_000_000 },
  { name: 'slow-4g', latencyMs: 150, downloadBytesPerSec: 200_000, uploadBytesPerSec: 93_750 },
  { name: '3g', latencyMs: 400, downloadBytesPerSec: 50_000, uploadBytesPerSec: 50_000 },
];
export function resolveNetworkProfile(suite: Suite): NetworkProfile {
  const profiles = suite.networkProfiles ?? networkProfiles;
  const names = new Set<string>();
  for (const profile of profiles) {
    if (names.has(profile.name)) throw new Error(`Duplicate network profile: ${profile.name}`);
    names.add(profile.name);
  }
  const name = suite.defaults?.networkProfile ?? 'unthrottled';
  const profile = profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Unknown network profile: ${name}`);
  return profile;
}
export async function applyNetworkProfile(session: CDPSession, profile: NetworkProfile) {
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latencyMs,
    downloadThroughput: profile.downloadBytesPerSec,
    uploadThroughput: profile.uploadBytesPerSec,
  });
}
/** Puppeteer's CDP network manager reapplies settings to auto-attached OOPIF sessions before resuming them. */
export async function configureNetwork(page: Page, profile: NetworkProfile): Promise<void> {
  await applyNetworkProfile(await page.createCDPSession(), profile);
  await page.setCacheEnabled(false);
  await page.setBypassServiceWorker(true);
  await page.emulateNetworkConditions({
    offline: false,
    latency: profile.latencyMs,
    download: profile.downloadBytesPerSec,
    upload: profile.uploadBytesPerSec,
  });
}
