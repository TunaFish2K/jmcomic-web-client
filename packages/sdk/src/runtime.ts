import { abortError, checkSignal, JmError } from './errors.js';
import type { Cache } from './types.js';

export class MemoryCache implements Cache {
  private entries = new Map<string, { bytes: Uint8Array; expires: number }>();
  private size = 0;
  constructor(readonly maxBytes = 16 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid cache size');
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.expires <= Date.now()) { this.evict(key); return; }
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.bytes.slice();
  }
  async set(key: string, bytes: Uint8Array, ttlMs: number): Promise<void> {
    this.evict(key);
    if (bytes.byteLength > this.maxBytes || ttlMs <= 0) return;
    while (this.size + bytes.byteLength > this.maxBytes && this.entries.size)
      this.evict(this.entries.keys().next().value!);
    this.entries.set(key, { bytes: bytes.slice(), expires: Date.now() + ttlMs });
    this.size += bytes.byteLength;
  }
  async delete(key: string): Promise<void> {
    this.evict(key);
  }
  private evict(key: string): void {
    const entry = this.entries.get(key);
    if (entry) { this.size -= entry.bytes.byteLength; this.entries.delete(key); }
  }
}

interface Flight { controller: AbortController; promise: Promise<unknown>; users: number }
export class Flights {
  private active = new Map<string, Flight>();
  private disposed = false;
  run<T>(key: string, signal: AbortSignal | undefined, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    checkSignal(signal);
    if (this.disposed) return Promise.reject(new JmError('DISPOSED', 'Client is disposed'));
    let flight = this.active.get(key);
    if (!flight) {
      const controller = new AbortController();
      flight = { controller, users: 0, promise: Promise.resolve().then(() => {
        checkSignal(controller.signal); return fn(controller.signal);
      }) };
      const current = flight;
      this.active.set(key, current);
      void current.promise.finally(() => {
        if (this.active.get(key) === current) this.active.delete(key);
      }).catch(() => {});
    }
    const current = flight;
    current.users++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const release = () => {
        if (done) return false;
        done = true; signal?.removeEventListener('abort', cancel);
        if (--current.users === 0) {
          if (this.active.get(key) === current) this.active.delete(key);
          current.controller.abort();
        }
        return true;
      };
      const cancel = () => { if (release()) reject(abortError()); };
      signal?.addEventListener('abort', cancel, { once: true });
      current.promise.then(value => { if (release()) resolve(value as T); }, error => {
        if (release()) reject(error);
      });
    });
  }
  dispose(): void {
    this.disposed = true;
    for (const flight of this.active.values()) flight.controller.abort();
    this.active.clear();
  }
}

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  checkSignal(signal);
  await new Promise<void>((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

/** A bounded queue; queued work also observes cancellation. */
export class Gate {
  private active = 0;
  private queue: { start: () => void; cancel: () => void }[] = [];
  constructor(private readonly limit: number, private readonly maxQueue = 32) {}
  async run<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
    checkSignal(signal);
    if (this.active >= this.limit) {
      if (this.queue.length >= this.maxQueue) throw new JmError('BUSY', 'Processing queue is full', true);
      await new Promise<void>((resolve, reject) => {
        const entry = {
          start: () => { signal?.removeEventListener('abort', entry.cancel); resolve(); },
          cancel: () => { this.queue = this.queue.filter(x => x !== entry); reject(abortError()); },
        };
        this.queue.push(entry); signal?.addEventListener('abort', entry.cancel, { once: true });
      });
    } else this.active++;
    try { checkSignal(signal); return await fn(); }
    finally {
      const next = this.queue.shift();
      if (next) next.start(); else this.active--;
    }
  }
}

export async function readBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel(); throw new JmError('IMAGE_LIMIT', 'Response exceeds byte limit');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new JmError('IMAGE_LIMIT', 'Response exceeds byte limit');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const output = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
