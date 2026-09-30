# fidelity-kit

Reusable toolkit for renderer fidelity suites: point it at a results folder and get metrics, delta images and a viewer.

## Folder contract

```
<root>/
  fidelity.json     # { title, renderers:[{id,label?,reference?,category?}], outputs:[{id,label?}] (default beauty), delta (default true) }
  README.md         # optional: main page intro
  <group>/…/<scene>/
    README.md       # optional: scene description
    scene.json      # optional: { title?, tags[] }
    <output>/<renderer>.avif
```

Any directory containing `<output>/<renderer>.avif` is a scene; every other directory is a group.

## CLI

`pnpm cli process <root> [--force]` writes, per test renderer and reference, `<renderer>.vs-<ref>.metrics.json` (psnr, rmse, mae, maxError) and `<renderer>.vs-<ref>.delta.avif`, only when older than either input image, plus `<root>/index.json`.

## Status

Core + CLI done; viewer (TanStack Start, Tailwind, shadcn) not started.
