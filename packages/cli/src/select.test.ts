import { expect, it } from 'vitest';
import { selectNames } from './select.js';
const names = ['gpu-base', 'gpu-other', 'native'];
it('matches wildcards, comma-separated patterns and groups in registry order without duplicates', () => {
  expect(selectNames(names, ' native, gpu-*,gpu-?ase ', 'renderer')).toEqual(names);
  expect(selectNames(names, 'gpu-{base,other}', 'renderer')).toEqual(names.slice(0, 2));
  expect(selectNames(names, 'gpu-[bo]*', 'renderer')).toEqual(names.slice(0, 2));
});
it('reports empty and unmatched selections', () => {
  expect(() => selectNames(names, ' , ', 'renderer')).toThrow('No renderer glob supplied');
  expect(() => selectNames(names, 'gpu-*,missing', 'renderer')).toThrow('No renderer matches "missing"');
});
