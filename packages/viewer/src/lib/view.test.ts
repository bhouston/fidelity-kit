import { expect, test } from 'vitest';
import type { SceneNode, SuiteIndex } from 'fidelity-kit';
import { renderUrl, resolveView, selectScenes, validateViewSearch } from './view';

const index = {
  config: {
    title: 'Test',
    renderers: [{ id: 'ref', reference: true }, { id: 'a' }, { id: 'b' }],
    outputs: [{ id: 'beauty' }],
    delta: true,
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
