import { createBrowserHistory, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// The detail page is `/?scene=<path>`, so the URL path is always the viewer's own directory: deep links work on any
// static host, subpath and `fidelity-kit build` export without server rewrites, and the URL hash is free for bookmarks.
export function getRouter() {
  const basepath = new URL('.', document.baseURI).pathname.replace(/\/$/, '') || '/';
  return createRouter({
    routeTree,
    basepath,
    history: createBrowserHistory(),
    scrollRestoration: true,
    defaultPreload: 'intent',
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
