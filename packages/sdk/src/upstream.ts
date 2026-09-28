import { JmError, checkSignal } from './errors.js';
import { DISCOVERY, INITIAL_VERSION, decodeEnvelope, decrypt, headers, md5, object, parseJson } from './protocol.js';
import { Flights, Gate, delay, readBytes } from './runtime.js';
import type { Fetch, Logger } from './types.js';
import type { CallOptions } from './types.js';
import { asError, id } from './errors.js';

export { DISCOVERY as DOMAIN_SERVER_URL } from './protocol.js';
export interface ConnectionInfo { baseUrl: string; imageBaseUrl: string; version: string }
export interface UpstreamClient {
  initialize(options?: CallOptions): Promise<ConnectionInfo>;
  request(path: '/search' | '/album' | '/chapter', params: Record<string, string>, options?: CallOptions): Promise<Record<string, unknown>>;
  getChapterTemplate(chapterId: string, options?: CallOptions): Promise<string>;
  dispose(): void;
}

export interface NetworkOptions {
  fetch?: Fetch; domains?: string[]; discoveryUrls?: string[];
  timeoutMs?: number; retries?: number; logger?: Logger;
}
interface Session { base: string; version: string; imageBase: string; cookies: Map<string, string>; expires: number }
export function baseUrl(value: string): string {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw new JmError('INVALID_RESPONSE', 'Invalid upstream origin', true); }
}
export class Upstream {
  private transport: Fetch;
  private session?: Session;
  private candidates?: string[];
  private flights = new Flights();
  private gate = new Gate(4);
  private bad = new Map<string, number>();
  readonly timeout: number;
  readonly retries: number;
  constructor(private options: NetworkOptions) {
    this.transport = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeout = options.timeoutMs ?? 12000;
    this.retries = options.retries ?? 2;
    if (!(this.timeout > 0) || !Number.isInteger(this.retries) || this.retries < 0 || this.retries > 5)
      throw new JmError('INVALID_ARGUMENT', 'Invalid timeout or retry limit');
    if (options.domains) this.candidates = options.domains.map(baseUrl);
  }
  log(event: Parameters<Logger>[0]): void { try { this.options.logger?.(event); } catch { /* Observers cannot fail requests. */ } }
  private async request<T>(url: string, init: RequestInit, operation: string,
    read: (response: Response) => Promise<T>): Promise<T> {
    const caller = init.signal ?? undefined;
    return this.gate.run(caller, async () => {
      for (let attempt = 0;; attempt++) {
        checkSignal(caller);
        const controller = new AbortController();
        const cancel = () => controller.abort();
        caller?.addEventListener('abort', cancel, { once: true });
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeout);
        const start = Date.now(); let retryMs = Math.min(2000, 300 * 2 ** attempt);
        try {
          const response = await this.transport(url, { ...init, signal: controller.signal, redirect: 'error' });
          if (!response.ok) {
            const seconds = Number(response.headers.get('retry-after'));
            if (Number.isFinite(seconds) && seconds > 0) retryMs = Math.min(5000, seconds * 1000);
            await response.body?.cancel();
            if (response.status === 404) throw new JmError('NOT_FOUND', 'Upstream resource not found');
            throw new JmError('UPSTREAM', `Upstream HTTP ${response.status}`,
              [408, 425, 429].includes(response.status) || response.status >= 500);
          }
          const value = await read(response);
          checkSignal(caller);
          this.log({ event: 'request', operation, durationMs: Date.now() - start });
          return value;
        } catch (cause) {
          checkSignal(caller);
          const error = timedOut ? new JmError('TIMEOUT', 'Upstream request timed out', true)
            : cause instanceof JmError ? cause : new JmError('UPSTREAM', 'Upstream transport failed', true, undefined, { cause });
          if (!error.retryable || attempt >= this.retries) {
            this.log({ event: 'error', operation, code: error.code, durationMs: Date.now() - start });
            throw error;
          }
          this.log({ event: 'retry', operation, attempt: attempt + 1, code: error.code });
        } finally { clearTimeout(timer); caller?.removeEventListener('abort', cancel); }
        await delay(retryMs, caller);
      }
    });
  }
  async discover(signal: AbortSignal): Promise<string[]> {
    if (this.candidates?.length) return this.candidates;
    let last: unknown;
    for (const source of this.options.discoveryUrls ?? DISCOVERY) {
      try {
        const domains = await this.request(source, { signal }, 'discovery', async response => {
          const text = new TextDecoder().decode(await readBytes(response, 1024 * 1024));
          const result = object(parseJson(decrypt(text.trim(), md5('diosfjckwpqpdfjkvnqQjsik'))));
          if (!Array.isArray(result.Server) || !result.Server.length) throw new JmError('INVALID_RESPONSE', 'Empty domain discovery', true);
          return result.Server.filter((x): x is string => typeof x === 'string').map(baseUrl);
        });
        if (!domains.length) throw new JmError('INVALID_RESPONSE', 'Empty domain discovery', true);
        this.candidates = [...new Set(domains)]; return this.candidates;
      } catch (error) { checkSignal(signal); last = error; }
    }
    throw last ?? new JmError('UPSTREAM', 'No discovery sources configured');
  }
  private cookies(response: Response, session: Session): void {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const first = cookie.split(';')[0]!; const at = first.indexOf('=');
      if (at > 0) session.cookies.set(first.slice(0, at), first.slice(at + 1));
    }
  }
  private async initialize(signal: AbortSignal): Promise<Session> {
    if (this.session && this.session.expires > Date.now()) return this.session;
    return this.flights.run('initialize', signal, async shared => {
      const domains = await this.discover(shared);
      const ordered = [...domains].sort((a, b) => (this.bad.get(a) ?? 0) - (this.bad.get(b) ?? 0));
      const controller = new AbortController();
      const cancel = () => controller.abort(); shared.addEventListener('abort', cancel, { once: true });
      try {
        const session = await Promise.any(ordered.slice(0, 4).map(async base => {
          const stamp = Math.floor(Date.now() / 1000);
          const session: Session = { base, imageBase: '', version: INITIAL_VERSION, cookies: new Map(), expires: Date.now() + 300000 };
          const result = await this.request(`${base}/setting`, { signal: controller.signal, headers: headers(stamp, INITIAL_VERSION) }, 'setting', async response => {
            this.cookies(response, session);
            return decodeEnvelope(new TextDecoder().decode(await readBytes(response, 2 * 1024 * 1024)), stamp);
          });
          if (typeof result.version !== 'string' || !result.version || typeof result.img_host !== 'string' || !result.img_host)
            throw new JmError('INVALID_RESPONSE', 'Upstream settings lack version or image host', true);
          session.version = result.version; session.imageBase = baseUrl(result.img_host);
          return session;
        }));
        checkSignal(shared); this.session = session; return session;
      } catch (cause) {
        checkSignal(shared);
        if (!this.options.domains) this.candidates = undefined;
        throw new JmError('UPSTREAM', 'No valid upstream settings endpoint available', true, undefined, { cause });
      } finally { controller.abort(); shared.removeEventListener('abort', cancel); }
    });
  }
  async connectionInfo(signal: AbortSignal): Promise<ConnectionInfo> {
    checkSignal(signal);
    const session = await this.initialize(signal);
    return { baseUrl: session.base, imageBaseUrl: session.imageBase, version: session.version };
  }
  async api(path: string, params: Record<string, string>, signal: AbortSignal, template = false): Promise<Record<string, unknown> | string> {
    for (let attempt = 0;; attempt++) {
      const session = await this.initialize(signal);
      const stamp = Math.floor(Date.now() / 1000);
      const url = new URL(path, session.base);
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
      if (template) url.searchParams.set('v', String(stamp));
      const requestHeaders = headers(stamp, session.version, template);
      if (session.cookies.size) requestHeaders.set('cookie', [...session.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
      try {
        return await this.request(url.href, { headers: requestHeaders, signal }, path, async response => {
          this.cookies(response, session);
          const text = new TextDecoder().decode(await readBytes(response, 4 * 1024 * 1024));
          if (template) {
            if (!/\bscramble_id\s*=\s*['"]?\d+['"]?\s*;/.test(text))
              throw new JmError('INVALID_RESPONSE', 'Chapter template lacks scramble ID', true);
            return text;
          }
          return decodeEnvelope(text, stamp);
        });
      } catch (error) {
        checkSignal(signal);
        if (!(error instanceof JmError) || !error.retryable || attempt >= 1) throw error;
        this.bad.set(session.base, Date.now());
        if (this.session === session) this.session = undefined;
        this.log({ event: 'failover', operation: path, code: error.code });
      }
    }
  }
  async imageUrl(chapterId: string, name: string, signal: AbortSignal): Promise<string> {
    const session = await this.initialize(signal);
    return new URL(`/media/photos/${chapterId}/${encodeURIComponent(name)}`, session.imageBase).href;
  }
  async image(url: string, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
    return this.request(url, { signal, headers: { 'user-agent': headers(0, INITIAL_VERSION).get('user-agent')! } }, 'image', response => readBytes(response, maxBytes));
  }
  dispose(): void { this.flights.dispose(); }
}

/** Stateless metadata access for applications that own cache/refresh policies. */
export function createUpstreamClient(options: NetworkOptions = {}): UpstreamClient {
  const network = new Upstream(options), lifetime = new AbortController();
  async function run<T>(operation: string, options: CallOptions, fn: (signal: AbortSignal) => Promise<T>) {
    if (lifetime.signal.aborted) throw new JmError('DISPOSED', 'Client is disposed');
    const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
    try { checkSignal(signal); return await fn(signal); }
    catch (cause) { const error = asError(cause); error.operation ??= operation; throw error; }
  }
  return {
    initialize: (request = {}) => run('initialize', request, signal => network.connectionInfo(signal)),
    request: (path, params, request = {}) => run(path.slice(1), request, async signal => {
      if (!['/search', '/album', '/chapter'].includes(path)) throw new JmError('INVALID_ARGUMENT', 'Unsupported metadata endpoint');
      return object(await network.api(path, params, signal));
    }),
    getChapterTemplate: (chapterId, request = {}) => run('chapter-template', request, async signal => {
      id(chapterId);
      return String(await network.api('/chapter_view_template', { id: chapterId, mode: 'vertical', page: '0', app_img_shunt: '1', express: 'off' }, signal, true));
    }),
    dispose() { lifetime.abort(); network.dispose(); },
  };
}

export async function discoverDomains(options: NetworkOptions & CallOptions = {}): Promise<string[]> {
  const network = new Upstream(options);
  try { return await network.discover(options.signal ?? new AbortController().signal); }
  catch (cause) { const error = asError(cause); error.operation ??= 'discovery'; throw error; }
  finally { network.dispose(); }
}
