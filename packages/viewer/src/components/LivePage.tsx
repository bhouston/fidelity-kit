// oxlint-disable react/iframe-missing-sandbox -- Trusted renderers need scripts and their real origin for GPU access and checked telemetry.
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { rendererParams } from 'fidelity-kit/registry';
import type { FrameMetric, SetupMetric } from 'fidelity-kit/browser/telemetry';
import { FrameChart, SetupChart } from 'fidelity-kit/charts';
import { Button } from './ui/button';
import { renderUrl, resolveView } from '#/lib/view';
import './live.css';

const rootRoute = getRouteApi('__root__');
const indexRoute = getRouteApi('/');
export function LivePage() {
  const { site, index, scenes, hashes } = rootRoute.useLoaderData();
  const search = indexRoute.useSearch();
  const navigate = useNavigate({ from: '/' });
  const renderers = site?.registry.renderers.filter((r) => r.kind === 'browser') ?? [];
  const [renderer, setRenderer] = useState(
    renderers.find((r) => r.id === search.renderer || r.legacyIds.includes(search.renderer ?? ''))?.id ??
      renderers[0]?.id ??
      '',
  );
  const [scene, setScene] = useState(
    site?.registry.scenes.find((s) => s.id === search.scene)?.id ?? site?.registry.scenes[0]?.id ?? '',
  );
  const [active, setActive] = useState<{ renderer: string; scene: string; url: string; token: string }>();
  const [status, setStatus] = useState('Choose a scene and renderer, then start.');
  const [setup, setSetup] = useState<SetupMetric>();
  const [frames, setFrames] = useState<FrameMetric[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!active) return;
    const origin = new URL(active.url).origin;
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const message = event.data as { protocol?: string; token?: string; kind?: string; data: unknown };
      if (message?.protocol !== 'fidelity-kit-host-v1' || message.token !== active.token) return;
      if (message.kind === 'setup') {
        setSetup(message.data as SetupMetric);
        setStatus('Running');
      }
      if (message.kind === 'frame') setFrames((previous) => [...previous.slice(-299), message.data as FrameMetric]);
      if (message.kind === 'error') setStatus(`Render failed: ${String(message.data)}`);
    };
    window.addEventListener('message', receive);
    const timeout = setTimeout(
      () =>
        setStatus((previous) =>
          previous === 'Loading scene…'
            ? 'Render server did not respond. Check the configured URL and browser console.'
            : previous,
        ),
      60000,
    );
    return () => {
      window.removeEventListener('message', receive);
      clearTimeout(timeout);
    };
  }, [active]);
  if (!site) return <p className="p-6">Configure a unified suite using --suite to enable live rendering.</p>;
  const start = () => {
    const url = new URL(site.rendererUrl);
    const token = crypto.randomUUID();
    url.searchParams.set('fidelityKitMode', 'live');
    url.searchParams.set('fidelityKitOrigin', location.origin);
    url.searchParams.set('fidelityKitSession', token);
    url.searchParams.set(
      'fidelityKitParams',
      JSON.stringify({ ...rendererParams(site.registry, renderer, scene), width: 1920, height: 1080, seed: 1 }),
    );
    setSetup(undefined);
    setFrames([]);
    setStatus('Loading scene…');
    setActive({ scene, renderer, url: url.href, token });
    void navigate({ replace: true, search: { view: 'live', scene, renderer } });
  };
  const selectedScene = site.registry.scenes.find((s) => s.id === scene);
  const fidelityScene = scenes.find((s) => s.path === (selectedScene?.path ?? scene));
  const view = resolveView(index, {}, hashes);
  const reference = fidelityScene ? renderUrl(fidelityScene, view, view.ref) : undefined;
  return (
    <div className="live-main mx-auto max-w-[1968px] p-6 flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Live</h1>
      <div className="live-panel flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-2">
          Scene
          <select aria-label="Scene" value={scene} onChange={(e) => setScene(e.target.value)}>
            {site.registry.scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          Renderer
          <select aria-label="Renderer" value={renderer} onChange={(e) => setRenderer(e.target.value)}>
            {renderers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={start} disabled={!renderer || !scene}>
          Start Benchmark
        </Button>
        {active && (active.scene !== scene || active.renderer !== renderer) && (
          <span>Click Start Benchmark to apply the selection.</span>
        )}
      </div>
      <section className="live-panel">
        <div className="flex justify-between gap-4 mb-3">
          <h2>{active ? `${active.scene} / ${active.renderer}` : '3D view'}</h2>
          <output>{status}</output>
        </div>
        <div className="live-viewport overflow-auto">
          {active ? (
            <iframe
              key={active.token}
              ref={frame}
              title="Live 3D scene"
              sandbox="allow-scripts allow-same-origin allow-pointer-lock"
              src={active.url}
              width="1920"
              height="1080"
              allow="cross-origin-isolated; fullscreen"
            />
          ) : (
            <div className="aspect-video flex items-center justify-center bg-muted/20">
              Click Start Benchmark to load the scene.
            </div>
          )}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          1920 × 1080 · Drag to orbit, scroll to zoom. Click the view, then use WASD or arrow keys to move.
        </p>
      </section>
      <FrameChart frames={frames} />
      <SetupChart setup={setup} />
      {reference && (
        <details className="live-panel">
          <summary>Fidelity reference · {view.label(view.ref)}</summary>
          <img className="mt-3 max-w-full" alt={`${scene} reference`} src={reference} />
          <p className="text-sm text-muted-foreground">
            Reference display only. Convergence measurements require a reference with matching dimensions and camera
            pose.
          </p>
        </details>
      )}
    </div>
  );
}
