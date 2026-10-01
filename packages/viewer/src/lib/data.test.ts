import { afterEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../components/Markdown';
import { getPreamble } from './data';

afterEach(() => vi.unstubAllGlobals());

test('loads README.md and renders formatted text and links', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('**Welcome** to [MaterialX](https://materialx.org/)'));
  vi.stubGlobal('fetch', fetch);
  const preamble = await getPreamble();
  expect(fetch).toHaveBeenCalledExactlyOnceWith('data/README.md');
  // This test uses createElement because the test suite discovers .ts files, not .tsx.
  // oxlint-disable-next-line react/no-children-prop
  const html = renderToStaticMarkup(createElement(Markdown, { children: preamble! }));
  expect(html).toContain('<strong>Welcome</strong>');
  expect(html).toContain('<a href="https://materialx.org/">MaterialX</a>');
});

test.each([
  new Response('', { status: 404 }),
  new Response('<html>SPA fallback</html>', { headers: { 'Content-Type': 'text/html' } }),
])('missing README has no preamble', async (response) => {
  const fetch = vi.fn().mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetch);
  expect(await getPreamble()).toBeNull();
  expect(fetch).toHaveBeenCalledExactlyOnceWith('data/README.md');
});

test('an empty README.md has no introduction', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(''));
  vi.stubGlobal('fetch', fetch);
  expect(await getPreamble()).toBe('');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('missing optional introductions do not prevent loading results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
  expect(await getPreamble()).toBeNull();
});

test('network failures in optional introductions do not prevent loading results', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network unavailable')));
  expect(await getPreamble()).toBeNull();
});
