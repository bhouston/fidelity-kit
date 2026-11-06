# fidelity-kit documentation site

The Docusaurus site is published at `https://fidelity-kit.ben3d.ca/`.

```sh
pnpm docs:dev
pnpm docs:build
```

Both commands build the CLI and run `fidelity-kit docgen --format json` through `scripts/generate-docs.mjs`. The `@clidoc/docusaurus` plugin turns the generated OpenCLI JSON into `docs/cli/`. Edit command definitions in `packages/cli/src/commands`, not the generated files.

After each release, the Release workflow calls `.github/workflows/pages.yml`, which builds the release tag and deploys `packages/docs/build` through GitHub Actions. Merging to `main` does not deploy. Run `gh workflow run pages.yml --ref main` to redeploy the latest release. In repository **Settings → Pages**, select **GitHub Actions** and set `fidelity-kit.ben3d.ca` as the custom domain, with a DNS CNAME pointing to `bhouston.github.io`. Docusaurus copies `static/CNAME` into the built artifact. The default `baseUrl` is `/`; `SITE_URL` and `BASE_URL` can override the deployment URL for another host.
