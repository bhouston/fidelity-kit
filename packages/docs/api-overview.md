# API reference

The `fidelity-kit` package exposes the same code the CLI uses, so you can scan a results suite, compute comparisons and read the generated files from your own tooling. For commands and their options, see the [CLI reference](/docs/cli).

```ts
import { processSuite } from 'fidelity-kit';
import { scanSuite, allScenes } from 'fidelity-kit/scan';

await processSuite('results');
const suite = await scanSuite('results');
for (const scene of allScenes(suite.root)) console.log(scene.path);
```

`fidelity-kit` also re-exports everything from `fidelity-kit/paths` and `fidelity-kit/scan`. Use the subpaths when you only need file naming or suite scanning.

## Entry points

- [`fidelity-kit`](/docs/api/fidelity-kit/): processing, comparison, hashing, serving helpers and validation.
- [`fidelity-kit/paths`](/docs/api/fidelity-kit/paths/): file naming helpers shared by the CLI and the viewer.
- [`fidelity-kit/scan`](/docs/api/fidelity-kit/scan/): scan a results folder into groups and scenes.
