import { uiRequest, uiState } from '../../core/src/server-module/ui-protocol.ts';
/** UUID v4 also works on HTTP LAN origins, where crypto.randomUUID may be unavailable. */
export function newUUID() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A tab owns identity; the server owns discovery and command delivery. Never replay commands. */
export class UISessionConnection {
  constructor({ protocol, state, apply, health, connected, disconnected, identity }) {
    Object.assign(this, { protocol, state, apply, health, connected, disconnected, identity });
    this.instance = newUUID();
    this.revision = 0;
    this.active = true;
    this.handlers = new AbortController();
    const signal = this.handlers.signal;
    for (const type of ['click', 'input', 'keydown', 'pointerup'])
      document.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) {
            this.active = true;
            this.reportSoon();
          }
        },
        { capture: true, signal },
      );
    document.addEventListener('visibilitychange', () => this.reportSoon(), { signal });
    window.addEventListener(
      'pagehide',
      () => {
        this.suspended = true;
        clearTimeout(this.retry);
        this.socket?.close();
      },
      { signal },
    );
    window.addEventListener(
      'pageshow',
      (event) => {
        if (event.persisted) {
          this.suspended = false;
          void this.connect();
        }
      },
      { signal },
    );
    // State reporting observes asynchronous adapter changes; unchanged state sends nothing.
    this.timer = setInterval(() => this.report(), 400);
    void this.connect();
  }
  loadIdentity(home, reset = false) {
    this.storageKey = `aterm.ui.session:${home}`;
    if (!reset && this.id && this.home === home) return;
    let saved;
    try {
      saved = !reset && JSON.parse(sessionStorage.getItem(this.storageKey) || 'null');
    } catch {
      /* Storage can be unavailable. */
    }
    const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
    if (!saved || !uuid.test(saved.id) || !uuid.test(saved.credential))
      saved = {
        id: newUUID(),
        credential: newUUID(),
        revision: 0,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      };
    Object.assign(this, saved, { home });
    this.revision = Number.isSafeInteger(saved.revision) ? saved.revision : 0;
    this.createdAt ||= new Date().toISOString();
    this.lastActiveAt ||= this.createdAt;
    try {
      this.persist();
    } catch {
      /* Lifetime is then limited to this loaded page. */
    }
    this.identity(this.id, this.id.replaceAll('-', '').slice(0, 6));
  }
  persist() {
    try {
      sessionStorage.setItem(
        this.storageKey,
        JSON.stringify({
          id: this.id,
          credential: this.credential,
          revision: this.revision,
          createdAt: this.createdAt,
          lastActiveAt: this.lastActiveAt,
        }),
      );
    } catch {
      /* Storage can be unavailable. */
    }
  }
  snapshot() {
    const state = this.state();
    const fingerprint = JSON.stringify(state);
    if (fingerprint !== this.fingerprint) {
      this.fingerprint = fingerprint;
      this.revision++;
      this.persist();
    }
    return uiState.parse({ ...state, revision: this.revision });
  }
  async connect() {
    if (this.closed || this.suspended) return;
    try {
      const response = await fetch('/api/health', { signal: AbortSignal.timeout(2500) });
      if (!response.ok) throw new Error('Server unavailable');
      const health = await response.json();
      if (health.protocol !== this.protocol)
        throw new Error(
          `This UI requires Aterm protocol ${this.protocol}. Refresh after restarting the server.`,
        );
      this.loadIdentity(health.home);
      await this.updateHealth(health);
      if (this.closed || this.suspended) return;
      const url = new URL('/api/ui/events', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = (this.socket = new WebSocket(url));
      socket.addEventListener('open', () =>
        socket.send(
          JSON.stringify({
            type: 'hello',
            createdAt: this.createdAt,
            lastActiveAt: this.lastActiveAt,
            id: this.id,
            credential: this.credential,
            instance: this.instance,
            home: this.home,
            protocol: this.protocol,
            state: this.snapshot(),
          }),
        ),
      );
      socket.addEventListener('message', (event) => {
        void this.receive(socket, JSON.parse(event.data)).catch((error) => {
          this.lastError = error.message;
          socket.close();
        });
      });
      socket.addEventListener('close', (event) => {
        if (socket !== this.socket) return;
        this.ready = false;
        this.disconnected(this.lastError || 'Server disconnected. Reconnecting…');
        this.lastError = '';
        if (event.code === 4009) {
          this.collisions = (this.collisions || 0) + 1;
          if (this.collisions >= 4) {
            this.loadIdentity(this.home, true);
            this.collisions = 0;
          }
        }
        this.schedule(event.code === 4009 ? 300 : 1000);
      });
      socket.addEventListener('error', () => socket.close());
    } catch (error) {
      this.disconnected(error.message);
      this.schedule(1000);
    }
  }
  updateHealth(health) {
    this.healthQueue = (this.healthQueue || Promise.resolve())
      .catch(() => {})
      .then(() => this.health(health));
    return this.healthQueue;
  }
  schedule(delay) {
    clearTimeout(this.retry);
    if (!this.closed && !this.suspended)
      this.retry = setTimeout(() => {
        void this.connect();
      }, delay);
  }
  async receive(socket, message) {
    if (socket !== this.socket || this.closed) return;
    if (message.type === 'ready') {
      this.ready = true;
      this.collisions = 0;
      this.identity(this.id, message.session.shortId);
      this.connected();
      this.report(true);
    } else if (message.type === 'identity') this.identity(this.id, message.shortId);
    else if (message.type === 'health') {
      await this.updateHealth(message.health);
      this.report(true);
    } else if (message.type === 'error') this.lastError = message.error.message;
    else if (message.type === 'command') {
      let status = 'applied',
        error;
      try {
        await this.apply(uiRequest.parse(message.command));
      } catch (cause) {
        status = 'failed';
        error = { code: cause.code || 'ui.application', message: cause.message };
      }
      if (status === 'applied') {
        this.lastActiveAt = new Date().toISOString();
        this.persist();
      }
      if (socket === this.socket && socket.readyState === WebSocket.OPEN)
        socket.send(
          JSON.stringify({
            type: 'ack',
            id: message.command.id,
            status,
            state: this.snapshot(),
            ...(error ? { error } : {}),
          }),
        );
      this.report();
    }
  }
  reportSoon() {
    clearTimeout(this.reportTimer);
    this.reportTimer = setTimeout(() => this.report(), 0);
  }
  report(force = false) {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.active) {
      this.lastActiveAt = new Date().toISOString();
      this.persist();
    }
    const state = this.snapshot();
    const fingerprint = JSON.stringify(state);
    if (!force && !this.active && fingerprint === this.sent) return;
    this.socket.send(JSON.stringify({ type: 'state', state, active: !!this.active }));
    this.active = false;
    this.sent = fingerprint;
  }
  close() {
    this.closed = true;
    this.handlers.abort();
    clearInterval(this.timer);
    clearTimeout(this.reportTimer);
    clearTimeout(this.retry);
    this.socket?.close();
  }
}
