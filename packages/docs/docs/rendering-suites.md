---
title: Rendering suites
description: Capture renders and benchmarks from a rendering registry, group renderers and scenes for selection, and keep benchmark history.
---

A single `fidelity-kit` package provides fidelity image processing, performance benchmarks, browser reporting and one unified viewer. `fidelity-kit/registry` validates the renderer and scene registry. `fidelity-kit/browser/host` mounts a project-provided session factory for captures, benchmarks and live interaction. `fidelity-kit/runner` exposes performance orchestration and processing without changing historical result formats.

```sh
fidelity-kit render --registry registry.json --root-url http://127.0.0.1:5173/ --out fidelity-results
fidelity-kit benchmark --registry registry.json --collection default --machine workstation --out performance-results
fidelity-kit dev fidelity-results --registry registry.json --performance-root performance-results
fidelity-kit build fidelity-results --registry registry.json --performance-root performance-results --out site
```

Configure `renderServer.developmentUrl`, `renderServer.deployedUrl` and `entry`. The root URL can be overridden for any environment. A static site may embed a render server hosted on another origin; messages are checked against that origin, the iframe source and a fresh session token. A deployed endpoint is required for static builds. The home page shows the results README, the configured fidelity hero and the three section links. Live mode fixes the canvas at 1920 × 1080, publishes local telemetry without recording results, and requires Start Benchmark to apply selection changes.

External renderers use an argv command producer with `{job}` (JSON job) and `{output}` (absolute artifact path) substitutions. Browser renderers are the canonical path for fidelity, performance and live parity; native diagnostic backends can remain project tools. Performance collections explicitly opt in renderer and scene pairs. References remain machine independent; performance and convergence measurements keep the machine dimension.

For animated comparisons see [Temporal fidelity](./dynamic-fidelity.md).

## Capture a rendering registry

Start the configured browser render server separately, then capture images:

```sh
fidelity-kit render --registry registry.json --out results
fidelity-kit render --registry registry.json --out results --missing-only
fidelity-kit render --registry registry.json --out results --renderers "gpu-*" --scenes "box-*"
fidelity-kit render --registry registry.json --out results --missing-only --renderers "gpu-*,native" --scenes "box-*"
```

All three filters are optional and combine to restrict the renderer and scene pairs. `--renderers` and `--scenes` match registry IDs using quoted globs; comma-separated patterns select their union in registry order. Every pattern must match at least one ID. The singular `--renderer` and `--scene` options still select exact IDs and intersect with the glob filters. By default, rendering selects all scenes and enabled renderers; an explicit renderer selection can include disabled renderers.

`--missing-only` preserves existing `<scene.path or scene.id>/beauty/<renderer.id>.avif` outputs for browser and external renderers. It checks for existence, not freshness or image validity. When every selected output exists, no browser or external render job starts. Omit it to regenerate selected images.

Configure still-image cases with `scenes[].staticFidelity` and animated cases with `scenes[].temporalFidelity`; either can be `false` to opt a scene out of that section.

## Benchmarks

Automated throughput benchmarks disable vsync and frame-rate limits, warm up for one second, then count GPU-completed frames over the configured sustained window. Bounded batches include the full render pipeline and drain GPU work before publication and teardown. Individual frame timings are kept only when reading historical results; new throughput runs do not collect them. Live UI telemetry stays interactive and unpersisted.

### Benchmark history

Each `fidelity-kit benchmark` invocation reserves a unique UTC date-time session under `performance-results/<machine>/<YYYY-MM-DD-HH-MM>/<renderer>/<scene>/`. The timestamp is the UTC start time with minute precision, and all workloads share the session. When dated runs already exist, the CLI asks whether to create a new run or add to the latest one. Use `--new-run` or `--session latest` (or `--session YYYY-MM-DD-HH-MM`) to skip the prompt; these options are required when restarting without an interactive terminal. Adding to a run keeps its original timestamp, adds missing workloads and replaces only workloads measured again. Two new runs cannot share the same machine and start minute; resume that run or wait until the next minute. Earlier sessions keep their metrics and screenshots, and `machine.json` stays directly inside the machine folder.

In the Performance viewer, choose a machine and then a **Benchmark date-times** value. **Latest** follows the newest session; selecting a specific date-time pins that session, including in shareable detail URLs (`session=<session-id>`). Changing machines defaults to the newest session for that machine. Timestamps display in UTC. Older undated folders remain readable and appear as **Undated**. Processing and static exports include all sessions.

Low-level `writeRun` and `processResult` callers can pass the session as the final argument; omitting it keeps the legacy undated layout.

### Benchmark filters

`benchmark --renderer 'three-*' --scene 'model-*-w'` matches workload IDs with the same glob matcher as `render`. Filters accept exact IDs, `*`, `?`, character classes, brace alternatives, comma-separated patterns and repeated options. Renderer and scene filters intersect; matching workloads run once in collection order (or seeded order). Unmatched patterns fail before Chrome launches and list the available IDs in the collection.

The plural aliases `--renderers` and `--scenes` accept comma-separated globs, as in `render`; combined with the singular options, their selections intersect. Filters select workloads already defined in the performance collection; they do not generate new renderer and scene combinations.

## Grouped selections

Set an optional `category` on renderers in `fidelity.json` or the unified registry. The renderer menu supports search, scrolling, collapsible groups and all, none or partial group selection. Define `comparisonPresets` as `{ id, name, renderers, ref? }` entries to offer named comparisons; the chosen renderer IDs and reference stay in the URL.

Scenes can carry a `category` and `tags` in the registry or `scene.json`. Fidelity filters scene families with union semantics, while selected tags must all match. Live and performance selects use the same categories. These fields are optional; existing suites keep their defaults.

Run `node scripts/selection-browser.mjs` in a checkout of the repository after building to verify selector behavior in Chrome. Set `CHROME_EXECUTABLE` when using an installed browser.
