import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const puppeteer = require('puppeteer');
const browserRequire = createRequire(require.resolve('puppeteer'));
const { install, Browser } = browserRequire('@puppeteer/browsers');

// Explicitly await installation; dependency install scripts may be disabled in CI.
const browser = await install({
  browser: Browser.CHROME,
  buildId: puppeteer.default.browserVersion,
  cacheDir: puppeteer.default.configuration.cacheDirectory,
});
await access(browser.executablePath);
console.log(`Installed test Chrome: ${browser.executablePath}`);
