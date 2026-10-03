import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { parseConfig, parseSceneMeta, schemaFiles, SchemaValidationError, type SuiteWarning } from './schema.js';

const base = () => ({ title: 'T', renderers: [{ id: 'ref', reference: true }, { id: 'a' }] });

test('schema files are valid JSON Schemas with stable published ids', async () => {
  for (const [kind, url] of Object.entries(schemaFiles)) {
    const schema = JSON.parse(await readFile(url, 'utf8'));
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.$id).toBe(
      `https://unpkg.com/fidelity-kit/schemas/${kind === 'config' ? 'fidelity' : 'scene'}.schema.json`,
    );
  }
});

test('the demo suite configuration is valid', async () => {
  const demo = JSON.parse(await readFile(new URL('../../../../examples/demo/fidelity.json', import.meta.url), 'utf8'));
  expect(parseConfig(demo).renderers.map((r) => r.id)).toEqual(['pathtracer', 'offline-b', 'raster-a', 'raster-b']);
});

test('defaults are applied and editor-only keys are removed', () => {
  const config = parseConfig({ $schema: './node_modules/fidelity-kit/schemas/fidelity.schema.json', ...base() });
  expect(config).toEqual({ ...base(), outputs: [{ id: 'beauty' }] });
  expect(parseSceneMeta({ $schema: 'x' })).toEqual({ tags: [] });
  // The legacy delta setting is accepted silently.
  const warnings: SuiteWarning[] = [];
  expect(
    parseConfig({ ...base(), delta: { enabled: true } }, 'fidelity.json', (w) => warnings.push(w)),
  ).not.toHaveProperty('delta');
  expect(warnings).toEqual([]);
});

test('unknown properties are removed with a warning', () => {
  const warnings: SuiteWarning[] = [];
  const config = parseConfig(
    { ...base(), renders: [], renderers: [{ id: 'ref', reference: true, colour: 'red' }] },
    'fidelity.json',
    (w) => warnings.push(w),
  );
  expect(config.renderers).toEqual([{ id: 'ref', reference: true }]);
  expect(config).not.toHaveProperty('renders');
  expect(warnings).toEqual([
    { path: 'fidelity.json', message: 'unknown property "renders" is ignored' },
    { path: 'fidelity.json', message: 'unknown property "renderers.0.colour" is ignored' },
  ]);
  const sceneWarnings: SuiteWarning[] = [];
  expect(parseSceneMeta({ tittle: 'x' }, 'a/scene.json', (w) => sceneWarnings.push(w))).toEqual({ tags: [] });
  expect(sceneWarnings).toEqual([{ path: 'a/scene.json', message: 'unknown property "tittle" is ignored' }]);
});

test('violations are reported together with readable messages', () => {
  let error: unknown;
  try {
    parseConfig({ renderers: [{ id: 'Ref' }, { id: 'a', reference: 'yes' }], outputs: [] }, 'fidelity.json');
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(SchemaValidationError);
  expect((error as SchemaValidationError).issues).toEqual(
    expect.arrayContaining([
      '(root): missing required property "title"',
      'renderers.0.id: ids must start with a lowercase letter or digit and contain only lowercase letters, digits, ".", "_", or "-"',
      'renderers.1.reference: must be boolean',
      'renderers: at least one renderer needs "reference": true',
      'outputs: must NOT have fewer than 1 items',
    ]),
  );
  expect((error as Error).message).toMatch(/^Invalid fidelity.json:\n {2}- /);
  expect(() => parseConfig({ ...base(), renderers: [...base().renderers, { id: 'a' }] })).toThrow(
    'renderer ids must be unique ("a" is repeated)',
  );
  expect(() => parseConfig({ ...base(), outputs: [{ id: 'beauty' }, { id: 'beauty' }] })).toThrow(
    'output ids must be unique ("beauty" is repeated)',
  );
  expect(() => parseSceneMeta({ tags: 'metal' }, 'a/scene.json')).toThrow(
    'Invalid a/scene.json:\n  - tags: must be array',
  );
});
