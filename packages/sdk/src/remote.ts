import { JmError, checkSignal, id, integer } from './errors.js';
import { Flights, readBytes } from './runtime.js';
import type { ErrorCode, Fetch, ImageResult, JmClient } from './types.js';

export interface RemoteOptions { baseUrl: string; token?: string; fetch?: Fetch; timeoutMs?: number; maxResponseBytes?: number }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function strings(value: unknown): boolean { return Array.isArray(value) && value.every(x => typeof x === 'string'); }
function count(value: unknown): boolean { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function validResult(path: string, value: unknown): boolean {
  if (!record(value)) return false;
  if (path === 'search') return typeof value.query === 'string' && count(value.total)
    && (value.redirectId === null || typeof value.redirectId === 'string')
    && Array.isArray(value.items) && value.items.every(x => record(x) && typeof x.id === 'string' && typeof x.name === 'string' && strings(x.authors));
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (path.startsWith('albums/')) return typeof value.description === 'string' && typeof value.seriesId === 'string'
    && count(value.views) && count(value.likes) && ['authors', 'tags', 'works', 'actors'].every(k => strings(value[k]))
    && Array.isArray(value.chapters) && value.chapters.every(x => record(x) && typeof x.id === 'string' && typeof x.name === 'string' && count(x.order));
  return Number.isSafeInteger(value.scrambleId) && count(value.scrambleId) && Array.isArray(value.images)
    && value.images.every(x => record(x) && typeof x.name === 'string' && Number.isSafeInteger(x.index) && count(x.index));
}
export function createRemoteClient(options: RemoteOptions): JmClient {
  let base: URL;
  try {
    base = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : options.baseUrl + '/');
  } catch {
    throw new JmError('INVALID_ARGUMENT', 'Invalid server URL');
  }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new JmError('INVALID_ARGUMENT', 'Invalid server URL');
  const transport = options.fetch ?? globalThis.fetch.bind(globalThis), flights = new Flights();
  const timeoutMs = integer(options.timeoutMs ?? 60000, 1, 600000, 'remote timeout');
  const maxBytes = integer(options.maxResponseBytes ?? 32 * 1024 * 1024, 1, 256 * 1024 * 1024, 'response limit');
  const codes = new Set<ErrorCode>(['INVALID_ARGUMENT', 'NOT_FOUND', 'UPSTREAM', 'INVALID_RESPONSE', 'TIMEOUT', 'ABORTED', 'UNAUTHORIZED', 'PROTOCOL_MISMATCH', 'UNSUPPORTED_IMAGE', 'IMAGE_LIMIT', 'BUSY', 'DISPOSED', 'INTERNAL', 'WRITE_UNCERTAIN']);
  let sequence = 0;
  async function call<T>(path: string, params: Record<string, unknown>, signal?: AbortSignal, image = false): Promise<T> {
    return flights.run(String(sequence++), signal, async shared => {
      const url = new URL(`v1/${path}`, base);
      for (const [key, value] of Object.entries(params)) if (value !== undefined && key !== 'signal') url.searchParams.set(key, String(value));
      const controller = new AbortController(); const cancel = () => controller.abort();
      shared.addEventListener('abort', cancel, { once: true });
      let timeout = false;
      const timer = setTimeout(() => { timeout = true; controller.abort(); }, timeoutMs);
      try {
        const headers = new Headers({ 'x-jm-protocol': '1' });
        if (options.token) headers.set('authorization', `Bearer ${options.token}`);
        const response = await transport(url, { headers, signal: controller.signal, redirect: 'manual' });
        if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new JmError('UPSTREAM', 'Server redirects are not supported');
        }
        const requestId = response.headers.get('x-request-id') ?? undefined;
        if (response.headers.get('x-jm-protocol') !== '1') {
          await response.body?.cancel(); throw new JmError('PROTOCOL_MISMATCH', 'Server does not support SDK protocol 1', false, requestId);
        }
        const bytes = await readBytes(response, response.ok && image ? maxBytes : 4 * 1024 * 1024);
        checkSignal(shared);
        if (!response.ok) {
          let error: { code?: ErrorCode; message?: string; retryable?: boolean };
          try { error = JSON.parse(new TextDecoder().decode(bytes)).error; }
          catch { throw new JmError('INVALID_RESPONSE', 'Invalid server error', false, requestId); }
          if (!error || !codes.has(error.code!) || typeof error.message !== 'string' || typeof error.retryable !== 'boolean')
            throw new JmError('INVALID_RESPONSE', 'Invalid server error', false, requestId);
          throw new JmError(error.code!, error.message, error.retryable, requestId);
        }
        if (image) {
          const width = Number(response.headers.get('x-image-width')), height = Number(response.headers.get('x-image-height'));
          const mime = response.headers.get('content-type') ?? '';
          if (!(Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0 && /^image\/(jpeg|png|webp|gif)$/.test(mime)))
            throw new JmError('INVALID_RESPONSE', 'Invalid image response metadata', false, requestId);
          return { data: bytes, width, height, mime } as T;
        }
        try {
          const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (!validResult(path, result)) throw new Error();
          return result as T;
        } catch { throw new JmError('INVALID_RESPONSE', 'Invalid server JSON', false, requestId); }
      } catch (cause) {
        checkSignal(shared);
        if (timeout) throw new JmError('TIMEOUT', 'Server request timed out', true);
        if (cause instanceof JmError) throw cause;
        throw new JmError('UPSTREAM', 'Server transport failed', true, undefined, { cause });
      } finally { clearTimeout(timer); shared.removeEventListener('abort', cancel); }
    });
  }
  return {
    search: async (query, request = {}) => call('search', { ...request, query }, request.signal),
    getAlbum: async (albumId, request = {}) => call(`albums/${id(albumId)}`, {}, request.signal),
    getChapter: async (chapterId, request = {}) => call(`chapters/${id(chapterId)}`, {}, request.signal),
    getImage: async (chapterId, index, request = {}) => call<ImageResult>(`chapters/${id(chapterId)}/images/${integer(index, 0, 100000, 'image index')}`, request as Record<string, unknown>, request.signal, true),
    dispose: () => flights.dispose(),
  };
}
