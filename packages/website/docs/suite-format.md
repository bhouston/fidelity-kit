---
title: Suite format
---

Create one directory for the suite and put `fidelity.json` at its root. A scene can be nested under any number of group directories. Each image goes in `<scene>/<output>/<renderer>.<extension>`.

```text
results/
  fidelity.json
  README.md                         optional suite introduction
  materials/
    brushed-metal/
      README.md                     optional scene description
      scene.json                    optional scene title and tags
      beauty/
        reference.avif
        my-renderer.png
      ao/
        reference.webp
        my-renderer.webp
```

The renderer and output names must match IDs in `fidelity.json`. Supported source extensions are `.avif`, `.webp`, `.png`, and `.jpg`. If more than one exists for the same renderer, fidelity-kit selects the first in that order. Formats can differ between renderers and outputs. A missing renderer image is shown as missing in the viewer. Both images in a comparison must have the same dimensions.

## Configure renderers and outputs

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

Add `"$schema": "https://unpkg.com/fidelity-kit/schemas/fidelity.schema.json"` to get validation and completion in editors such as VS Code. The same JSON Schemas ship in the npm package (`node_modules/fidelity-kit/schemas/fidelity.schema.json` and `scene.schema.json`, also importable as `fidelity-kit/schemas/*`), and the CLI validates with them, so other tools can check suites against exactly the same rules. Invalid files stop processing with every problem listed; unknown properties are ignored with a warning so typos are visible.

`title` and `renderers` are required. At least one renderer needs `"reference": true`; multiple references are supported. Renderer and output IDs must be unique, start with a lowercase letter or digit, and then contain only lowercase letters, digits, `.`, `_`, or `-`. `label` is optional and defaults to the ID. Renderers can also have an optional `category` string, and `"enabled": false` to hide a renderer by default (viewers can still turn it on in the Renderers menu). If `outputs` is omitted, it defaults to one output named `beauty`.

## Add scene metadata and descriptions

Put a `scene.json` beside the output directories to provide a searchable title and tags. It also makes a scene visible when none of its images exist yet.

```json
{ "title": "Brushed metal", "tags": ["metal", "roughness"] }
```

Add `README.md` at the suite root for an introduction above the results. Group and scene `README.md` files describe those parts of the suite. The viewer supports Markdown headings, paragraphs, lists, emphasis, code, and links. The older root `index.md` preamble is not supported.

To brand the viewer, add an image under the suite root and set `"logo": "branding/logo.svg"` in `fidelity.json`. The logo path is relative to the suite root. AVIF, WebP, PNG, JPG, SVG, and ICO are supported for logos.

Other scene files, including sources and textures, can live next to the images. The static export includes only files the viewer needs.

## Check what is ignored

`process`, `dev`, `serve`, and `build` warn about content that looks like part of the suite but is ignored: images named after a renderer outside a declared output folder, images in output folders whose name is not a renderer ID (with a hint for case mismatches), unsupported formats such as `.jpeg` or `.exr`, lower-priority formats shadowed by another file for the same renderer, output folders at the results root, scenes nested inside other scenes, and unknown `fidelity.json` or `scene.json` properties. Repeated warnings are grouped by message. Textures and other files outside output folders are reported only when they are named after a renderer. `--quiet` suppresses warnings.

## Generated files

`process`, `dev`, `serve`, and `build` create `index.json`, PSNR metrics files, and WebP delta images. Keep your renderer's source images as inputs. Reruns update stale comparisons; use `--force` with `process` to recompute all pairs. The source images are measured before delta compression. Generated cache sidecars are kept out of the static export.
