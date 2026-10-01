# fidelity-kit

[Documentation](https://fidelity-kit.ben3d.ca) · [Suite format](https://fidelity-kit.ben3d.ca/docs/suite-format) · [CLI reference](https://fidelity-kit.ben3d.ca/docs/cli)

[![NPM Package][npm]][npm-url]
[![NPM Downloads][npm-downloads]][npmtrends-url]
[![Tests][tests-badge]][tests-url]
[![Coverage][coverage-badge]][coverage-url]
[![Discord][discord-badge]][discord-url]
[![Docs][docs-badge]][docs-url]

**Compare renderer output without building a comparison site.** fidelity-kit turns a folder of AVIF renders into image quality metrics, visual difference images, and a browsable website. Use it for rendering fidelity suites, visual regression reviews, and side-by-side comparisons of a renderer against one or more references.

Your renderer writes images; fidelity-kit handles the comparisons and viewer. Run the viewer locally while developing, serve the results from a container, or export a static site.

## Used by

- [Material Fidelity](https://material-fidelity.ben3d.ca) — a website using fidelity-kit to compare renderer output.

## Quick start

If you already have a results folder in the format below:

```sh
npx fidelity-kit dev results
```

Open the URL printed by the command (usually <http://localhost:3000>). `dev` processes stale images at startup, then watches for new or changed renders and updates their metrics, deltas, and viewer index. Reload the page to see changes. Files are served without browser caching. See the [working example](https://github.com/bhouston/fidelity-kit/tree/main/examples/demo) for a complete suite.

## Adopt it in your suite

Create a `results` directory with a `fidelity.json` file. Put each scene in its own folder, with one AVIF image per renderer under each output name:

```text
results/
  fidelity.json
  README.md                         optional Markdown preamble above the results
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

Folders can have as many group levels as you need. A scene is any folder containing an image at `<output>/<renderer>.<extension>` for names declared in `fidelity.json`. Supported input extensions are `.avif`, `.webp`, `.png`, and `.jpg`; when several files match a renderer, that order determines which one is used. Formats can be mixed across renderers and outputs. Missing renderer images are allowed; the viewer marks them as missing. Other files, such as scene sources and textures, can live alongside the images.

Start with this configuration:

```json
{
  "title": "My Renderer Comparisons",
  "renderers": [
    { "id": "reference", "label": "Reference", "reference": true },
    { "id": "my-renderer", "label": "My Renderer" }
  ],
  "outputs": [{ "id": "beauty" }, { "id": "ao", "label": "Ambient occlusion" }]
}
```

Mark at least one renderer as a reference. You can declare multiple references; the viewer lets readers choose which one to compare against. Renderer and output IDs must use lowercase letters, numbers, `.`, `_`, or `-`, and start with a letter or number. `outputs` defaults to `beauty` if omitted. Every comparison generates metrics and a delta image. Legacy `delta` settings are ignored.

For searchable scene labels, add a `scene.json` next to a scene's images:

```json
{ "title": "Brushed metal", "tags": ["metal", "roughness"] }
```

### Results preamble

Place an optional `README.md` in the results root beside `fidelity.json`. The viewer renders it below the top navigation and above the results, with Markdown headings, paragraphs, lists, emphasis, code, and links. An empty or missing README hides the introduction. `index.md` is no longer supported; rename existing preambles to `README.md`. Group and scene READMEs are unchanged.

Set `"logo": "branding/logo.svg"` in `fidelity.json` to use the same image as the browser icon and the logo at the top right of the navbar. The path is relative to the results root; AVIF, WebP, PNG, JPG, SVG, and ICO are supported. Local logo files are included in static exports. Omit `logo` to show no custom branding.

PSNR sorting uses the lowest PSNR among the visible compared renderers for the selected output and reference. Hiding renderers immediately changes the ranking. Worst first puts the lowest score first; best first reverses that order. Identical images have infinite PSNR, and scenes without visible comparison metrics appear last.

`dev` and `serve` expose this file, and `build` includes it in the exported site's `data/` directory. No configuration or processing step is needed to add the preamble to an existing results directory. Markdown is static content; renderer lists must be maintained in the file.

## Use it during development

Install the CLI in your suite repository, or use `npx fidelity-kit` for occasional runs:

```sh
pnpm add -D fidelity-kit
pnpm exec fidelity-kit dev results
```

The CLI supports this workflow:

| Command                                  | Use                                                                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fidelity-kit process results`           | Generate comparison metrics, delta images, and the viewer index. Reruns update only stale comparisons; add `--force` to recompute all or `--watch` to keep updating. |
| `fidelity-kit dev results`               | Process stale comparisons, watch new and changed renders, and open a local viewer with caching disabled. Add `--no-watch` to disable watching.                       |
| `fidelity-kit serve results`             | Process stale comparisons, then serve the viewer with browser and CDN caching.                                                                                       |
| `fidelity-kit build results --out site/` | Process stale comparisons and export a site for static hosting.                                                                                                      |

`process` computes only PSNR (in dB) for each available comparison. Processing also removes legacy RMSE, MAE, and maximum-error fields from cached metrics JSON and the viewer index without recomputing valid PSNR values. Heatmaps are encoded as lossy WebP at quality 85 and effort 4 (`<renderer>.vs-<reference>.delta.webp`) to reduce file size; source images keep their original formats, and metrics are computed from the source pixels before heatmap compression. Existing cached heatmaps are retained; run `fidelity-kit process results --force` to regenerate them with this setting. Reference and renderer images in a pair must have the same dimensions. Both `dev` and `serve` start at `localhost:3000` and try higher ports if one is occupied; use `--port` to require a specific port and `--host` to change the bind address. The actual viewer URL is printed at startup. Comparisons run in parallel (default: one per CPU); set `--concurrency <n>` on `process`, `dev`, `serve`, or `build` to change it, or `--concurrency 1` for sequential. To serve results already processed during a build, pass `--no-process`.

Metrics and heatmaps retain independent input modification-time and byte-size signatures. Refreshing either artifact preserves the other when it is current. Heatmap signatures are stored in `.delta.webp.json` cache sidecars, excluded from serving and static export. The first run after upgrading generates WebP heatmaps while retaining current metrics.

Static processing starts comparisons as scenes are discovered. Watch mode retains per-scene dependencies and batches changes through the same concurrency limit. It supports adding/removing scenes and reference or renderer images, and editing scene metadata. Renderer IDs, output/pass IDs, and other `fidelity.json` settings remain fixed until restart; the watcher reports configuration changes that require a restart. Generated metrics, delta images, the index, and temporary files are ignored, so processing cannot trigger a watch loop.

`process`, `dev`, and `hash` show scanning and processing progress on one updating terminal line, including the remaining count and an approximate ETA. Use `--quiet` to suppress progress and summary output; errors are still reported.

Freshness uses each input image's modification time and byte size, recorded in its metrics file after a successful comparison. Replacing an image with an older-dated file is detected. Files whose timestamp and size both remain unchanged are assumed unchanged; use `--force` to bypass that cache. Existing metrics without input signatures are regenerated once. Removed comparisons disappear from the index; their generated files may remain on disk and are validated before any later reuse.

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
[docs-badge]: https://img.shields.io/badge/Docs-Read-2b77aa
[docs-url]: https://fidelity-kit.ben3d.ca/
