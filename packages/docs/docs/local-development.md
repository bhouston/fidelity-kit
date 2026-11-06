---
title: Local development
description: Add fidelity-kit scripts to your project to process, watch and view renderer comparisons while you develop.
---

After [creating your suite](./suite-format.md), add scripts to your project:

```json
{
  "scripts": {
    "fidelity:dev": "fidelity-kit dev results",
    "fidelity:build": "fidelity-kit build results --out site/"
  }
}
```

Run `pnpm fidelity:dev` while rendering. It processes stale results at startup and watches new or changed images, removed scenes, and edits to scene metadata. Reload the viewer to see updates. Restart the command after editing renderer, output, or other `fidelity.json` settings.

For a one-time comparison, run `pnpm exec fidelity-kit process results`. Add `--watch` to keep it processing, or `--force` to rebuild existing comparisons. The default comparison concurrency is one pair per CPU; set `--concurrency 1` to process sequentially. `--quiet` suppresses progress output.

The viewer uses port 3000 by default and finds another available port if needed. Use `--port` to select a specific port or `--host` to change the bind address. See the [generated CLI reference](/docs/cli) for every option.

## How processing works

`process` computes only PSNR (in dB) for each available comparison. Delta heatmaps are encoded as lossy WebP at quality 85 and effort 4 (`<renderer>.vs-<reference>.delta.webp`) to reduce file size. Source images keep their original formats, and metrics are computed from the source pixels before heatmap compression. Reference and renderer images in a pair must have the same dimensions.

Freshness uses each input image's modification time and byte size, recorded in its metrics file after a successful comparison. Replacing an image with an older-dated file is detected. Files whose timestamp and size both remain unchanged are assumed unchanged; use `--force` to bypass that cache. Removed comparisons disappear from the index; their generated files may remain on disk and are validated before any later reuse. Heatmap signatures are stored in `.delta.webp.json` cache sidecars, which are excluded from serving and static export.

Comparisons run in parallel, one per CPU by default. Set `--concurrency <n>` on `process`, `dev`, `serve` or `build`, or `--concurrency 1` for sequential runs. To serve results that were already processed during a build, pass `--no-process`.

`dev` and `serve` start at `localhost:3000` and try higher ports if it is occupied. `dev` watches for added or removed scenes, added or changed reference and renderer images, and edits to scene metadata, and batches the changes through the same concurrency limit. Renderer IDs, output IDs and other `fidelity.json` settings stay fixed until you restart; the watcher reports configuration changes that need a restart. Generated metrics, deltas, the index and temporary files are ignored, so processing cannot trigger a watch loop. A separate dev-only watcher notifies connected viewers after a five-second debounce when `index.json` or a README changes, which also picks up results published by another process with `--no-watch`. `serve` and static exports do not open a live channel.

`process`, `dev` and `hash` show scanning and processing progress on one updating terminal line, with the remaining count and an approximate ETA. `--quiet` suppresses progress and summary output; errors are still reported.

In the viewer, PSNR sorting uses the lowest PSNR among the visible compared renderers for the selected output and reference. Hiding renderers changes the ranking immediately. Identical images have infinite PSNR, and scenes without visible comparison metrics appear last.
