#!/usr/bin/env node
import { AtermProgram } from './program.js';
import { remoteCommand, remoteSelection } from './mcp-module/client.js';
// A closed downstream pipe (aterm ... | head) ends output; it is not a failure.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    if (process.listenerCount('SIGTERM')) {
      process.emit('SIGTERM', 'SIGTERM');
      return;
    }
    process.exit(process.exitCode ?? 0);
  }
  throw error;
});
try {
  const remote = remoteSelection(process.argv.slice(2));
  if (remote) {
    const chunks: Buffer[] = [];
    if (!process.stdin.isTTY)
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    const result = await remoteCommand(
      remote.url,
      remote.argv,
      chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined,
    );
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  } else await new AtermProgram().create().parseAsync();
} catch (error) {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
}
