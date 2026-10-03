#!/usr/bin/env node
import { AtermProgram } from './program.js';
import { RemoteCommandInvocation, remoteSelection } from './mcp-module/client.js';
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
    await new AtermProgram(new RemoteCommandInvocation(remote.url, remote.argv))
      .create()
      .parseAsync(remote.argv, { from: 'user' });
  } else await new AtermProgram().create().parseAsync();
} catch (error) {
  process.stderr.write(String(error) + '\n');
  process.exitCode = 1;
}
