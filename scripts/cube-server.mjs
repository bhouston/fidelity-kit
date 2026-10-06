import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import cliPackage from '../packages/cli/package.json' with { type: 'json' };
const require = createRequire(new URL('../packages/viewer/package.json', import.meta.url));
const { createServer } = await import(require.resolve('vite'));
export async function createCubeServer() {
  const server = await createServer({
    configFile: false,
    resolve: {
      alias: {
        'fidelity-kit/browser/host': fileURLToPath(
          new URL(cliPackage.exports['./browser/host'].import, new URL('../packages/cli/', import.meta.url)),
        ),
      },
    },
    root: fileURLToPath(new URL('./fixtures/cube/', import.meta.url)),
    server: { host: '127.0.0.1', port: 0, fs: { allow: [fileURLToPath(new URL('../', import.meta.url))] } },
  });
  await server.listen();
  return { url: `http://127.0.0.1:${server.httpServer.address().port}/`, close: () => server.close() };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createCubeServer();
  console.log(`Cube render server: ${server.url}?fidelityKitMode=live`);
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
}
