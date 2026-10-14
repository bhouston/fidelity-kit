import { expect, test } from 'vitest';
import { resolveSections, resolveSectionView } from './sections';

test('legacy sites retain static fidelity and enable temporal from results', () => {
  expect(resolveSections(null, true)).toEqual({ static: true, temporal: true, performance: false });
});
test('temporal-only sites redirect old fidelity and dynamic links', () => {
  const sections = resolveSections({ temporalFidelity: {}, performance: {} }, true);
  expect(sections.static).toBe(false);
  expect(resolveSectionView('fidelity', sections)).toBe('temporal');
  expect(resolveSectionView('dynamic', sections)).toBe('temporal');
});
test('explicit section opt-outs override stale results', () => {
  const sections = resolveSections({ staticFidelity: true, temporalFidelity: false, performance: {} }, true);
  expect(sections).toEqual({ static: true, temporal: false, performance: false });
});
test('performance requires configured entries or results', () => {
  expect(resolveSections(null, false, true).performance).toBe(true);
});
