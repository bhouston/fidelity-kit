# Cube render server

This small raw WebGL fixture renders a spinning cube through the same session host used by fidelity captures, performance runs, and live viewing. It has no dependency on a consuming project's scenes or Three.js. Its `complete()` drains GPU work; its disposer deletes GPU resources and removes the canvas.

After `pnpm build`, run `node scripts/cube-server.mjs` to try it. The printed URL opens the spinning cube in live mode. Replace its query with `?fidelityKitMode=capture&fidelityKitParams={"frames":3}` for a finite capture.

After `pnpm build`, run `pnpm test:browser` to verify real browser outcomes. Set `CHROME_EXECUTABLE` to a local Chrome binary, or install one with `cd packages/cli && pnpm exec puppeteer browsers install chrome`. CI installs Chrome explicitly; missing Chrome is a failure rather than a skipped test.

The browser checks assert visible output, exact completed capture frames, live telemetry without persistence, cleanup, CLI captures, surfaced setup errors, and five seconds of completed-frame throughput with vsync disabled. Software rendering is accepted for these correctness checks. These results are not hardware performance comparisons. Deterministic lifecycle unit tests cover failure and cancellation cases that a spinning animation cannot reliably provoke.
