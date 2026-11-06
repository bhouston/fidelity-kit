const clidocPlugin = require('@clidoc/docusaurus');
const url = process.env.SITE_URL ?? 'https://fidelity-kit.ben3d.ca';
const baseUrl = process.env.BASE_URL ?? '/';
const description =
  'Turn a folder of renders into PSNR metrics, visual deltas and a browsable comparison viewer with an open-source TypeScript CLI.';

const link = (attributes) => ({ tagName: 'link', attributes });
// Raw head tags: `themeConfig.metadata` goes through Helmet, which keeps one tag per name and would drop a theme-color.
const themeColor = (content, scheme) => ({
  tagName: 'meta',
  attributes: { name: 'theme-color', content, media: `(prefers-color-scheme: ${scheme})` },
});

module.exports = {
  title: 'fidelity-kit',
  tagline: 'Compare renderer output without building a comparison site.',
  url,
  baseUrl,
  favicon: 'img/logo.svg',
  headTags: [
    link({ rel: 'icon', type: 'image/png', sizes: '32x32', href: `${baseUrl}img/favicon-32x32.png` }),
    link({ rel: 'apple-touch-icon', sizes: '180x180', href: `${baseUrl}img/apple-touch-icon.png` }),
    link({ rel: 'manifest', href: `${baseUrl}site.webmanifest` }),
    themeColor('#ffffff', 'light'),
    themeColor('#11151d', 'dark'),
    {
      tagName: 'script',
      attributes: { type: 'application/ld+json' },
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'fidelity-kit',
        url: new URL(baseUrl, url).href,
        description,
      }),
    },
  ],
  organizationName: 'bhouston',
  projectName: 'fidelity-kit',
  trailingSlash: true,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: { format: 'detect' },
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: 'docs',
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/bhouston/fidelity-kit/tree/main/packages/docs/',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
        gtag: { trackingID: 'G-J7J6FSLWG4', anonymizeIP: true },
      },
    ],
  ],
  plugins: [[clidocPlugin, { input: '.generated/fidelity-kit.json', outputDir: 'docs/cli', basePath: '/cli' }]],
  themeConfig: {
    image: 'img/social-card.png',
    metadata: [
      { property: 'og:site_name', content: 'fidelity-kit' },
      { name: 'twitter:site', content: '@BenHouston3D' },
    ],
    colorMode: { defaultMode: 'light', disableSwitch: true, respectPrefersColorScheme: true },
    navbar: {
      title: 'fidelity-kit',
      logo: { alt: 'fidelity-kit', src: 'img/logo.svg' },
      items: [
        { to: '/docs', label: 'Get started', position: 'left' },
        { to: '/docs/suite-format', label: 'Suite format', position: 'left' },
        { to: '/docs/cli', label: 'CLI', position: 'left' },
        { to: '/docs/api', label: 'API reference', position: 'left' },
        {
          href: 'https://github.com/bhouston/fidelity-kit',
          html: '<span class="navbar-github-icon" aria-hidden="true"></span>',
          'aria-label': 'GitHub repository',
          title: 'GitHub repository',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Learn',
          items: [
            { label: 'Get started', to: '/docs' },
            { label: 'Suite format', to: '/docs/suite-format' },
            { label: 'Temporal fidelity', to: '/docs/dynamic-fidelity' },
          ],
        },
        {
          title: 'Build',
          items: [
            { label: 'CLI reference', to: '/docs/cli' },
            { label: 'API reference', to: '/docs/api' },
            { label: 'Publish a static viewer', to: '/docs/static-publishing' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: 'https://github.com/bhouston/fidelity-kit' },
            { label: 'npm', href: 'https://www.npmjs.com/package/fidelity-kit' },
            { label: 'Report an issue', href: 'https://github.com/bhouston/fidelity-kit/issues' },
            { label: 'Discord', href: 'https://discord.gg/fwupDN493R' },
          ],
        },
      ],
      copyright:
        'Made with ❤️ by <a href="https://ben3d.ca">Ben Houston</a>. Sponsored by <a href="https://landofassets.com">Land of Assets</a>',
    },
  },
};
