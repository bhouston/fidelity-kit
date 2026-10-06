import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { registrySchema } from '../packages/cli/dist/registry.js';
const require = createRequire(new URL('../packages/cli/package.json', import.meta.url));
const { z } = require('zod');
const schema = z.toJSONSchema(registrySchema, { io: 'input' });
schema.$id = 'https://unpkg.com/fidelity-kit/schemas/registry.schema.json';
schema.title = 'Unified fidelity, performance, and live rendering suite';
await writeFile(
  new URL('../packages/cli/schemas/registry.schema.json', import.meta.url),
  JSON.stringify(schema, null, 2) + '\n',
);
