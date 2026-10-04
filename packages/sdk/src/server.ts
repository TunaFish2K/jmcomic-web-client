import { asError, JmError } from './errors.js';
import type { JmClient, SearchOptions, ImageOptions } from './types.js';

export interface ServerOptions { token?: string; allowedOrigins?: string[] }
export interface JmServer { fetch(request: Request): Promise<Response> }
const status = { INVALID_ARGUMENT: 400, NOT_FOUND: 404, UPSTREAM: 502, INVALID_RESPONSE: 502,
  TIMEOUT: 504, ABORTED: 499, UNAUTHORIZED: 401, PROTOCOL_MISMATCH: 409,
  UNSUPPORTED_IMAGE: 422, IMAGE_LIMIT: 413, BUSY: 503, DISPOSED: 503, INTERNAL: 500, WRITE_UNCERTAIN: 502 };
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}
/** A factory scopes all client I/O to one request, as required by Workers. */
export function createServer(source: JmClient | (() => JmClient), options: ServerOptions = {}): JmServer {
  return { async fetch(request) {
    const requestId = crypto.randomUUID();
    const headers = new Headers({ 'x-jm-protocol': '1', 'x-request-id': requestId, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    let owned: JmClient | undefined;
    const json = (body: unknown, code = 200) => {
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify(body), { status: code, headers });
    };
    try {
      const origin = request.headers.get('origin');
      if (origin) {
        if (!options.allowedOrigins?.includes(origin)) throw new JmError('UNAUTHORIZED', 'Origin is not allowed');
        headers.set('access-control-allow-origin', origin); headers.set('vary', 'Origin');
        headers.set('access-control-expose-headers', 'x-jm-protocol,x-request-id,x-image-width,x-image-height');
      }
      if (request.method === 'OPTIONS') {
        headers.set('access-control-allow-methods', 'GET,OPTIONS');
        headers.set('access-control-allow-headers', 'authorization,x-jm-protocol');
        return new Response(null, { status: 204, headers });
      }
      if (request.method !== 'GET') return json({ error: { code: 'INVALID_ARGUMENT', message: 'Only GET is supported', retryable: false, requestId } }, 405);
      if (options.token && !sameSecret(request.headers.get('authorization') ?? '', `Bearer ${options.token}`))
        throw new JmError('UNAUTHORIZED', 'Invalid access token');
      const protocol = request.headers.get('x-jm-protocol');
      if (protocol && protocol !== '1') throw new JmError('PROTOCOL_MISMATCH', 'Unsupported SDK protocol');
      const url = new URL(request.url);
      if (url.pathname === '/v1/info') return json({ protocol: 1 });
      const match = url.pathname.match(/^\/v1\/(albums|chapters)\/(\d{1,16})(?:\/images\/(\d{1,6}))?$/);
      if (url.pathname !== '/v1/search' && !match) throw new JmError('NOT_FOUND', 'Route not found');
      const client = typeof source === 'function' ? (owned = source()) : source;
      const number = (key: string): number | undefined => url.searchParams.has(key) ? Number(url.searchParams.get(key)) : undefined;
      if (url.pathname === '/v1/search') return json(await client.search(url.searchParams.get('query') ?? '', {
        signal: request.signal, page: number('page'), mainTag: number('mainTag') as SearchOptions['mainTag'],
        orderBy: url.searchParams.get('orderBy') as SearchOptions['orderBy'] ?? undefined,
        time: url.searchParams.get('time') as SearchOptions['time'] ?? undefined,
      }));
      if (!match) throw new JmError('NOT_FOUND', 'Route not found');
      const [, kind, id, index] = match;
      if (index !== undefined) {
        if (kind !== 'chapters') throw new JmError('NOT_FOUND', 'Route not found');
        const image = await client.getImage(id!, Number(index), { signal: request.signal, maxSide: number('maxSide'), quality: number('quality'),
          format: url.searchParams.get('format') as ImageOptions['format'] ?? undefined });
        headers.set('content-type', image.mime); headers.set('content-length', String(image.data.length));
        headers.set('x-image-width', String(image.width)); headers.set('x-image-height', String(image.height));
        return new Response(image.data as Uint8Array<ArrayBuffer>, { headers });
      }
      return json(await (kind === 'albums' ? client.getAlbum(id!, { signal: request.signal }) : client.getChapter(id!, { signal: request.signal })));
    } catch (cause) {
      const error = asError(cause);
      return json({ error: { code: error.code, message: error.message, retryable: error.retryable, requestId } }, status[error.code]);
    } finally { owned?.dispose(); }
  } };
}
