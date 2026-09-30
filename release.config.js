import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Only packages/cli (`fidelity-kit`) is published; the viewer is private and
// bundled into it by the package's `prepack` script.
const pkgRoot = 'packages/cli';

export default {
  branches: ['main'],
  repositoryUrl: 'https://github.com/bhouston/fidelity-kit.git',
  tagFormat: 'v${version}',
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    // pkgRoot only (no tarballDir): @anolilab/semantic-release-pnpm's tarballDir option
    // shells out to `pnpm pack <pkgRoot>`, which pnpm packs from the cwd instead — pack
    // explicitly below, once the package has its final bumped version.
    ['@anolilab/semantic-release-pnpm', { pkgRoot }],
    {
      prepare: () => {
        // Absolute destination: `pnpm --dir` changes pnpm's cwd, so a relative destination
        // would land inside the package instead of the repo-root `release-artifacts`
        // that @semantic-release/github globs for its release assets.
        execFileSync('pnpm', ['--dir', pkgRoot, 'pack', '--pack-destination', resolve('release-artifacts')], {
          stdio: 'inherit',
        });
      },
    },
    [
      '@semantic-release/github',
      {
        assets: ['release-artifacts/*.tgz'],
        successComment: false,
        failComment: false,
        releasedLabels: false,
      },
    ],
  ],
};
