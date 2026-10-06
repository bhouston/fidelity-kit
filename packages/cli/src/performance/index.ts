import { fileURLToPath } from 'node:url';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { fileCommands } from 'yargs-file-commands';
export async function runCli(argv = hideBin(process.argv)): Promise<void> {
  const commands = await fileCommands({
    commandDirs: [fileURLToPath(new URL('./commands', import.meta.url))],
  });
  await yargs(argv)
    .scriptName('performance-kit')
    .usage('$0 <command>')
    .command(commands)
    .strict()
    .demandCommand(1)
    .help()
    .parseAsync();
}
