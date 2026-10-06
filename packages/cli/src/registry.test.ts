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
