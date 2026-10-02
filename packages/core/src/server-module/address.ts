import type { IncomingHttpHeaders } from 'node:http';

interface IServerAddress {
  readonly host: string;
  readonly port: number;
  readonly publicOrigin?: string;
}

/** Listener and client URLs share IPv6 formatting and port normalization. */
export function serverUrl({ host, port }: IServerAddress): string {
  return new URL(`http://${host.includes(':') ? `[${host}]` : host}:${port}`).origin;
}

/** Wildcard bind addresses are not destinations; discovery uses their loopback. */
export function serverClientUrl(address: IServerAddress): string {
  const url = new URL(serverUrl(address));
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  if (url.hostname === '[::]') url.hostname = '[::1]';
  return url.origin;
}

/** Host validation protects loopback listeners; Origin is relative to the requested authority. */
export function acceptsServerOrigin(
  headers: IncomingHttpHeaders,
  address: IServerAddress,
): boolean {
  const authority = headers.host;
  if (!authority || /[\s\\/@?#%]/.test(authority)) return false;
  let requested: URL;
  try {
    requested = new URL(`http://${authority}`);
  } catch {
    return false;
  }
  if (address.publicOrigin) {
    const publicUrl = new URL(address.publicOrigin);
    const hostMatches = authority === publicUrl.host;
    if (hostMatches && (headers.origin === undefined || headers.origin === publicUrl.origin))
      return true;
    if (headers.origin === publicUrl.origin) {
      // A configured proxy may rewrite Host to the upstream while preserving Origin.
      return acceptsServerOrigin(
        { ...headers, origin: undefined },
        { host: address.host, port: address.port },
      );
    }
  }
  if (Number(requested.port || 80) !== address.port) return false;
  const bound = new URL(serverUrl(address)).hostname;
  const wildcard = bound === '0.0.0.0' || bound === '[::]';
  const loopback = bound === 'localhost' || bound === '[::1]' || /^127\./.test(bound);
  const allowed = new Set([bound, ...(loopback ? ['localhost', '127.0.0.1', '[::1]'] : [])]);
  if (!wildcard && !allowed.has(requested.hostname)) return false;
  return headers.origin === undefined || headers.origin === requested.origin;
}
