---
title: Dynamic fidelity
---

Static fidelity scores one image per renderer. Temporal techniques such as TAA, temporal upscaling, temporal denoisers and animated sampling noise cannot be judged from one frame. Their errors are blur under motion, ghosting, flicker and slow convergence, so **dynamic fidelity** scores an animated sequence instead.

## Registry

Dynamic fidelity uses the [rendering registry](./suite-format.md) and the same browser session factory as `render`, `benchmark` and live mode. Three additions opt in:

```json
{
  "renderers": [
    {
      "id": "reference",
      "name": "4×4 supersampled",
      "reference": true,
      "params": { "aa": "none" },
      "supersample": { "factor": 4, "filter": "lanczos3" }
    },
    { "id": "taa", "name": "TAA", "params": { "aa": "taa" } }
  ],
  "scenes": [
    {
      "id": "spinning-fan",
      "name": "Spinning fan",
      "dynamic": { "width": 640, "height": 360, "frames": 150, "warmup": 30, "fps": 60, "params": { "camera": "pan" } }
    }
  ],
  "dynamic": { "reference": "reference", "output": "motion" }
}
```

- **`renderers[].supersample`** renders at `factor ×` the requested width and height and downsamples the capture in linear light. The filter is `lanczos3` (default) or `box`. Any renderer becomes a reference this way, for example a renderer without anti-aliasing at 4 × 4 samples per pixel. `render` honours it for static captures as well.
- **`scenes[].dynamic`** opts a scene in. It sets the sequence size, the total frame count, the unscored `warmup` frames that let temporal history settle, and the time step `1 / fps`. Optional `params` are passed to the session, for example camera motion. Optional `renderers` limits the compared renderers for this scene, for example a denoiser that only applies to scenes with ambient occlusion.
- **`dynamic`** names the reference renderer and the output folder of the representative frames. `renderers` optionally limits the compared renderers; the default is every enabled, non-reference browser renderer. `representativeFrame` picks the saved frame (default: the last measured one).

## Session contract

In `dynamic` mode the host calls `draw(1 / fps)` once per frame and reads back every frame after `warmup`. A session must therefore advance its animation by the given time step, not by wall-clock time, so that the reference and every renderer see the same scene state on each frame. Each sequence renders in a fresh page.

## Capture

```sh
fidelity-kit dynamic --registry registry.json --out fidelity-results
fidelity-kit dynamic --registry registry.json --out fidelity-results --scenes "spin*" --renderers "taa*"
```

For each scene, the reference sequence is rendered first and every compared renderer is scored frame by frame on the raw captured pixels:

| Metric             | Meaning                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sequence PSNR (dB) | Error of every measured frame against the reference: blur, ghosting and aliasing all lower it.                                                                                                                                                   |
| Temporal PSNR (dB) | Error of the frame-to-frame change, `(O[t] − O[t−1]) − (R[t] − R[t−1])`. It isolates flicker, shimmering and lag from a constant spatial error.                                                                                                  |
| Sharpness          | Gradient energy of the frames relative to the reference. Below 1 is blurrier, above 1 has extra edges (aliasing or noise). Compare it across renderers against the same reference: a Lanczos reference has some ringing, which adds edge energy. |

Results are written into the normal results tree:

```text
fidelity-results/
  dynamic.json                      summaries of every dynamic comparison
  spinning-fan/
    motion/
      reference.avif                representative frame
      taa.avif
      taa.temporal.json             summary and per-frame curves
```

The representative frames are ordinary result images, so `process` compares them like any other output. `fidelity.json` declares the output automatically. The viewer adds a **Dynamic** page with a scene × renderer table (sequence PSNR, temporal PSNR and sharpness, with means per renderer). Scene detail pages show the sequence metrics and a per-frame chart for the dynamic output. `build` exports `dynamic.json` and the sidecars.

Static comparisons also report sharpness next to PSNR.
