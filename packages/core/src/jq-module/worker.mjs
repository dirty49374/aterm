/** Isolated jq worker entry; user text is only workerData. */
async function jqWorker() {
  const { workerData, parentPort } = await import('node:worker_threads');
  const { readFile } = await import('node:fs/promises');
  const { loadJq } = await import(workerData.runtime);
  const fail = (message) => {
    throw Object.assign(new Error(message), { code: 'jq.limit' });
  };
  try {
    const binary = await readFile(new URL(workerData.wasm));
    let memory;
    let emitted = 0;
    const jq = await loadJq({
      instantiateWasm: async (imports, ready) => {
        // This adapter is pinned to jq-wasm 3.0.0-jq-1.8.2. Match named host functions,
        // not minified WASM import keys; fail closed if an upgrade changes the bridge.
        const functions = Object.values(imports).flatMap((namespace) => Object.entries(namespace));
        const hook = (name, replace) => {
          for (const namespace of Object.values(imports)) {
            const item = Object.entries(namespace).find(
              ([, value]) => typeof value === 'function' && value.name === name,
            );
            if (item) {
              namespace[item[0]] = replace(item[1]);
              return;
            }
          }
          throw new Error(`Unsupported jq runtime bridge: ${name}.`);
        };
        if (!functions.length) throw new Error('jq runtime has no host bridge.');
        hook('_fd_write', (original) => (fd, iov, count, written) => {
          const view = new DataView(memory.buffer);
          for (let n = 0; n < count; n++) emitted += view.getUint32(iov + n * 8 + 4, true);
          if (emitted > workerData.outputBytes) fail('jq output exceeds 2 MiB.');
          return original(fd, iov, count, written);
        });
        hook('_emscripten_resize_heap', (original) => (size) => {
          if (size > workerData.memoryBytes) fail('jq memory exceeds 128 MiB.');
          return original(size);
        });
        hook('_environ_sizes_get', () => (count, size) => {
          const view = new DataView(memory.buffer);
          view.setUint32(count, 0, true);
          view.setUint32(size, 0, true);
          return 0;
        });
        hook('_environ_get', () => () => 0);
        const result = await WebAssembly.instantiate(binary, imports);
        memory = Object.values(result.instance.exports).find(
          (value) => value instanceof WebAssembly.Memory,
        );
        if (!memory || memory.buffer.byteLength > workerData.memoryBytes)
          fail('jq initial memory exceeds its limit.');
        const grow = memory.grow.bind(memory);
        memory.grow = (pages) => {
          if (memory.buffer.byteLength + pages * 65536 > workerData.memoryBytes)
            throw new RangeError('jq memory limit');
          return grow(pages);
        };
        ready(result.instance, result.module);
      },
    });
    // MEMFS only; no host mounts, inherited environment, CLI flags or module search paths.
    const bindings = Object.entries(workerData.bindings ?? {}).flatMap(([name, value]) => [
      '--argjson',
      name,
      JSON.stringify(value),
    ]);
    const result = jq.raw(workerData.input, workerData.program, [
      '-c',
      '-L',
      '/no-modules',
      ...bindings,
      '--',
    ]);
    if (result.exitCode !== 0)
      throw new Error(result.stderr || `jq exited with status ${result.exitCode}.`);
    const values = result.stdout ? result.stdout.split('\n').map((line) => JSON.parse(line)) : [];
    if (Buffer.byteLength(JSON.stringify(values)) > workerData.outputBytes)
      fail('jq output exceeds 2 MiB.');
    parentPort.postMessage({ values });
  } catch (error) {
    parentPort.postMessage({
      error: {
        code: error.code === 'jq.limit' ? 'jq.limit' : 'jq.program',
        message: (error instanceof Error ? error.message : String(error)).slice(0, 8000),
      },
    });
  }
}

await jqWorker();
