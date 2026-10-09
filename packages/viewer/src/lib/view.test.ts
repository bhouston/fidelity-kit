import { expect, test } from 'vitest';
import type { SceneNode, SuiteIndex } from 'fidelity-kit';
import { renderUrl, resolveView, selectScenes, validateViewSearch } from './view';

const index = {
  config: {
    title: 'Test',
    renderers: [{ id: 'ref', reference: true }, { id: 'a' }, { id: 'b' }],
    outputs: [{ id: 'beauty' }],
  },
  metrics: {},
} as SuiteIndex;
const scenes: SceneNode[] = [
  { path: 'empty', title: 'Empty', tags: [], images: {}, hasReadme: false },
  { path: 'partial', title: 'Partial', tags: [], images: { beauty: ['ref', 'a'] }, hasReadme: false },
];

test('renderer selection defaults to all, persists through URL search, and preserves missing scenes', () => {
  const all = resolveView(index, validateViewSearch({}));
  expect(all.compared).toEqual(['a', 'b']);
  expect(selectScenes(index, scenes, {}, all)).toHaveLength(2);
  expect(renderUrl(scenes[1]!, all, 'b')).toBeUndefined();

  const search = validateViewSearch({ renderers: 'b' });
  expect(resolveView(index, search).compared).toEqual(['b']);
  expect(resolveView(index, validateViewSearch({ renderers: '-' })).compared).toEqual([]);
});

test('renderers with enabled: false are hidden by default but selectable', () => {
  const cfg = {
    ...index,
    config: { ...index.config, renderers: [{ id: 'ref', reference: true }, { id: 'a', enabled: false }, { id: 'b' }] },
  };
  expect(resolveView(cfg, validateViewSearch({})).compared).toEqual(['b']);
  expect(resolveView(cfg, validateViewSearch({ renderers: 'a,b' })).compared).toEqual(['a', 'b']);
});

test('deltas default to visible even with legacy configuration, with a display-only opt-out', () => {
  const legacy = { ...index, config: { ...index.config, delta: false } };
  expect(resolveView(legacy, {}).showDeltas).toBe(true);
  expect(resolveView(legacy, { deltas: false }).showDeltas).toBe(false);
});

test('uses selected input filenames and WebP heatmaps in versioned viewer URLs', async () => {
  const { deltaUrl } = await import('./view');
  const scene: SceneNode = {
    path: 'group/a scene',
    title: 'Mixed',
    tags: [],
    hasReadme: false,
    images: { beauty: ['ref', 'a', 'b'] },
    imageFiles: { beauty: { ref: 'ref.png', a: 'a.webp', b: 'b.jpg' } },
  };
  const mixed = {
    ...index,
    metrics: {
      'group/a scene/beauty/a.vs-ref.metrics.json': {
        psnr: null,
        width: 8,
        height: 8,
        generatedAt: '',
        deltaFile: 'a.vs-ref.delta.webp',
      },
    },
  };
  const view = resolveView(
    mixed,
    {},
    {
      'group/a scene/beauty/a.webp': 'image-hash',
      'group/a scene/beauty/a.vs-ref.delta.webp': 'delta-hash',
    },
  );
  expect(renderUrl(scene, view, 'ref')).toBe('data/group/a%20scene/beauty/ref.png');
  expect(renderUrl(scene, view, 'a')).toBe('data/group/a%20scene/beauty/a.webp?v=image-hash');
  expect(renderUrl(scene, view, 'b')).toBe('data/group/a%20scene/beauty/b.jpg');
  expect(deltaUrl(mixed, scene, view, 'a')).toBe('data/group/a%20scene/beauty/a.vs-ref.delta.webp?v=delta-hash');
  expect(deltaUrl(mixed, scene, view, 'b')).toBeUndefined();
  // --no-process can still display indexes produced by the AVIF-only CLI.
  expect(renderUrl(scenes[1]!, view, 'a')).toBe('data/partial/beauty/a.avif');
  const legacy = {
    ...mixed,
    metrics: {
      ...mixed.metrics,
      'group/a scene/beauty/a.vs-ref.metrics.json': {
        ...mixed.metrics['group/a scene/beauty/a.vs-ref.metrics.json']!,
        deltaFile: undefined,
      },
    },
  };
  expect(deltaUrl(legacy, scene, view, 'a')).toBe('data/group/a%20scene/beauty/a.vs-ref.delta.avif');
});

test('PSNR sorting uses the worst visible comparison and keeps missing metrics last', () => {
  const items = ['a', 'b', 'identical', 'missing'].map((path) => ({
    path,
    title: path,
    tags: [],
    hasReadme: false,
    images: { beauty: ['ref', 'a', 'b'] },
  }));
  const metrics = Object.fromEntries(
    [
      ['a', 'a', 10],
      ['a', 'b', 80],
      ['b', 'a', 30],
      ['b', 'b', 20],
      ['identical', 'a', null],
      ['identical', 'b', null],
    ].map(([scene, renderer, psnr]) => [
      `${scene}/beauty/${renderer}.vs-ref.metrics.json`,
      {
        psnr: psnr as number | null,
        width: 8,
        height: 8,
        generatedAt: '',
      },
    ]),
  );
  const suite = { ...index, metrics };
  const sorted = (renderers: string | undefined, sort: 'psnr-asc' | 'psnr-desc' = 'psnr-asc') => {
    const search = { renderers, sort };
    return selectScenes(suite, items, search, resolveView(suite, search)).map((s) => s.path);
  };
  expect(sorted(undefined)).toEqual(['a', 'b', 'identical', 'missing']);
  expect(sorted('b')).toEqual(['b', 'a', 'identical', 'missing']);
  expect(sorted('b', 'psnr-desc')).toEqual(['identical', 'a', 'b', 'missing']);
  expect(sorted('-')).toEqual(['a', 'b', 'identical', 'missing']);
  const search = { output: 'absent', ref: 'other', sort: 'psnr-asc' as const };
  const view = { ...resolveView(suite, {}), output: 'absent' };
  expect(selectScenes(suite, items, search, view)).toEqual(items);
  expect(selectScenes(suite, items, search, { ...view, output: 'beauty', ref: 'other' })).toEqual(items);
});

test('scene family union combines with tag filters and survives URLs', () => {
  const grouped = scenes.map((s, i) => ({ ...s, category: i ? 'Models' : 'Diagnostics', tags: ['glass'] }));
  const search = validateViewSearch({ groups: 'Models,Diagnostics', tags: 'glass' });
  expect(selectScenes(index, grouped, search, resolveView(index, search))).toHaveLength(2);
  expect(selectScenes(index, grouped, { groups: 'Models' }, resolveView(index, {})).map((s) => s.path)).toEqual([
    'partial',
  ]);
  expect(selectScenes(index, grouped, { groups: '-' }, resolveView(index, {}))).toEqual([]);
});
