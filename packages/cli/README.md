# fidelity-kit

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]
[![Discord][discord-badge]][discord-url]

**Compare renderer output without building a comparison site.** fidelity-kit turns a folder of AVIF renders into image quality metrics, visual difference images, and a browsable website. Use it for rendering fidelity suites, visual regression reviews, and side-by-side comparisons of a renderer against one or more references.

Your renderer writes images; fidelity-kit handles the comparisons and viewer. Run the viewer locally while developing, serve the results from a container, or export a static site.

## Quick start

If you already have a results folder in the format below:

```sh
npx fidelity-kit dev results
```

Open <http://localhost:3000>. `dev` processes new or changed images before starting and serves files without browser caching, so a reload shows your latest render. See the [working example](https://github.com/bhouston/fidelity-kit/tree/main/examples/demo) for a complete suite.

## Adopt it in your suite

Create a `results` directory with a `fidelity.json` file. Put each scene in its own folder, with one AVIF image per renderer under each output name:

```text
results/
  fidelity.json
  README.md                         optional introduction shown in the viewer
  materials/
    brushed-metal/
      README.md                     optional scene description
      scene.json                    optional title and tags
      beauty/
        reference.avif
        my-renderer.avif
      ao/
        reference.avif
        my-renderer.avif
```

Folders can have as many group levels as you need. A scene is any folder containing an image at `<output>/<renderer>.avif` for names declared in `fidelity.json`. Missing renderer images are allowed; the viewer marks them as missing. Other files, such as scene sources and textures, can live alongside the images.

Start with this configuration:

```json
{
  "title": "My Renderer Comparisons",
  "renderers": [
    { "id": "reference", "label": "Reference", "reference": true },
    { "id": "my-renderer", "label": "My Renderer" }
  ],
  "outputs": [{ "id": "beauty" }, { "id": "ao", "label": "Ambient occlusion" }],
  "delta": true
}
```

Mark at least one renderer as a reference. You can declare multiple references; the viewer lets readers choose which one to compare against. Renderer and output IDs must use lowercase letters, numbers, `.`, `_`, or `-`, and start with a letter or number. `outputs` defaults to `beauty` if omitted. Set `delta` to `false` if you only want metrics and the original images.

For searchable scene labels, add a `scene.json` next to a scene's images:

```json
{ "title": "Brushed metal", "tags": ["metal", "roughness"] }
```

## Use it during development

Install the CLI in your suite repository, or use `npx fidelity-kit` for occasional runs:

```sh
pnpm add -D fidelity-kit
pnpm exec fidelity-kit dev results
```

The CLI supports this workflow:

| Command                                  | Use                                                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `fidelity-kit process results`           | Generate comparison metrics, optional delta images, and the viewer index. Reruns update only stale comparisons; add `--force` to recompute all. |
| `fidelity-kit dev results`               | Process stale comparisons, then open a local viewer with caching disabled.                                                                      |
| `fidelity-kit serve results`             | Process stale comparisons, then serve the viewer with browser and CDN caching.                                                                  |
| `fidelity-kit build results --out site/` | Process stale comparisons and export a site for static hosting.                                                                                 |

`process` computes PSNR, RMSE, MAE, and maximum error for each available comparison. Reference and renderer images in a pair must have the same dimensions. Both `dev` and `serve` listen on `localhost:3000` by default; use `--port` and `--host` to change that. To serve results already processed during a build, pass `--no-process`.

For example, add scripts to your suite's `package.json`:

```json
{
  "scripts": {
    "fidelity:dev": "fidelity-kit dev results",
    "fidelity:build": "fidelity-kit build results --out site/"
  }
}
```

You can deploy `site/` to any static host. The site includes the viewer and its data, so it does not need a Node server.

## Serve it from Docker

Process and hash the results while building the image, then start the server without repeating that work:

```dockerfile
FROM node:24-slim

RUN npm install -g fidelity-kit
COPY results /data
RUN fidelity-kit process /data && fidelity-kit hash /data

EXPOSE 8080
CMD ["fidelity-kit", "serve", "/data", "--host", "0.0.0.0", "--port", "8080", "--no-process"]
```

```sh
docker build -t my-fidelity-site .
docker run --rm -p 8080:8080 my-fidelity-site
```

Open <http://localhost:8080>. `hash` prepares versioned image URLs so repeat visits can reuse cached images from the first request. If your results change at runtime, run `serve` without `--no-process` to refresh comparisons at startup; `hash` is optional in that case.

## Author and sponsor

Created by [Ben Houston](https://github.com/bhouston) and sponsored by [Land of Assets](https://landofassets.com).

[npm]: https://img.shields.io/npm/v/fidelity-kit
[npm-url]: https://www.npmjs.com/package/fidelity-kit
[npm-downloads]: https://img.shields.io/npm/dw/fidelity-kit
[npmtrends-url]: https://www.npmtrends.com/fidelity-kit
[tests-badge]: https://github.com/bhouston/fidelity-kit/actions/workflows/ci.yml/badge.svg
[tests-url]: https://github.com/bhouston/fidelity-kit/actions/workflows/ci.yml
[coverage-badge]: https://codecov.io/gh/bhouston/fidelity-kit/branch/main/graph/badge.svg
[coverage-url]: https://codecov.io/gh/bhouston/fidelity-kit
[discord-badge]: https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white
[discord-url]: https://discord.gg/5J5Ur3F6Z2

### Incremental processing

`process --watch` and `dev` retain per-scene dependencies, batch source changes, and share the configured `--concurrency` limit. Scenes and renderer/reference images can be added or removed while watching. Restart after changing renderer IDs, output/pass IDs, or other settings in `fidelity.json`.

Input freshness uses modification time and byte size recorded in metrics files. Older-dated replacements are detected; changes preserving both values require `--force`. Metrics without saved input signatures are regenerated once. Generated metrics, delta images, index files, and temporary writes are ignored by the watcher. Removed comparisons are dropped from the index; generated files may remain on disk.
