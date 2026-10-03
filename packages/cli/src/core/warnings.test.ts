import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, test } from 'vitest';
import { formatWarnings } from '../warnings.js';
import { processSuite, readConfig, scanScene, scanSuite, type SuiteWarning } from './index.js';

async function suite(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'fk-warn-'));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const config = JSON.stringify({ title: 'T', renderers: [{ id: 'ref', reference: true }, { id: 'a' }] });

test('scans report ignored images and folders without warning about valid or unrelated files', async () => {
  const root = await suite({
    'fidelity.json': config,
    'README.md': '# Suite',
    'ref.avif': '',
    'beauty/ref.avif': '',
    '.cache/beauty/ref.avif': '',
    'assets/logo.png': '',
    's1/scene.json': JSON.stringify({ title: 'One', tittle: 'typo' }),
    's1/ref.avif': '',
    's1/beauty/ref.avif': '',
    's1/beauty/a.avif': '',
    's1/beauty/a.png': '',
    's1/beauty/A.webp': '',
    's1/beauty/old.avif': '',
    's1/beauty/ref.jpeg': '',
    's1/beauty/ref.exr': '',
    's1/beauty/a.vs-ref.delta.webp': '',
    's1/beauty/a.vs-ref.metrics.json': '{}',
    's1/beauty/notes.txt': '',
    's1/textures/wood.png': '',
    's1/diffuse/ref.avif': '',
    's1/nested/beauty/ref.avif': '',
    'g/s2/diffuse/a.avif': '',
  });
  const warnings: SuiteWarning[] = [];
  const scanned = await scanSuite(root, { onWarning: (w) => warnings.push(w) });
  expect(scanned.root.scenes.map((s) => s.path)).toEqual(['s1']);
  expect(scanned.root.groups).toEqual([]);
  const outside = 'renderer image is outside a declared output folder (beauty) and is ignored';
  expect(warnings.toSorted((x, y) => x.path.localeCompare(y.path))).toEqual([
    {
      path: 'beauty',
      message: 'output folder at the results root is ignored; put it inside a scene folder (e.g. my-scene/beauty)',
    },
    { path: 'g/s2/diffuse/a.avif', message: outside },
    { path: 'ref.avif', message: outside },
    { path: 's1/beauty/a.png', message: 'ignored because a.avif takes precedence (.avif > .webp > .png > .jpg)' },
    {
      path: 's1/beauty/A.webp',
      message: '"A" is not a renderer in fidelity.json; image is ignored (did you mean "a"?)',
    },
    { path: 's1/beauty/old.avif', message: '"old" is not a renderer in fidelity.json; image is ignored' },
    { path: 's1/beauty/ref.exr', message: 'unsupported image format is ignored; use .avif, .webp, .png, .jpg' },
    { path: 's1/beauty/ref.jpeg', message: 'unsupported image format is ignored; use .avif, .webp, .png, .jpg' },
    { path: 's1/diffuse/ref.avif', message: outside },
    {
      path: 's1/nested',
      message: 'nested scene is ignored because "s1" is already a scene; move it beside its parent',
    },
    { path: 's1/ref.avif', message: outside },
    { path: 's1/scene.json', message: 'unknown property "tittle" is ignored' },
  ]);

  // Watch mode rescans one scene and reports only that scene's warnings.
  const rescan: SuiteWarning[] = [];
  await scanScene(root, 's1', await readConfig(root), (w) => rescan.push(w));
  expect(rescan.map((w) => w.path).every((path) => path.startsWith('s1/'))).toBe(true);
  expect(rescan).toHaveLength(9);
});

test('configuration problems name the file', async () => {
  await expect(readConfig(await suite({}))).rejects.toThrow(/^No fidelity.json in /);
  await expect(readConfig(await suite({ 'fidelity.json': '{ "title": ' }))).rejects.toThrow(/^Invalid fidelity.json: /);
  const root = await suite({ 'fidelity.json': config, 's/scene.json': '{"tags": "x"}', 's/beauty/ref.avif': '' });
  await expect(scanSuite(root)).rejects.toThrow('Invalid s/scene.json:\n  - tags: must be array');
});

test('warnings are grouped by message for terminal output', () => {
  const message = '"old" is not a renderer in fidelity.json; image is ignored';
  const warnings = ['a', 'b', 'c', 'd', 'e'].map((s) => ({ path: `${s}/beauty/old.avif`, message }));
  expect(formatWarnings([...warnings, { path: 'fidelity.json', message: 'unknown property "x" is ignored' }])).toEqual([
    `warning: a/beauty/old.avif, b/beauty/old.avif, c/beauty/old.avif and 2 more: ${message}`,
    'warning: fidelity.json: unknown property "x" is ignored',
  ]);
});

test('processing results carry configuration and scan warnings', async () => {
  const root = await suite({
    'fidelity.json': JSON.stringify({ ...JSON.parse(config), theme: 'dark' }),
    's/scene.json': '{}',
    's/beauty/b.avif': '',
  });
  const { warnings } = await processSuite(root);
  expect(warnings).toEqual([
    { path: 'fidelity.json', message: 'unknown property "theme" is ignored' },
    { path: 's/beauty/b.avif', message: '"b" is not a renderer in fidelity.json; image is ignored' },
  ]);
});
