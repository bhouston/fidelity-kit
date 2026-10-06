import { fileURLToPath } from 'node:url';
import type { OpenCliDocument } from '@clidoc/core';
import { createDocgenCommand, fromYargsAsync } from '@clidoc/yargs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileCommands } from 'yargs-file-commands';
import { SchemaValidationError } from './core/schema.js';

// Commands are the files in ./commands (process, ...).
async function loadCommands() {
  const commandsDir = fileURLToPath(new URL('./commands', import.meta.url));
  return fileCommands({ commandDirs: [commandsDir] });
}

/** OpenCLI document of this CLI (clidoc), served by `cli __opencli`. */
export async function cliDocument(): Promise<OpenCliDocument> {
  const commands = await loadCommands();
  const docgen = createDocgenCommand(() => cliDocument());
  return fromYargsAsync([...commands, docgen], { title: 'fidelity-kit', binary: 'fidelity-kit', version: '0.1.0' });
}

export async function runCli(argv = hideBin(process.argv)): Promise<void> {
  const commands = await loadCommands();
  const docgen = createDocgenCommand(() =>
    fromYargsAsync([...commands, docgen], { title: 'fidelity-kit', binary: 'fidelity-kit', version: '0.1.0' }),
  );
  await yargs(argv)
    .parserConfiguration({ 'duplicate-arguments-array': false })
    .scriptName('fidelity-kit')
    .usage('$0 <command>')
    .command([...commands, docgen])
    .strictCommands()
    .demandCommand(1)
    .help()
    .fail((message, error, cli) => {
      // Suite files are the user's to fix; usage help and a stack trace would bury the list of problems.
      if (error instanceof SchemaValidationError) console.error(error.message);
      else {
        cli.showHelp('error');
        console.error();
        console.error(error ?? message);
      }
      process.exit(1);
    })
    .parseAsync();
}
