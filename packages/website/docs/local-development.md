---
title: Local development
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
