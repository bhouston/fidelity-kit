# fidelity-kit

Reusable toolkit for renderer fidelity suites: point it at a results folder and get metrics, delta images and a viewer website. Suites (like mtlx-fidelity and ss-fidelity) only produce images; everything else is shared.

- **Folder contract:** hierarchy of groups and scenes, tags, several references, several outputs (beauty, AO, ...), markdown for the home page and per scene.
- **CLI** (`fidelity-kit process <root>`): PSNR / RMSE / MAE / max error and delta heat-maps for stale pairs only, plus `index.json`. `fidelity-kit docgen` emits clidoc/OpenCLI docs.
- **Viewer** (static SPA: Vite, TanStack Router, Tailwind, shadcn): filter, tag chips, sort, output and reference pickers, optional delta images, swipe comparison. `fidelity-kit dev <root>` serves it uncached while you work and `fidelity-kit serve <root>` serves it with ETag/304 and shared-cache headers, from any results folder; `fidelity-kit build <root> --out site/` exports a static site.

See [docs/ADOPTING.md](docs/ADOPTING.md) for the contract, running it and adopting it as a submodule, and [examples/demo](examples/demo) for a working suite.

```sh
npx fidelity-kit serve <results-dir>
# from a checkout:
pnpm install && pnpm build
node packages/cli/dist/bin.js serve examples/demo
```

## Author and sponsor

Created by [Ben Houston](https://github.com/bhouston) and sponsored by [Land of Assets](https://landofassets.com).
