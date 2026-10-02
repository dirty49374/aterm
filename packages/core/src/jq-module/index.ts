import { Worker } from 'node:worker_threads';
import { AtermError } from '../error.js';
import { jqLimits, jqBindings, type JsonValue } from '../query-module/jq-request.js';

let running = 0;

/** One isolated jq execution over a complete selected snapshot; no per-Term processes. */
export async function executeJq(
  data: string,
  program: string,
  bindings?: Record<string, JsonValue> | null,
): Promise<readonly JsonValue[]> {
  const values = jqBindings.parse(bindings ?? {});
  if (Buffer.byteLength(JSON.stringify(values)) > jqLimits.programBytes)
    throw new AtermError('jq.limit', 'jq bindings exceed 64 KiB.');
  if (running >= jqLimits.concurrent)
    throw new AtermError(
      'jq.busy',
      'Four jq executions are already running; retry when one completes.',
    );
  running++;
  let worker: Worker | undefined;
  try {
    // The script is fixed application code. The program and corpus are never interpolated.
    worker = new Worker(new URL('./worker.mjs', import.meta.url), {
      env: {},
      execArgv: [],
      stdout: true,
      stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      workerData: {
        input: data,
        bindings: values,
        program,
        runtime: import.meta.resolve('jq-wasm'),
        wasm: import.meta.resolve('jq-wasm/jq.wasm'),
        outputBytes: jqLimits.outputBytes,
        memoryBytes: jqLimits.memoryBytes,
      },
    });
    worker.stdout.resume();
    worker.stderr.resume();
    return await new Promise<readonly JsonValue[]>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new AtermError('jq.limit', 'jq execution exceeded 5 seconds.')),
        jqLimits.timeoutMs,
      );
      const done = () => clearTimeout(timeout);
      worker!.once(
        'message',
        (message: { values?: JsonValue[]; error?: { code: string; message: string } }) => {
          done();
          if (message.error) reject(new AtermError(message.error.code, message.error.message));
          else resolve(message.values!);
        },
      );
      worker!.once('error', (error) => {
        done();
        reject(new AtermError('jq.limit', `jq worker failed: ${error.message}`));
      });
      worker!.once('exit', (code) => {
        done();
        reject(
          new AtermError('jq.program', `jq worker exited before returning a result (${code}).`),
        );
      });
    });
  } finally {
    await worker?.terminate();
    running--;
  }
}
