#!/usr/bin/env node
import { runCli } from './index.js';
runCli().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
