import { createReporter, type Reporter } from './index.js';
import { measureThroughput } from './throughput.js';
import { createLiveTelemetry } from './telemetry.js';

export type SessionReporter = Pick<
  Reporter,
  'phaseStart' | 'phaseEnd' | 'environment' | 'frameBegin' | 'frameEnd' | 'convergence' | 'ready'
>;
export interface RenderSession {
  canvas: HTMLCanvasElement;
  accumulated?(): number | Promise<number>;
  /** Optional project-owned stopping policy for progressive captures; independent of benchmark timing. */
  capture?(options: {
    frames: number;
    samples: number;
  }): Promise<{ samples?: number; noise?: number; converged?: boolean }>;
  /** Resize live rendering after completed GPU work; captures and benchmarks keep their configured size. */
  resize?(width: number, height: number): void;
  draw(deltaSeconds?: number): void;
  complete(): Promise<unknown>;
  dispose(): void;
}
export type SessionFactory = (
  params: Record<string, unknown>,
  reporter: SessionReporter,
  host: HTMLElement,
  interactive: boolean,
) => Promise<RenderSession>;
/** Receives each measured frame of a dynamic capture as a base64 PNG; exposed by the `dynamic` command. */
type FrameReceiver = (index: number, png: string) => Promise<void>;

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () =>
      resolve(typeof reader.result === 'string' ? reader.result.slice(reader.result.indexOf(',') + 1) : ''),
    );
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Frame read failed')));
    reader.readAsDataURL(blob);
  });

const integerParam = (value: unknown, fallback: number, name: string, min: number) => {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < min || number > 100000) throw new Error(`Invalid ${name}`);
  return number;
};

const viewportSize = () => ({ width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) });
export const hostProtocol = 'fidelity-kit-host-v1';
/** The project supplies one session factory, shared by captures, benchmarks and interactive rendering. */
export async function mountRenderHost(createSession: SessionFactory): Promise<void> {
  const query = new URLSearchParams(location.search);
  const mode = query.get('fidelityKitMode');
  const target = query.get('fidelityKitOrigin');
  const token = query.get('fidelityKitSession');
  const send = (kind: string, data: unknown) => {
    if (target && token && window.parent !== window)
      window.parent.postMessage({ protocol: hostProtocol, token, kind, data }, new URL(target).origin);
  };
  const reporter = createReporter({
    throughput: true,
    enabled: mode === 'live' || mode === 'capture' || mode === 'dynamic' ? false : undefined,
  });
  const automated = reporter.enabled;
  const responsive = !automated && mode === 'live' && query.get('fidelityKitViewport') === 'responsive';
  let size = viewportSize();
  if (!automated && mode !== 'live' && mode !== 'capture' && mode !== 'dynamic')
    throw new Error('No render host mode selected');
  const telemetry = createLiveTelemetry(
    (data) => send('setup', data),
    (data) => send('frame', data),
  );
  let session: RenderSession | undefined;
  let animation = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(animation);
    clearInterval(timer);
    reporter.dispose();
    session?.dispose();
  };
  window.addEventListener('pagehide', stop, { once: true });
  try {
    const params = automated
      ? reporter.params
      : (JSON.parse(query.get('fidelityKitParams') ?? '{}') as Record<string, unknown>);
    if (responsive) Object.assign(params, size);
    session = await createSession(params, automated ? reporter : telemetry.reporter, document.body, mode === 'live');
    if (stopped) {
      session.dispose();
      return;
    }
    if (mode === 'dynamic') {
      // A deterministic animated sequence: a fixed time step per frame, the first `warmup` frames are not delivered.
      const frames = integerParam(params.frames, 120, 'dynamic frame count', 1);
      const warmup = integerParam(params.warmup, 0, 'dynamic warm-up', 0);
      const fps = Number(params.fps ?? 60);
      if (!(fps > 0) || warmup >= frames) throw new Error('Invalid dynamic sequence');
      const receive = (window as unknown as { __fidelityKitFrame?: FrameReceiver }).__fidelityKitFrame;
      if (!receive) throw new Error('No dynamic frame receiver');
      const readback = document.createElement('canvas');
      readback.width = session.canvas.width;
      readback.height = session.canvas.height;
      const context = readback.getContext('2d');
      if (!context) throw new Error('Dynamic readback context unavailable');
      for (let frame = 0; frame < frames; frame++) {
        if (stopped) throw new Error('Capture cancelled');
        session.draw(1 / fps);
        // Copy in the same task as the draw, before the canvas is presented; this works for WebGL and WebGPU canvases
        // without preserved drawing buffers.
        if (frame >= warmup) context.drawImage(session.canvas, 0, 0);
        await session.complete();
        if (frame < warmup) continue;
        const png = await new Promise<Blob>((resolve, reject) =>
          readback.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Frame encoding failed'))), 'image/png'),
        );
        await receive(frame - warmup, await blobToBase64(png));
      }
      const result = { frames: frames - warmup, width: session.canvas.width, height: session.canvas.height };
      (window as unknown as { __fidelityKitDynamic: typeof result }).__fidelityKitDynamic = result;
      send('complete', result);
      return;
    }
    if (mode === 'capture') {
      const frames = Number(params.frames ?? 64);
      if (!Number.isSafeInteger(frames) || frames < 1 || frames > 100000)
        throw new Error('Invalid capture frame count');
      const samples = Number(params.samples ?? 0);
      if (!Number.isSafeInteger(samples) || samples < 0 || samples > 100000) throw new Error('Invalid sample count');
      let metadata: { samples?: number; noise?: number; converged?: boolean } = {};
      if (session.capture) {
        metadata = await session.capture({ frames, samples });
        await session.complete();
      } else {
        let completed = samples && session.accumulated ? await session.accumulated() : 0;
        if (!Number.isFinite(completed) || completed < 0) throw new Error('Invalid accumulated sample count');
        for (let i = 1; i < 1000000 && (samples && session.accumulated ? completed < samples : i < frames); i++) {
          if (stopped) throw new Error('Capture cancelled');
          session.draw();
          await session.complete();
          if (samples && session.accumulated) {
            const next = await session.accumulated();
            if (!Number.isFinite(next) || next < completed) throw new Error('Invalid accumulated sample count');
            completed = next;
          }
        }
        if (samples && session.accumulated && completed < samples)
          throw new Error('Capture did not reach the sample target');
      }
      (
        window as unknown as {
          __fidelityKitCapture: {
            width: number;
            height: number;
            samples?: number;
            noise?: number;
            converged?: boolean;
          };
        }
      ).__fidelityKitCapture = {
        ...metadata,
        width: session.canvas.width,
        height: session.canvas.height,
      };
      send('complete', { ...metadata, width: session.canvas.width, height: session.canvas.height });
      return;
    }
    if (automated) {
      reporter.onCapture(async () => {
        session!.draw();
        await session!.complete();
        return session!.canvas;
      });
      const durationMs = Number(query.get('performanceKitDurationMs') ?? 5000);
      await measureThroughput(session, {
        durationMs,
        start: () => reporter.startThroughput(),
        batch: (count) => reporter.completedBatch(count),
        end: (count) => reporter.endThroughput(count),
        stopped: () => stopped,
      });
      return;
    }
    let previous = performance.now();
    const tick = async (time: number) => {
      if (stopped || (automated && !reporter.running)) return;
      try {
        if (responsive && session!.resize) {
          const next = viewportSize();
          if (next.width !== size.width || next.height !== size.height) {
            session!.resize(next.width, next.height);
            size = next;
          }
        }
        session!.draw((time - previous) / 1000);
        previous = time;
        // Keep one live frame in flight so a slow adapter cannot accumulate queued GPU work.
        await session!.complete();
        if (!stopped) animation = requestAnimationFrame(tick);
      } catch (error) {
        if (stopped) return;
        if (automated) reporter.fail(error);
        send('error', String(error));
        stop();
      }
    };
    if (!automated) timer = setInterval(() => telemetry.sample(), 1000);
    animation = requestAnimationFrame(tick);
    if (automated)
      reporter.onCapture(async () => {
        await session!.complete();
        session!.draw();
        await session!.complete();
        return session!.canvas;
      });
    send('ready', {});
  } catch (error) {
    if (automated) reporter.fail(error);
    send('error', error instanceof Error ? error.message : String(error));
    (window as unknown as { __fidelityKitError: string }).__fidelityKitError = String(error);
    stop();
    throw error;
  }
}
