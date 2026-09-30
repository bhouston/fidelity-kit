import { createServerFn } from '@tanstack/react-start';

/** Whole suite for the client: index.json plus a flat scene list. Loaded once by the root route. */
export const getSuite = createServerFn({ method: 'GET' }).handler(async () => {
  const [{ readIndex }, { allScenes }] = await Promise.all([
    import('./suite.server'),
    import('@fidelity-kit/core/scan'),
  ]);
  const index = await readIndex();
  return { index, scenes: [...allScenes(index.root)] };
});

export const getReadme = createServerFn({ method: 'GET' })
  .validator((path: unknown) => (typeof path === 'string' ? path : ''))
  .handler(async ({ data: path }) => (await import('./suite.server')).readReadme(path) ?? null);
