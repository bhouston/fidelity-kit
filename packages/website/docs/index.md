---
id: index
title: Get started
slug: /
---

fidelity-kit compares images from your renderer with one or more reference renderers. It creates PSNR metrics and visual difference images, then serves a viewer for the results. Your project only needs to write images into a [suite directory](./suite-format.md).

## Open your suite locally

With Node.js 22 or newer, run this command from a project containing a `results/` directory. You can use the [working example suite](https://github.com/bhouston/fidelity-kit/tree/main/examples/demo) as a model for that directory.

```sh
npx fidelity-kit dev results
```

Open the URL printed by the CLI, usually `http://localhost:3000`. `dev` processes stale comparisons and watches for changes. Refresh the browser after changing an image.

## Add fidelity-kit to your project

```sh
pnpm add -D fidelity-kit
pnpm exec fidelity-kit dev results
```

The `results/` directory holds `fidelity.json`, scene images, and optional Markdown descriptions. Start with the [suite format](./suite-format.md), then choose [Docker serving](./docker.md) or [static publishing](./static-publishing.md) when you are ready to share the viewer. The [CLI reference](/docs/cli) is generated from the command definitions at build time.
