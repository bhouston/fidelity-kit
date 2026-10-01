const clidocPlugin = require('@clidoc/docusaurus');

module.exports = {
  title: 'fidelity-kit',
  tagline: 'Compare renderer output without building a comparison site.',
  url: process.env.SITE_URL ?? 'https://fidelity-kit.ben3d.ca',
  baseUrl: process.env.BASE_URL ?? '/',
  organizationName: 'bhouston',
  projectName: 'fidelity-kit',
  onBrokenLinks: 'throw',
  markdown: { format: 'md' },
  presets: [
    [
      'classic',
      {
        docs: { routeBasePath: 'docs', sidebarPath: './sidebars.js' },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      },
    ],
  ],
  plugins: [[clidocPlugin, { input: '.generated/fidelity-kit.json', outputDir: 'docs/cli', basePath: '/cli' }]],
  themeConfig: {
    navbar: {
      title: 'fidelity-kit',
      items: [
        { to: '/docs', label: 'Get started', position: 'left' },
        { to: '/docs/suite-format', label: 'Suite format', position: 'left' },
        { to: '/docs/cli', label: 'CLI', position: 'left' },
        { href: 'https://github.com/bhouston/fidelity-kit', label: 'GitHub', position: 'right' },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Get started', to: '/docs' },
            { label: 'CLI reference', to: '/docs/cli' },
          ],
        },
        {
          title: 'Project',
          items: [
            { label: 'GitHub', href: 'https://github.com/bhouston/fidelity-kit' },
            { label: 'npm', href: 'https://www.npmjs.com/package/fidelity-kit' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} fidelity-kit · MIT · Created by <a href="https://ben3d.ca">Ben Houston</a> · Sponsored by <a href="https://landofassets.com">Land of Assets</a>`,
    },
  },
};
