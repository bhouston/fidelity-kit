import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './index.module.css';

const steps = [
  {
    title: 'Bring your renders',
    body: 'Organize reference and renderer images by scene and output.',
    link: '/docs/suite-format',
  },
  {
    title: 'Compare locally',
    body: 'Generate PSNR metrics and visual deltas as images change.',
    link: '/docs/local-development',
  },
  {
    title: 'Share the results',
    body: 'Export a static viewer or serve it from a container.',
    link: '/docs/static-publishing',
  },
];

export default function Home() {
  const previewImage = useBaseUrl('/img/material-fidelity-preview.webp');

  return (
    <Layout
      title="Renderer comparisons"
      description="Turn renderer output into metrics, visual deltas, and a browsable site."
    >
      <header className={styles.hero}>
        <div className={styles.inner}>
          <p className={styles.eyebrow}>RENDERER FIDELITY TOOLKIT</p>
          <h1>
            See the difference
            <br />
            <em>in every render.</em>
          </h1>
          <p className={styles.lead}>
            fidelity-kit turns a folder of renders into image quality metrics, visual difference images, and a browsable
            comparison site.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} to="/docs">
              Get started →
            </Link>
            <Link className={styles.secondary} to="/docs/cli">
              Explore the CLI →
            </Link>
          </div>
          <pre className={styles.command}>
            <code>npx fidelity-kit dev results</code>
          </pre>
        </div>
      </header>
      <main>
        <section className={styles.preview} aria-labelledby="preview-heading">
          <div className={styles.previewInner}>
            <div className={styles.previewCopy}>
              <p className={styles.eyebrow}>SEE IT IN ACTION</p>
              <h2 id="preview-heading">Explore a real comparison site</h2>
              <p>
                Material Fidelity uses fidelity-kit to show renderer output side by side, with visual deltas and quality
                metrics for each scene.
              </p>
              <a className={styles.previewLink} href="https://material-fidelity.ben3d.ca">
                Explore Material Fidelity →
              </a>
            </div>
            <a
              className={styles.previewImageLink}
              href="https://material-fidelity.ben3d.ca"
              aria-label="Explore the Material Fidelity comparison site"
            >
              <img
                src={previewImage}
                alt="Material Fidelity comparison site showing renderer images, visual deltas, and PSNR metrics for two scenes"
                width="1844"
                height="2104"
                loading="lazy"
              />
            </a>
          </div>
        </section>
        <div className={styles.cards}>
          {steps.map((step, index) => (
            <Link className={styles.card} to={step.link} key={step.title}>
              <span>0{index + 1}</span>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
              <strong>Read the guide →</strong>
            </Link>
          ))}
        </div>
      </main>
    </Layout>
  );
}
