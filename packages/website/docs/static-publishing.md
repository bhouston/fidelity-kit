---
title: Publish a static viewer
---

`fidelity-kit build` processes the suite and exports a self-contained viewer. It includes the viewer assets, source images, metadata, metrics, deltas, and optional logo and READMEs. No Node server is needed at the destination.

```sh
pnpm exec fidelity-kit build results --out site/
```

Upload the contents of `site/` to any static host. Serve it from a domain root or a subdirectory; the viewer uses relative asset URLs and hash-based scene links, so deep links do not require a server rewrite. Do not point `--out` at your `results/` directory.

## Publish the viewer with GitHub Pages

In your suite's repository, add a workflow like this. Install the package and render the `results/` images before the build step if your repository does not store them.

**Check the exported size before choosing Pages.** [GitHub limits published Pages sites to 1 GB](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). Large fidelity suites can easily exceed that once source renders and generated deltas are included. Run `du -sh site/` after building (or in CI) to estimate the uncompressed site size. If it approaches 1 GB, use a static host with a higher limit or serve the suite from [Docker](./docker.md).

```yaml
name: Publish fidelity viewer
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 26
      - run: npm install -g fidelity-kit
      - run: fidelity-kit build results --out site/
      - run: du -sh site/
      - uses: actions/upload-pages-artifact@v4
        with:
          path: site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

In the repository's **Settings → Pages**, choose **GitHub Actions** as the build and deployment source. For a custom domain, set that domain in Pages settings and create a DNS CNAME pointing the domain to your GitHub Pages host. GitHub's [custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages) covers verification and HTTPS.

The [fidelity-kit documentation site](https://fidelity-kit.ben3d.ca) has its own Pages workflow. Its DNS and Pages settings are separate from the static viewer of any suite built with fidelity-kit.
