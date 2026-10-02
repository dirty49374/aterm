import type { Readable } from 'node:stream';

/** _aterm:MCP_Server_, _aterm:HTTP_Server_: release owned resources even during startup or EOF. */
export async function runForeground(
  start: () => Promise<void>,
  close: () => Promise<void>,
  input?: Readable,
): Promise<void> {
  let stop!: () => void;
  let failure: Error | undefined;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const failed = (error: Error) => {
    failure = error;
    stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  input?.once('end', stop);
  input?.once('close', stop);
  input?.once('error', failed);
  try {
    await start();
    if (input?.readableEnded || input?.destroyed) stop();
    await stopped;
    if (failure) throw failure;
  } finally {
    try {
      await close();
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      input?.off('end', stop);
      input?.off('close', stop);
      input?.off('error', failed);
    }
  }
}
