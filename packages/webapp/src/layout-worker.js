import { forceLayout } from './force-layout.js';

self.onmessage = async ({ data: { input, algorithm } }) => {
  try {
    self.postMessage({ result: await forceLayout(input, algorithm) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
