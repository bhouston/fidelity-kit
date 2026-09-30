# Adopting fidelity-kit

A fidelity suite is a folder of rendered images plus one small JSON file. fidelity-kit turns that folder into metrics, delta images and a website. Your own tooling only has to **write images into the right places**.

## 1. Lay out the results folder

```
<root>/
  fidelity.json
  README.md                       optional - intro shown on the home page (markdown)
  <group>/<subgroup>/…/<scene>/   any depth; folders are the hierarchy
    README.md                     optional - scene description (markdown)
    scene.json                    optional - { "title": "…", "tags": ["a", "b"] }
    <output>/<renderer>.avif      one file per renderer per output
```

Rules (there are deliberately no alternatives):

- A directory is a **scene** if it contains at least one `<output>/<renderer>.avif` where both names are declared in `fidelity.json`. Every other directory is a **group**. Directories starting with `.` are ignored.
- Images are `.avif`. Renderer and output ids match `^[a-z0-9][a-z0-9._-]*$`.
- Missing images are fine: the viewer shows a "missing" placeholder.
- Everything else in a scene folder (sources, textures, logs) is ignored, so it can live next to the images.

### fidelity.json

```json
{
  "title": "My Fidelity Suite",
  "renderers": [
    { "id": "pathtracer", "label": "Path Tracer", "reference": true },
    { "id": "raster-a", "label": "Raster A", "category": "rasterizer" }
  ],
  "outputs": [{ "id": "beauty" }, { "id": "ao", "label": "Ambient occlusion" }],
  "delta": true
}
```

- `renderers`: at least one has `"reference": true`. With several references the viewer gets a reference picker, and every other renderer (including the other references) is compared against the selected one. Order is display order.
- `outputs`: defaults to `[{ "id": "beauty" }]`. The output picker is hidden when there is only one.
- `delta`: `false` skips generating delta images and hides the viewer's Deltas switch. When `true`, the switch defaults on and is stored in the URL (`?deltas=false`).

A working example is in [`examples/demo`](../examples/demo).

## 2. Generate metrics and deltas

```sh
pnpm cli process <root>          # or: fidelity process <root>
pnpm cli process <root> --force
```

For every scene, output, reference and test renderer this writes next to the images:

| File                        | Contents                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `<r>.vs-<ref>.metrics.json` | `psnr` (dB, `null` = identical), `rmse`, `mae`, `maxError` (0-1), `width`, `height`, `generatedAt` |
| `<r>.vs-<ref>.delta.avif`   | heat-map of the per-pixel max-channel error (black = identical); skipped when `delta` is `false`   |

A pair is recomputed only if its outputs are missing or older than either input image, so re-running after a partial re-render is cheap. It finishes by writing `<root>/index.json`, the single file the viewer reads. Commit or discard generated files as you like; they are always reproducible.

Image sizes of a reference and a test must match; mismatches are reported as failures and the command exits non-zero.

## 3. View it

```sh
pnpm --filter @fidelity-kit/viewer build
FIDELITY_ROOT=/path/to/root pnpm --filter @fidelity-kit/viewer start   # PORT=3000 by default
# development: FIDELITY_ROOT=/path/to/root pnpm --filter @fidelity-kit/viewer dev
```

The viewer is TanStack Start + Tailwind 4 + shadcn. It reads `index.json` (re-read when it changes) and serves images from `/api/files/…` with strong ETags and `304` revalidation. ETags are lazy: a file is hashed (CRC32) on first request and re-hashed only when its mtime or size changes.

Home page: root `README.md`, tag chips, text filter, sort (name / PSNR), grouped scene rows with reference, renderers, optional delta row and metrics. Scene page: scene `README.md`, swipe comparison, delta image, full metrics. All view state (`q`, `tags`, `output`, `ref`, `deltas`, `sort`) lives in the URL.

Docker: `docker build -f packages/viewer/Dockerfile -t fidelity-viewer .` then run with `-v <root>:/data -e FIDELITY_ROOT=/data`.

## 4. Add it to a suite repository

fidelity-kit is a pnpm workspace consumed as a git submodule:

```sh
git submodule add https://github.com/bhouston/fidelity-kit submodules/fidelity-kit
```

`pnpm-workspace.yaml` of the suite repository:

```yaml
packages:
  - packages/*
  - submodules/fidelity-kit/packages/*

allowBuilds:
  esbuild: true
  sharp: true
```

Root `package.json` scripts:

```json
{
  "scripts": {
    "build:fidelity": "pnpm -r --filter './submodules/fidelity-kit/packages/*' build",
    "fidelity": "node submodules/fidelity-kit/packages/cli/dist/bin.js",
    "viewer": "pnpm --filter @fidelity-kit/viewer dev"
  }
}
```

The suite repository then contains only: its renderer/scene code, its results folder, `fidelity.json`, and (optionally) READMEs. `fidelity docgen --format markdown` documents the CLI.

Pin the submodule to a commit; upgrade by bumping it.

## 5. Migrating existing suites

Neither existing suite needs code changes to _its renderers_, only to where images land and how the viewer is served.

### ss-fidelity (`results/<scene>/<pass>/…`)

Already matches: `results` is the root, passes are `outputs` (`beauty`, `direct`, `ao`), `three-gpu-pathtracer` (and `blender` when present) are `reference` renderers.

1. Add `results/fidelity.json` declaring the renderers and passes.
2. Stop writing `delta-<r>.avif` and `metrics-<r>.json`; delete the old ones and run `fidelity process results --force`. Metrics gain the `.vs-<ref>` name and the old `scene`/`pass`/`reference`/`test` fields are dropped (they are implied by the path).
3. Move scene descriptions from the scene registry into `<scene>/README.md` if you want them on the site.
4. Replace `packages/viewer` with the shared viewer. ss-only features (live render route, three examples) stay as routes in the suite until the kit has an extension point for them.

### mtlx-fidelity (`materials/<type>/<family>/<material>/<renderer>.avif`)

Only the image location changes:

1. Write renderer images to `<material>/beauty/<renderer>.avif` instead of `<material>/<renderer>.avif`. `materialx-glsl` is the `reference`.
2. Renderer status JSON (`<renderer>.json`) is not part of the contract yet; it is ignored.
3. Drop the PSNR-only `metrics.json` and its CLI command in favour of `fidelity process`.
4. `.mtlx` sources and `textures/` can stay in the material folder.

## Extending

New file kinds (renderer reports, more outputs) go in the existing folders and are ignored until the kit learns about them, so adding them never breaks a suite.
