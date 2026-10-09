import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { processSuite } from '../packages/cli/dist/core/process.js';
const require = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const work = await mkdtemp(join(tmpdir(), 'fidelity-selection-'));
let browser, server;
try {
  const renderers = [
    { id: 'ref', label: 'Reference', reference: true, category: 'References' },
    ...Array.from({ length: 80 }, (_, i) => ({
      id: 'r-' + i,
      label: 'Renderer ' + i,
      category: i < 40 ? 'Screen-space' : 'Experiments',
      enabled: i === 0,
    })),
  ];
  await writeFile(
    join(work, 'fidelity.json'),
    JSON.stringify({
      title: 'Selectors',
      renderers,
      comparisonPresets: [{ id: 'small', name: 'Small comparison', renderers: ['r-0', 'r-40'], ref: 'ref' }],
    }),
  );
  await mkdir(join(work, 'box', 'beauty'), { recursive: true });
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
    .png()
    .toFile(join(work, 'box', 'beauty', 'ref.png'));
  await writeFile(join(work, 'box', 'scene.json'), JSON.stringify({ category: 'Diagnostics' }));
  await processSuite(work);
  server = spawn(
    process.execPath,
    ['packages/cli/dist/bin.js', 'serve', work, '--host', '127.0.0.1', '--port', '3197'],
    { stdio: 'pipe' },
  );
  let errors = '';
  server.stderr.on('data', (data) => {
    errors += data;
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:3197/')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
    if (i === 99) throw Error(errors);
  }
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_EXECUTABLE ?? puppeteer.executablePath(),
    headless: true,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1024, height: 600 });
  await page.goto('http://127.0.0.1:3197/?view=fidelity');
  await page.waitForSelector('summary');
  await page.evaluate(() =>
    [...document.querySelectorAll('summary')].find((el) => el.textContent.startsWith('Renderers')).click(),
  );
  const dimensions = await page.evaluate(() => {
    const menu = document.querySelector('input[aria-label="Search renderers"]').parentElement;
    return { height: menu.clientHeight, scroll: menu.scrollHeight, overflow: getComputedStyle(menu).overflowY };
  });
  assert.equal(dimensions.overflow, 'auto');
  assert(dimensions.scroll > dimensions.height);
  assert(dimensions.height <= 390);
  await page.click('input[aria-label="Toggle Screen-space"]');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('renderers')?.split(',').length === 40);
  await page.click('input[aria-label="Toggle Screen-space"]');
  await page.waitForFunction(() => new URL(location.href).searchParams.get('renderers') === '-');
  await page.type('input[aria-label="Search renderers"]', 'Renderer 79');
  assert.equal(
    await page.$$eval(
      'input[aria-label="Search renderers"]',
      ([el]) => el.parentElement.querySelectorAll('label:not(:has(input[aria-label]))').length,
    ),
    1,
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('button')].find((el) => el.textContent === 'Small comparison').click(),
  );
  await page.waitForFunction(() => new URL(location.href).searchParams.get('renderers') === 'r-0,r-40');
  await page.reload();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('summary')].some((el) => el.textContent.includes('Renderers (2/80)')),
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('summary')].find((el) => el.textContent.startsWith('Renderers')).click(),
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('input[aria-label="Search renderers"]', (el) => el.closest('details').open), false);
  console.log('Selector browser checks passed: scrolling, groups, search, presets, URL persistence and Escape.');
} finally {
  await browser?.close();
  server?.kill();
  await rm(work, { recursive: true, force: true });
}
