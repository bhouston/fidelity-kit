import { expect, it, vi } from 'vitest';
import { runCli } from './index.js';
import { renderSuite } from './render.js';

vi.mock('./render.js', () => ({ renderSuite: vi.fn() }));
// Load the real render command through Vitest; native directory imports require built JS.
vi.mock('yargs-file-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yargs-file-commands')>();
  return { ...actual, fileCommands: async () => [(await import('./commands/render.js')).command] };
});

it('passes every repeated Chrome launch flag through the render CLI', async () => {
  await runCli([
    'render',
    '--registry',
    'registry.json',
    '--chrome-arg=--no-sandbox',
    '--chrome-arg=--enable-unsafe-swiftshader',
  ]);
  expect(renderSuite).toHaveBeenCalledWith(
    expect.objectContaining({
      chromeArgs: ['--no-sandbox', '--enable-unsafe-swiftshader'],
    }),
  );
});
