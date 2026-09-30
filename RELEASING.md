# Releases

## Running a release

Releases are never triggered by pushes or merges to `main`. When ready to publish, the maintainer dispatches the workflow:

```sh
gh workflow run release.yml --ref main
```

Add `-f dry_run=true` to preview versioning and release notes without publishing or tagging. The workflow refuses to run against any ref other than `main`, waits for the full CI suite, and fails if `main` advances after dispatch. If there are no release-worthy commits since the last tag, the run succeeds as a no-op.

## One-time activation

1. **First publish (manual).** npm trusted publishing can only be configured on a package that already exists, so the first version is published by hand with 2FA:

   ```sh
   pnpm install --frozen-lockfile && pnpm build
   cd packages/cli
   pnpm pack --dry-run   # expect dist/ and viewer/
   pnpm publish --access public
   ```

2. **Baseline tag.** Give semantic-release a version floor. Never move this tag afterwards.

   ```sh
   git tag v0.1.0 <commit-that-was-published>
   git push origin v0.1.0
   ```

3. **Trusted publisher.** On npmjs.com, open `fidelity-kit` → Settings → Trusted Publisher → GitHub Actions:

   | Field                | Value          |
   | -------------------- | -------------- |
   | Organization or user | `bhouston`     |
   | Repository           | `fidelity-kit` |
   | Workflow filename    | `release.yml`  |
   | Environment name     | Leave blank    |

   These are package settings, not repository secrets; no `NPM_TOKEN` is needed. The release job publishes with `pnpm` and `id-token: write`, and npm attaches provenance automatically.

## Versioning and artifacts

Semantic-release analyzes Conventional Commits since the last `v*` tag: `feat` is a minor, `fix`/`perf` a patch, `!` or `BREAKING CHANGE:` a major. Docs/chore-only changes produce no release.

Only `packages/cli` (`fidelity-kit`) is published, via `pnpm publish` through `@anolilab/semantic-release-pnpm`. Source `package.json` versions are development snapshots; the Git tag and npm version are authoritative. Nothing is committed back to `main` and no `CHANGELOG.md` is written; [GitHub Releases](https://github.com/bhouston/fidelity-kit/releases) holds the notes and the package tarball.

## Validation

`pnpm release:check` tests commit analysis and publish readiness. Dispatch with `dry_run=true` for a full preview.
