import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const puppeteer = require('puppeteer');
const browserRequire = createRequire(require.resolve('puppeteer'));
const { install, Browser } = browserRequire('@puppeteer/browsers');

// Some Node versions exit while the downloader still has a pending promise.
// Keep the event loop alive, with a finite deadline, until installation settles.
const deadline = setTimeout(
  () => {
    console.error('Timed out installing the test browser after five minutes.');
    process.exit(1);
  },
  5 * 60 * 1000,
);
try {
  const browser = await install({
    browser: Browser.CHROME,
    buildId: puppeteer.default.browserVersion,
    cacheDir: puppeteer.default.configuration.cacheDirectory,
  });
  await access(browser.executablePath);
  console.log(`Installed test Chrome: ${browser.executablePath}`);
} finally {
  clearTimeout(deadline);
}
