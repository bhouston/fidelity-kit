import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
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
      <main className={styles.cards}>
        {steps.map((step, index) => (
          <Link className={styles.card} to={step.link} key={step.title}>
            <span>0{index + 1}</span>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
            <strong>Read the guide →</strong>
          </Link>
        ))}
      </main>
    </Layout>
  );
}
