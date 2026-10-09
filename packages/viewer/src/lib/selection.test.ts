import { expect, test } from 'vitest';
import { categoryGroups, selectionState, toggleGroup } from './selection';
test('group actions preserve unrelated selections and handle partial groups', () => {
  const selected = new Set(['a', 'other']);
  expect(selectionState(['a', 'b'], selected)).toBe('some');
  const all = toggleGroup(['a', 'b'], selected);
  expect([...all]).toEqual(['a', 'other', 'b']);
  expect(selectionState(['a', 'b'], all)).toBe('all');
  expect([...toggleGroup(['a', 'b'], all)]).toEqual(['other']);
  expect(selectionState(['x'], selected)).toBe('none');
});
test('categories retain registry order and support older metadata', () => {
  const items = [{ id: 'a', category: 'References' }, { id: 'b' }, { id: 'c', category: 'References' }];
  expect(categoryGroups(items)).toEqual([
    ['References', [items[0], items[2]]],
    ['Other', [items[1]]],
  ]);
});
