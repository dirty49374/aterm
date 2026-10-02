import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { AtermError } from '../error.js';
import type { IAtermConfig } from '../home-module/index.js';
import { localTerm } from '../syntax-module/identity.js';
import { acceptsServerOrigin } from './address.js';
import type { AtermSnapshot } from './snapshot.js';
import { serverProtocol } from './protocol.js';
import { UISessions } from './ui-sessions.js';
import { uiBrowserMessage, uiRequest, type UIResult } from './ui-protocol.js';

/** Browser transport and controller boundary; _aterm:Control_UI_ never writes the corpus. */
export class UIService {
  private readonly registry = new UISessions();
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly unsubscribe: () => void;
  private readonly peers = new Map<
    WebSocket,
    { id: string; alive: boolean; connection: { send(value: unknown): void; close(): void } }
  >();
  constructor(
    private readonly config: IAtermConfig,
    private readonly home: string,
    private readonly snapshot: AtermSnapshot,
  ) {
    this.heartbeat = setInterval(() => {
      for (const [socket, peer] of this.peers) {
        if (!peer.alive) {
          socket.terminate();
          continue;
        }
        peer.alive = false;
        socket.ping();
      }
    }, 15000);
    this.heartbeat.unref();
    this.unsubscribe = snapshot.subscribe(() =>
      this.broadcast({ type: 'health', health: this.health() }),
    );
    this.sockets.on('connection', (socket) => this.connect(socket));
  }
  health() {
    return {
      protocol: serverProtocol,
      home: this.home,
      revision: this.snapshot.revision,
      ready: !this.snapshot.error,
      ...(this.snapshot.error
        ? { error: { code: 'server.refresh', message: String(this.snapshot.error) } }
        : {}),
    };
  }
  attach(server: Server): void {
    server.on('upgrade', (request, socket, head) => {
      const allowed =
        request.url === '/api/ui/events' &&
        !!request.headers.origin &&
        acceptsServerOrigin(request.headers, this.config.server!);
      if (!allowed) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      this.sockets.handleUpgrade(request, socket, head, (ws) =>
        this.sockets.emit('connection', ws, request),
      );
    });
  }
  authorized(request: IncomingMessage): boolean {
    const address = request.socket.remoteAddress ?? '';
    const local =
      address === '::1' ||
      /^(?:::ffff:)?127\./.test(address) ||
      (!!address && address === request.socket.localAddress);
    if (local && request.headers.origin === undefined) return true;
    const expected = this.config.server?.controlToken;
    const provided = request.headers.authorization?.replace(/^Bearer /, '');
    if (!expected || !provided) return false;
    const a = Buffer.from(expected),
      b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  async request(input: unknown): Promise<UIResult> {
    const parsed = uiRequest.safeParse(input);
    if (!parsed.success) throw new AtermError('ui.request', parsed.error.message);
    let request = parsed.data;
    if (request.operation === 'session-list')
      return { operation: request.operation, sessions: this.registry.list() };
    if (request.operation === 'session-view')
      return { operation: request.operation, session: this.registry.get(request.session) };
    if (request.operation === 'command-view')
      return { operation: request.operation, command: this.registry.command(request.id) };
    const original = request;
    const repeated = this.registry.replay(request);
    if (repeated) return { operation: request.operation, command: await repeated };
    if ('terms' in request) {
      const corpus = await this.snapshot.query({ operation: 'check' });
      if (!('termDeclarations' in corpus) || corpus.diagnostics.length)
        throw new AtermError('ui.corpus', 'Resolve corpus diagnostics before controlling the UI.');
      const ids = [
        ...new Set(corpus.termDeclarations.map((termDeclaration) => termDeclaration.id)),
      ];
      const terms = request.terms.map((term) => {
        const matches = ids.filter((id) =>
          term.includes(':') ? id === term : localTerm(id) === term,
        );
        if (matches.length !== 1)
          throw new AtermError(
            matches.length ? 'ui.term-ambiguous' : 'ui.term',
            matches.length
              ? `Term ${term} is ambiguous: ${matches.join(', ')}.`
              : `Unknown Term ${term}.`,
          );
        return matches[0]!;
      });
      request = { ...request, terms: [...new Set(terms)] } as typeof request;
    }
    return {
      operation: request.operation,
      command: await this.registry.execute(request, original),
    };
  }
  close(): void {
    this.unsubscribe();
    clearInterval(this.heartbeat);
    this.registry.close();
    for (const socket of this.sockets.clients) socket.terminate();
    this.sockets.close();
  }
  private broadcast(value: unknown): void {
    for (const [socket, peer] of this.peers)
      if (peer.id && socket.readyState === WebSocket.OPEN) peer.connection.send(value);
  }
  private connect(socket: WebSocket): void {
    const connection = {
      send: (value: unknown) => socket.send(JSON.stringify(value)),
      close: () => socket.terminate(),
    };
    const peer = { id: '', alive: true, connection };
    this.peers.set(socket, peer);
    const deadline = setTimeout(() => {
      if (!peer.id) socket.close(4000, 'Registration required');
    }, 5000);
    deadline.unref();
    socket.on('error', () => socket.terminate());
    socket.on('pong', () => {
      peer.alive = true;
      this.registry.update(peer.id, connection);
    });
    socket.on('close', () => {
      clearTimeout(deadline);
      this.registry.disconnect(peer.id, connection);
      this.peers.delete(socket);
    });
    socket.on('message', (data) => {
      try {
        const message = uiBrowserMessage.parse(JSON.parse(data.toString()));
        if (message.type === 'hello') {
          if (peer.id) throw new AtermError('ui.registration', 'Session already registered.');
          if (message.protocol !== serverProtocol || message.home !== this.home)
            throw new AtermError(
              'server.identity',
              'Browser Home or protocol does not match this server.',
            );
          this.registry.register(
            message.id,
            message.credential,
            message.instance,
            message.state,
            connection,
            { createdAt: message.createdAt, lastActiveAt: message.lastActiveAt },
          );
          peer.id = message.id;
          clearTimeout(deadline);
          connection.send({
            type: 'ready',
            session: this.registry.get(peer.id),
            health: this.health(),
          });
          for (const p of this.peers.values())
            if (p.id)
              p.connection.send({ type: 'identity', shortId: this.registry.get(p.id).shortId });
        } else {
          if (!peer.id)
            throw new AtermError('ui.registration', 'Register before sending Session state.');
          if (message.type === 'state')
            this.registry.update(peer.id, connection, message.state, message.active);
          else
            this.registry.acknowledge(
              peer.id,
              connection,
              message.id,
              message.status,
              message.state,
              message.error,
            );
        }
      } catch (error) {
        const code = error instanceof AtermError ? error.code : 'ui.message';
        connection.send({
          type: 'error',
          error: { code, message: error instanceof Error ? error.message : String(error) },
        });
        socket.close(code === 'ui.duplicate' ? 4009 : 4000, code);
      }
    });
  }
}
