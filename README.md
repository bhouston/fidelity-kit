# fidelity-kit

Reusable toolkit for renderer fidelity suites: point it at a results folder and get metrics, delta images and a viewer website. Suites (like mtlx-fidelity and ss-fidelity) only produce images; everything else is shared.

- **Folder contract:** hierarchy of groups and scenes, tags, several references, several outputs (beauty, AO, ...), markdown for the home page and per scene.
- **CLI** (`fidelity process <root>`): PSNR / RMSE / MAE / max error and delta heat-maps for stale pairs only, plus `index.json`. `fidelity docgen` emits clidoc/OpenCLI docs.
- **Viewer** (TanStack Start, Tailwind, shadcn): filter, tag chips, sort, output and reference pickers, optional delta images, swipe comparison, ETag/304 image serving.

See [docs/ADOPTING.md](docs/ADOPTING.md) for the contract, running it and adopting it as a submodule, and [examples/demo](examples/demo) for a working suite.

```sh
pnpm install && pnpm build
pnpm cli process examples/demo
pnpm --filter @fidelity-kit/viewer build
FIDELITY_ROOT=$PWD/examples/demo pnpm --filter @fidelity-kit/viewer start
```
