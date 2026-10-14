import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ComparisonMetrics } from './ComparisonMetrics';

test('temporal measurements render without static metrics and never request static processing', () => {
  const html = renderToStaticMarkup(
    createElement(ComparisonMetrics, {
      isTemporal: true,
      temporal: { psnr: 32, temporalPsnr: 28, sharpness: 0.95, frames: 60 },
    }),
  );
  expect(html).toContain('Sequence PSNR');
  expect(html).toContain('Temporal PSNR');
  expect(html).toContain('60');
  expect(html).not.toContain('fidelity-kit process');
});

test('missing temporal measurements offer the temporal command', () => {
  const html = renderToStaticMarkup(createElement(ComparisonMetrics, { isTemporal: true }));
  expect(html).toContain('fidelity-kit temporal');
  expect(html).not.toContain('fidelity-kit process');
});
