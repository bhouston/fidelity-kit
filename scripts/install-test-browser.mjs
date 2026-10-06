import { access, mkdtemp, mkdir, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const puppeteer = require('puppeteer');
const browserRequire = createRequire(require.resolve('puppeteer'));
const { Browser, Cache, detectBrowserPlatform, getDownloadUrl } = browserRequire('@puppeteer/browsers');
const platform = detectBrowserPlatform();
if (!platform) throw new Error('Unsupported test browser platform.');
const buildId = puppeteer.default.browserVersion;
const cache = new Cache(puppeteer.default.configuration.cacheDirectory);
const destination = cache.installationDir(Browser.CHROME, platform, buildId);
const executable = puppeteer.executablePath();

try {
  await access(executable);
} catch {
  // Native extraction avoids extract-zip hanging on the project's Node 26 runtime.
  // curl and unzip are available on the supported macOS and Linux test machines.
  const work = await mkdtemp(join(tmpdir(), 'fidelity-chrome-'));
  try {
    const execute = promisify(execFile);
    const archive = join(work, 'chrome.zip');
    const unpacked = join(work, 'unpacked');
    const url = getDownloadUrl(Browser.CHROME, platform, buildId).href;
    console.log(`Installing test Chrome ${buildId} from ${url}`);
    await execute('curl', ['--fail', '--location', '--retry', '2', '--max-time', '240', '--output', archive, url], {
      timeout: 250_000,
    });
    await execute('unzip', ['-q', archive, '-d', unpacked], { timeout: 60_000 });
    await mkdir(dirname(destination), { recursive: true });
    await rm(destination, { recursive: true, force: true });
    await rename(unpacked, destination);
    await access(executable);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
console.log(`Installed test Chrome: ${executable}`);
