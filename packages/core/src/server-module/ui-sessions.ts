import { AtermError } from '../error.js';
import { byText } from '../order.js';
import {
  compactId,
  shortSessionId,
  type IUICommand,
  type IUISession,
  type UIInstruction,
  type UIState,
} from './ui-protocol.js';

interface IConnection {
  send(value: unknown): void;
  close(): void;
}
interface ISession {
  id: string;
  credential: string;
  instance: string;
  connection?: IConnection;
  state: UIState;
  createdAt: string;
  lastActiveAt: string;
  lastSeenAt: string;
}
interface ICommandRecord {
  result: IUICommand;
  connection: IConnection;
  signature: string;
  promise: Promise<IUICommand>;
  finish(): void;
  timer: ReturnType<typeof setTimeout>;
}

/** _aterm:UI_Session_ and _aterm:UI_Command_ lifecycles, independent of the WebSocket adapter. */
export class UISessions {
  private readonly sessions = new Map<string, ISession>();
  private readonly commands = new Map<string, ICommandRecord>();
  constructor(
    private readonly timeout = 30_000,
    private readonly now = () => new Date().toISOString(),
  ) {}

  register(
    id: string,
    credential: string,
    instance: string,
    state: UIState,
    connection: IConnection,
    activity?: { createdAt: string; lastActiveAt: string },
  ): void {
    this.prune();
    const existing = this.sessions.get(id);
    if (existing && existing.credential !== credential)
      throw new AtermError(
        'ui.credential',
        'This Session ID belongs to a different reconnect credential.',
      );
    if (existing?.connection && existing.instance !== instance)
      throw new AtermError('ui.duplicate', 'This Session is already connected in another page.');
    if (existing?.connection) {
      const previous = existing.connection;
      this.disconnect(id, previous);
      previous.close();
    }
    const time = this.now();
    this.sessions.set(id, {
      id,
      credential,
      instance,
      connection,
      state,
      createdAt:
        existing?.createdAt ?? (activity && activity.createdAt < time ? activity.createdAt : time),
      lastActiveAt:
        existing?.lastActiveAt ??
        (activity && activity.lastActiveAt < time ? activity.lastActiveAt : time),
      lastSeenAt: time,
    });
  }
  update(id: string, connection: IConnection, state?: UIState, active = false): void {
    const session = this.sessions.get(id);
    if (!session || session.connection !== connection) return;
    session.lastSeenAt = this.now();
    if (state) session.state = state;
    if (active) session.lastActiveAt = session.lastSeenAt;
  }
  disconnect(id: string, connection: IConnection): void {
    const session = this.sessions.get(id);
    if (!session || session.connection !== connection) return;
    session.connection = undefined;
    for (const record of this.commands.values())
      if (record.connection === connection && record.result.status === 'pending')
        this.unknown(
          record,
          'ui.disconnected',
          'The Session disconnected before acknowledging; application is unknown.',
        );
  }
  list(): IUISession[] {
    this.prune();
    return [...this.sessions.values()]
      .map((s) => this.present(s))
      .sort((a, b) => byText(b.lastActiveAt, a.lastActiveAt) || byText(a.id, b.id));
  }
  get(selector: string): IUISession {
    return this.present(this.resolve(selector));
  }
  command(id: string): IUICommand {
    this.prune();
    const result = this.commands.get(id)?.result;
    if (!result) throw new AtermError('ui.command', `Unknown or expired UI command ${id}.`);
    return structuredClone(result);
  }
  replay(request: UIInstruction): Promise<IUICommand> | undefined {
    this.prune();
    const existing = this.commands.get(request.id);
    if (!existing) return;
    const normalized = { ...request, session: this.resolve(request.session).id };
    const signature = this.signature(normalized);
    if (existing.signature !== signature && this.signature(existing.result.request) !== signature)
      throw new AtermError(
        'ui.command-conflict',
        `Command ${request.id} already has a different request.`,
      );
    return existing.promise.then(() => structuredClone(existing.result));
  }
  private signature(request: UIInstruction): string {
    return JSON.stringify([
      request.operation,
      request.session,
      request.id,
      'terms' in request ? request.terms : [],
    ]);
  }
  async execute(request: UIInstruction, original = request): Promise<IUICommand> {
    const repeated = this.replay(original);
    if (repeated) return repeated;
    const session = this.resolve(request.session);
    request = { ...request, session: session.id };
    const signature = this.signature({ ...original, session: session.id });
    if (!session.connection)
      throw new AtermError('ui.disconnected', `Session ${session.id} is disconnected.`);
    if (
      session.state.busy ||
      [...this.commands.values()].some(
        (r) => r.result.session === session.id && r.result.status === 'pending',
      )
    )
      throw new AtermError(
        'ui.busy',
        `Session ${session.id} is busy; finish its current action and retry.`,
      );
    if (this.commands.size >= 1000) {
      const settled = [...this.commands].find(([, r]) => r.result.status !== 'pending');
      if (!settled) throw new AtermError('ui.capacity', 'Too many pending UI commands.');
      this.commands.delete(settled[0]);
    }
    const result: IUICommand = {
      id: request.id,
      session: session.id,
      request,
      createdAt: this.now(),
      status: 'pending',
    };
    let finish!: () => void;
    const promise = new Promise<IUICommand>((resolve) => {
      finish = () => resolve(structuredClone(result));
    });
    const record: ICommandRecord = {
      result,
      connection: session.connection,
      signature,
      promise,
      finish,
      timer: setTimeout(
        () =>
          this.unknown(
            record,
            'ui.timeout',
            'No acknowledgement within thirty seconds; application is unknown. Inspect this command ID before retrying.',
          ),
        this.timeout,
      ),
    };
    record.timer.unref();
    this.commands.set(request.id, record);
    try {
      session.connection.send({ type: 'command', command: request });
    } catch {
      this.unknown(
        record,
        'ui.delivery',
        'Connection failed during delivery; application is unknown.',
      );
    }
    return promise;
  }
  acknowledge(
    sessionId: string,
    connection: IConnection,
    id: string,
    status: 'applied' | 'failed',
    state: UIState,
    error?: IUICommand['error'],
  ): void {
    const record = this.commands.get(id);
    if (
      !record ||
      record.result.session !== sessionId ||
      record.connection !== connection ||
      !['pending', 'unknown'].includes(record.result.status)
    )
      return;
    if (this.sessions.get(sessionId)?.connection !== connection) return;
    clearTimeout(record.timer);
    Object.assign(record.result, { status, state, completedAt: this.now() });
    delete record.result.error;
    if (error) record.result.error = error;
    this.update(sessionId, connection, state, status === 'applied');
    record.finish();
  }
  close(): void {
    for (const session of this.sessions.values()) {
      if (!session.connection) continue;
      const connection = session.connection;
      this.disconnect(session.id, connection);
      connection.close();
    }
    for (const record of this.commands.values()) clearTimeout(record.timer);
  }
  private resolve(selector: string): ISession {
    this.prune();
    const prefix = compactId(selector);
    const matches = [...this.sessions.values()].filter((s) => compactId(s.id).startsWith(prefix));
    if (!matches.length)
      throw new AtermError(
        'ui.session',
        `No Session matches ${selector}. Run aterm ui session list.`,
      );
    if (matches.length > 1)
      throw new AtermError(
        'ui.ambiguous',
        `Session prefix ${selector} is ambiguous: ${matches.map((s) => s.id).join(', ')}.`,
      );
    return matches[0]!;
  }
  private present(s: ISession): IUISession {
    const pending = [...this.commands.values()].some(
      (r) => r.result.session === s.id && r.result.status === 'pending',
    );
    return {
      id: s.id,
      shortId: shortSessionId(s.id, [...this.sessions.keys()]),
      status: !s.connection ? 'disconnected' : s.state.busy || pending ? 'busy' : 'ready',
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      lastSeenAt: s.lastSeenAt,
      state: structuredClone(s.state),
    };
  }
  private unknown(record: ICommandRecord, code: string, message: string): void {
    if (record.result.status !== 'pending') return;
    clearTimeout(record.timer);
    Object.assign(record.result, { status: 'unknown', error: { code, message } });
    record.finish();
  }
  private prune(): void {
    const cutoff = Date.parse(this.now()) - 3600000;
    for (const [id, s] of this.sessions)
      if (!s.connection && Date.parse(s.lastSeenAt) < cutoff) this.sessions.delete(id);
    for (const [id, r] of this.commands)
      if (r.result.status !== 'pending' && Date.parse(r.result.createdAt) < cutoff)
        this.commands.delete(id);
  }
}
