import type {
  Transport,
  TransportSendOptions,
} from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage, RequestId } from '@modelcontextprotocol/sdk/types.js';

/** _aterm:MCP_Server_: finish SDK responses before closing a half-closed connection. */
export class DrainingTransport implements Transport {
  onclose?: Transport['onclose'];
  onerror?: Transport['onerror'];
  onmessage?: Transport['onmessage'];
  private readonly pending = new Set<RequestId>();
  private readonly waiters = new Set<() => void>();
  private disconnected = false;
  constructor(private readonly inner: Transport) {
    inner.onclose = () => {
      this.discardResponses();
      this.onclose?.();
    };
    inner.onerror = (error) => {
      this.onerror?.(error);
    };
    inner.onmessage = (message, extra) => {
      if ('method' in message && 'id' in message && !this.disconnected)
        this.pending.add(message.id);
      if ('method' in message && message.method === 'notifications/cancelled') {
        const id = message.params?.requestId;
        if (typeof id === 'string' || typeof id === 'number') this.finished(id);
      }
      this.onmessage?.(message, extra);
    };
  }
  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }
  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }
  start(): Promise<void> {
    return this.inner.start();
  }
  close(): Promise<void> {
    return this.inner.close();
  }
  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    try {
      await this.inner.send(message, options);
    } finally {
      if (!('method' in message) && 'id' in message && message.id !== undefined)
        this.finished(message.id);
    }
  }
  drain(): Promise<void> {
    if (!this.pending.size) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.add(resolve);
    });
  }
  discardResponses(): void {
    this.disconnected = true;
    this.pending.clear();
    this.flush();
  }
  private finished(id: RequestId): void {
    this.pending.delete(id);
    this.flush();
  }
  private flush(): void {
    if (this.pending.size) return;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
}
