# fidelity-kit documentation site

The Docusaurus site is published at `https://fidelity-kit.ben3d.ca/`.

```sh
pnpm docs:dev
pnpm docs:build
```

Both commands build the CLI and run `fidelity-kit docgen --format json` through `scripts/generate-docs.mjs`. The `@clidoc/docusaurus` plugin turns the generated OpenCLI JSON into `docs/cli/`. Edit command definitions in `packages/cli/src/commands`, not the generated files.

On a merge to `main`, `.github/workflows/pages.yml` builds and deploys `packages/website/build` through GitHub Actions. In repository **Settings → Pages**, select **GitHub Actions** and set `fidelity-kit.ben3d.ca` as the custom domain. Create a DNS CNAME for `fidelity-kit.ben3d.ca` pointing to `bhouston.github.io`; enable HTTPS after GitHub issues a certificate. Docusaurus copies `static/CNAME` into the built artifact. The default `baseUrl` is `/`; `SITE_URL` and `BASE_URL` can override the deployment URL for another host.
