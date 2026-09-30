import { createHashHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// Hash history: deep links work on any static host and in `fidelity-kit build` exports without server rewrites.
export function getRouter() {
  return createRouter({ routeTree, history: createHashHistory(), scrollRestoration: true, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
