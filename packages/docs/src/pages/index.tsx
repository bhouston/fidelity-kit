import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';

const workflow = [
  ['Render', 'Write images into a results folder'],
  ['Compare', 'PSNR and a delta image per renderer'],
  ['Review', 'Side-by-side viewer with live reload'],
  ['Publish', 'Static site or Docker container'],
];

const cards = [
  {
    label: 'Folder contract',
    title: 'Suite format',
    href: '/docs/suite-format',
    body: 'Lay out scenes, outputs and renderers, and describe them in fidelity.json.',
    code: 'results/fidelity.json',
  },
  {
    label: 'Command line',
    title: 'CLI reference',
    href: '/docs/cli',
    body: 'process, dev, serve and build, with every option generated from the command definitions.',
    code: 'npx fidelity-kit dev results',
  },
  {
    label: 'TypeScript',
    title: 'API reference',
    href: '/docs/api',
    body: 'Scan suites, compute comparisons and build file paths from your own code.',
    code: 'import { scanSuite } from "fidelity-kit/scan"',
  },
  {
    label: 'Sharing',
    title: 'Publish a viewer',
    href: '/docs/static-publishing',
    body: 'Export a self-contained site for any static host, or serve a processed suite from Docker.',
    code: 'fidelity-kit build results --out site/',
  },
];

export default function Home() {
  const preview = useBaseUrl('/img/material-fidelity-preview.webp');
  return (
    <Layout
      title="Renderer comparisons without a comparison site"
      description="Turn a folder of renders into PSNR metrics, visual deltas and a browsable comparison viewer with an open-source TypeScript CLI."
    >
      <header className="home-hero container">
        <div>
          <p className="eyebrow">Renderer fidelity · TypeScript · Open source</p>
          <h1>
            Know when your renderer drifts.
            <br />
            <em>See exactly where.</em>
          </h1>
          <p className="hero-description">
            Your renderer writes images to a folder. fidelity-kit measures each one against your references, draws the
            difference, and serves a viewer to browse the results.
          </p>
          <div className="hero-actions">
            <Link className="button button--primary button--lg" to="/docs">
              Get started <span aria-hidden>→</span>
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/cli">
              Explore the CLI
            </Link>
          </div>
        </div>
        <figure className="hero-preview">
          <img
            src={preview}
            alt="Material Fidelity comparison site showing renderer images, visual deltas, and PSNR metrics for two scenes"
            width="1844"
            height="2104"
          />
        </figure>
      </header>
      <main>
        <section className="workflow-band" aria-label="Fidelity workflow">
          <div className="container workflow-steps">
            {workflow.map(([title, detail], index) => (
              <div key={title}>
                <span className="workflow-number">0{index + 1}</span>
                <strong>{title}</strong>
                <p>{detail}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="container story-section" aria-labelledby="review-title">
          <div>
            <p className="eyebrow">Skip the custom tooling</p>
            <h2 id="review-title">
              Review differences,
              <br />
              not folders.
            </h2>
            <p>
              Every renderer is compared with a reference, with a PSNR score and a heatmap of where the images differ.
              Sort scenes by worst score to find regressions first.
            </p>
            <ul className="feature-list">
              <li>Declare several references and choose which one to compare against.</li>
              <li>Missing renders are marked, not fatal, so partial runs still work.</li>
              <li>Reruns recompute only the comparisons whose images changed.</li>
            </ul>
            <div className="story-links">
              <Link className="button button--primary" to="/docs/suite-format">
                Set up a suite
              </Link>
              <a href="https://material-fidelity.ben3d.ca">Explore a live site →</a>
            </div>
          </div>
          <pre className="home-code">
            <code>{`# While you develop: process, watch and view
npx fidelity-kit dev results

# In CI: process and export a static site
npx fidelity-kit build results --out site/`}</code>
          </pre>
        </section>
        <section className="workflow-band">
          <div className="container story-section">
            <div>
              <p className="eyebrow">Beyond still frames</p>
              <h2>
                Judge motion
                <br />
                and speed too.
              </h2>
              <p>
                Temporal techniques such as TAA, upscaling and denoisers cannot be judged from one frame. Temporal
                fidelity scores an animated sequence for ghosting, flicker and slow convergence, and benchmarks track
                performance next to quality.
              </p>
              <Link to="/docs/dynamic-fidelity">Read about temporal fidelity →</Link>
            </div>
            <pre className="home-code">
              <code>{`{
  "id": "spinning-fan",
  "temporalFidelity": {
    "width": 640,
    "height": 360,
    "frames": 150,
    "warmup": 30,
    "fps": 60
  }
}`}</code>
            </pre>
          </div>
        </section>
        <section className="container package-section" aria-labelledby="guides-title">
          <div className="section-heading">
            <p className="eyebrow">Go deeper</p>
            <h2 id="guides-title">Use the part you need.</h2>
            <p>Start from the folder format, drive it from the CLI, or call the same code from TypeScript.</p>
          </div>
          <div className="package-grid">
            {cards.map((card) => (
              <article key={card.title} className="package-card">
                <p className="package-label">{card.label}</p>
                <h3>{card.title}</h3>
                <p>{card.body}</p>
                <pre>
                  <code>{card.code}</code>
                </pre>
                <Link to={card.href}>Read more →</Link>
              </article>
            ))}
          </div>
        </section>
        <section className="container home-callout">
          <div>
            <p className="eyebrow">Try it on your renders</p>
            <h2>From a folder of images to a comparison site.</h2>
            <pre>
              <code>pnpm add -D fidelity-kit</code>
            </pre>
          </div>
          <div className="hero-actions">
            <Link className="button button--primary button--lg" to="/docs">
              Read the guide
            </Link>
            <Link className="button button--secondary button--lg" to="https://github.com/bhouston/fidelity-kit">
              View on GitHub
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
