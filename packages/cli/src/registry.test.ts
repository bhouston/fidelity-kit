import { describe, expect, it } from 'vitest';
import { parseRegistry, performanceSuite, rendererParams, rendererUrl } from './registry.js';
const input = {
  schemaVersion: 1,
  title: 'Render suite',
  renderServer: {
    developmentUrl: 'http://localhost:5173/',
    deployedUrl: 'https://render.test/app/',
    entry: 'render.html',
  },
  renderers: [
    { id: 'base', name: 'Base', params: { renderer: 'stock', quality: 3 } },
    { id: 'native', name: 'Native', kind: 'external', reference: true, command: ['native', '{output}'] },
  ],
  scenes: [
    { id: 'box', name: 'Box', params: { seed: 2 } },
    { id: 'sphere', name: 'Sphere' },
  ],
  performance: { default: { entries: [{ scene: 'box', renderer: 'base', durationMs: 1000 }] } },
};
describe('shared rendering suite', () => {
  it('uses the same renderer and scene settings without expanding a Cartesian product', () => {
    const suite = parseRegistry(input),
      performance = performanceSuite(suite);
    expect(performance.entries).toHaveLength(1);
    expect(performance.entries[0]!.params).toMatchObject({
      ...rendererParams(suite, 'base', 'box'),
      width: 1920,
      height: 1080,
    });
    expect(performance.entries[0]!.url).toBe('render.html');
  });
  it('separates local and deployed endpoints and accepts a deployed root override', () => {
    const suite = parseRegistry(input);
    expect(rendererUrl(suite, 'development').href).toBe('http://localhost:5173/render.html');
    expect(rendererUrl(suite, 'deployed').href).toBe('https://render.test/app/render.html');
    expect(rendererUrl(suite, 'deployed', 'https://other.test/r').href).toBe('https://other.test/r/render.html');
    expect(() =>
      rendererUrl(
        parseRegistry({ ...input, renderServer: { ...input.renderServer, deployedUrl: undefined } }),
        'deployed',
      ),
    ).toThrow('deployedUrl');
  });
  it('rejects duplicate identities, missing scene references, and native performance entries', () => {
    expect(() => parseRegistry({ ...input, renderers: [input.renderers[0], input.renderers[0]] })).toThrow('Duplicate');
    expect(() =>
      parseRegistry({ ...input, performance: { default: { entries: [{ scene: 'missing', renderer: 'base' }] } } }),
    ).toThrow('Unknown scene');
    expect(() =>
      parseRegistry({ ...input, performance: { default: { entries: [{ scene: 'box', renderer: 'native' }] } } }),
    ).toThrow('browser renderer');
  });
});

it('rejects ambiguous historical renderer identities instead of silently relabeling results', () => {
  const renderers = structuredClone(input.renderers);
  expect(() =>
    parseRegistry({
      ...input,
      renderers: [
        { ...renderers[0], legacyIds: ['old'] },
        { ...renderers[1], legacyIds: ['old'] },
      ],
    }),
  ).toThrow('Ambiguous');
  expect(() =>
    parseRegistry({ ...input, renderers: [{ ...renderers[0], legacyIds: ['native'] }, renderers[1]] }),
  ).toThrow('Ambiguous');
});
it('requires the home hero to identify a registered scene and renderer', () => {
  expect(() => parseRegistry({ ...input, home: { hero: { scene: 'missing', renderer: 'base' } } })).toThrow('hero');
  expect(() => parseRegistry({ ...input, home: { hero: { scene: 'box', renderer: 'missing' } } })).toThrow('hero');
  expect(parseRegistry({ ...input, home: { hero: { scene: 'box', renderer: 'native' } } }).home.hero).toEqual({
    scene: 'box',
    renderer: 'native',
    output: 'beauty',
  });
});

it('preserves categories, tags and presets and rejects invalid preset identities', () => {
  const value = {
    ...input,
    renderers: input.renderers.map((r) => ({ ...r, category: 'References' })),
    scenes: input.scenes.map((s) => ({ ...s, category: 'Diagnostics', tags: ['glass'] })),
    comparisonPresets: [{ id: 'test', name: 'Test', renderers: ['base'], ref: 'native' }],
  };
  expect(parseRegistry(value).comparisonPresets?.[0]?.ref).toBe('native');
  expect(parseRegistry(value).scenes[0]?.tags).toEqual(['glass']);
  expect(() =>
    parseRegistry({ ...value, comparisonPresets: [{ id: 'bad', name: 'Bad', renderers: ['missing'] }] }),
  ).toThrow('Unknown renderer');
  expect(() =>
    parseRegistry({ ...value, comparisonPresets: [{ id: 'bad', name: 'Bad', renderers: [], ref: 'base' }] }),
  ).toThrow('Invalid reference');
});
