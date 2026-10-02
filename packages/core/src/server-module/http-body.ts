import type { IncomingMessage } from 'node:http';
import { AtermError } from '../error.js';

/** Bounded JSON envelope shared by public and internal read endpoints. */
export async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) {
      request.resume();
      throw new AtermError('server.body', `Request exceeds ${maxBytes} bytes.`);
    }
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
