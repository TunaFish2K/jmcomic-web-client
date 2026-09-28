import { JmError, checkSignal, id, integer } from './errors.js';
import { createImageProcessor, validateImageOptions } from './image.js';
import type { ImageProcessor, ImageProcessorOptions } from './image.js';
import { md5, object, sliceCount } from './protocol.js';
import { Flights, MemoryCache } from './runtime.js';
import { Upstream } from './upstream.js';
import type { NetworkOptions } from './upstream.js';
import type { Album, Cache, Chapter, ImageOptions, ImageResult, JmClient, SearchOptions, SearchResult } from './types.js';

export interface LocalOptions extends NetworkOptions {
  cache?: Cache; image?: ImageProcessorOptions; imageProcessor?: ImageProcessor;
}
const encoder = new TextEncoder(), decoder = new TextDecoder();
function strings(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value) && value.every(x => typeof x === 'string')) return value;
  throw new JmError('INVALID_RESPONSE', 'Invalid upstream string list', true);
}
function number(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.replaceAll(',', '')) : Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new JmError('INVALID_RESPONSE', 'Invalid upstream count', true);
  return n;
}
function name(value: unknown): string {
  if (typeof value !== 'string') throw new JmError('INVALID_RESPONSE', 'Missing upstream name', true);
  return value;
}
function upstreamId(value: unknown): string {
  const result = String(value);
  if (!/^\d{1,16}$/.test(result) || !Number.isSafeInteger(Number(result))) throw new JmError('INVALID_RESPONSE', 'Invalid upstream ID', true);
  return result;
}
export function validateSearch(query: string, options: SearchOptions): void {
  if (typeof query !== 'string' || !query.trim() || query.length > 512)
    throw new JmError('INVALID_ARGUMENT', 'Search query must contain 1 to 512 characters');
  integer(options.page ?? 1, 1, 10000, 'page'); integer(options.mainTag ?? 0, 0, 4, 'main tag');
  if (!['mr', 'mv', 'mp', 'tf'].includes(options.orderBy ?? 'mr') || !['a', 't', 'w', 'm'].includes(options.time ?? 'a'))
    throw new JmError('INVALID_ARGUMENT', 'Invalid search filter');
}
export function createLocalClient(options: LocalOptions = {}): JmClient {
  const network = new Upstream(options), flights = new Flights();
  const cache = options.cache ?? new MemoryCache();
  const processor = options.imageProcessor ?? createImageProcessor(options.image);
  const scope = md5(JSON.stringify([options.domains ?? [], options.discoveryUrls ?? []]));
  const key = (kind: string, value: string) => `jm:v1:${scope}:${kind}:${value}`;
  async function cached<T>(kind: string, value: string, signal: AbortSignal | undefined,
    ttl: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const cacheKey = key(kind, value);
    const result = await flights.run(cacheKey, signal, async shared => {
      const hit = await cache.get(cacheKey); checkSignal(shared);
      if (hit) {
        try { network.log({ event: 'cache-hit', operation: kind }); return JSON.parse(decoder.decode(hit)) as T; }
        catch { await cache.delete(cacheKey); }
      }
      const data = await fn(shared); checkSignal(shared);
      await cache.set(cacheKey, encoder.encode(JSON.stringify(data)), ttl); return data;
    });
    return structuredClone(result);
  }
  const client: JmClient = {
    async search(query, request = {}) {
      validateSearch(query, request);
      const params = { search_query: query, page: String(request.page ?? 1), main_tag: String(request.mainTag ?? 0), o: request.orderBy ?? 'mr', t: request.time ?? 'a' };
      return cached('search', JSON.stringify(params), request.signal, 60000, async signal => {
        const raw = object(await network.api('/search', params, signal));
        const redirectId = raw.redirect_aid ? upstreamId(raw.redirect_aid) : null;
        if (!redirectId && !Array.isArray(raw.content)) throw new JmError('INVALID_RESPONSE', 'Missing search content', true);
        return { query, total: number(raw.total), redirectId, items: redirectId ? [] : (raw.content as unknown[]).map(item => {
          const row = object(item); return { id: upstreamId(row.id), name: name(row.name), authors: strings(row.author) };
        }) } satisfies SearchResult;
      });
    },
    async getAlbum(albumId, request = {}) {
      id(albumId);
      return cached('album', albumId, request.signal, 3600000, async signal => {
        const raw = object(await network.api('/album', { id: albumId }, signal));
        if (raw.name === null) throw new JmError('NOT_FOUND', 'Album not found');
        if (raw.series !== undefined && !Array.isArray(raw.series)) throw new JmError('INVALID_RESPONSE', 'Invalid album series', true);
        return { id: albumId, name: name(raw.name), description: typeof raw.description === 'string' ? raw.description : '',
          views: number(raw.total_views), likes: number(raw.likes), authors: strings(raw.author), tags: strings(raw.tags),
          works: strings(raw.works), actors: strings(raw.actors), seriesId: raw.series_id ? upstreamId(raw.series_id) : albumId,
          chapters: (raw.series as unknown[] ?? []).map(item => { const row = object(item); return { id: upstreamId(row.id), name: name(row.name), order: number(row.sort) }; }),
        } satisfies Album;
      });
    },
    async getChapter(chapterId, request = {}) {
      id(chapterId);
      return cached('chapter', chapterId, request.signal, 3600000, async signal => {
        const raw = object(await network.api('/chapter', { id: chapterId }, signal));
        if (raw.name === null) throw new JmError('NOT_FOUND', 'Chapter not found');
        if (!Array.isArray(raw.images)) throw new JmError('INVALID_RESPONSE', 'Missing chapter images', true);
        const template = await network.api('/chapter_view_template', { id: chapterId, mode: 'vertical', page: '0', app_img_shunt: '1', express: 'off' }, signal, true);
        const match = String(template).match(/\b(?:var\s+)?scramble_id\s*=\s*['"]?(\d+)['"]?\s*;/);
        if (!match) throw new JmError('INVALID_RESPONSE', 'Chapter template lacks scramble ID', true);
        const scrambleId = Number(match[1]);
        if (!Number.isSafeInteger(scrambleId)) throw new JmError('INVALID_RESPONSE', 'Invalid scramble ID', true);
        return { id: chapterId, name: name(raw.name), scrambleId, images: strings(raw.images).map((filename, index) => {
          if (!/^[^/\\?#\x00-\x1f]+\.(?:jpg|jpeg|png|webp|gif)$/i.test(filename))
            throw new JmError('INVALID_RESPONSE', 'Invalid chapter image filename', true);
          return { name: filename, index };
        }) } satisfies Chapter;
      });
    },
    async getImage(chapterId, index, request: ImageOptions = {}) {
      id(chapterId); integer(index, 0, 100000, 'image index'); validateImageOptions(request);
      const outputKey = key('restore-v1', JSON.stringify([chapterId, index, request.maxSide ?? null, request.format ?? 'jpeg', request.quality ?? 90]));
      const result = await flights.run(outputKey, request.signal, async signal => {
        const hit = await cache.get(outputKey); checkSignal(signal);
        if (hit) {
          try {
            const headerSize = new DataView(hit.buffer, hit.byteOffset, hit.byteLength).getUint32(0);
            const info = JSON.parse(decoder.decode(hit.subarray(4, 4 + headerSize)));
            if (!(info.width > 0 && info.height > 0 && typeof info.mime === 'string') || headerSize + 4 >= hit.length) throw new Error();
            network.log({ event: 'cache-hit', operation: 'processed-image' });
            return { ...info, data: hit.slice(4 + headerSize) } as ImageResult;
          } catch { await cache.delete(outputKey); }
        }
        const chapter = await client.getChapter(chapterId, { signal });
        const image = chapter.images[index];
        if (!image) throw new JmError('NOT_FOUND', 'Image index is outside the chapter');
        const url = await network.imageUrl(chapterId, image.name, signal);
        const sourceKey = key('source', md5(url));
        const source = await flights.run(sourceKey, signal, async shared => {
          const cached = await cache.get(sourceKey); checkSignal(shared); if (cached) return cached;
          const bytes = await network.image(url, shared, processor.maxInputBytes);
          checkSignal(shared); await cache.set(sourceKey, bytes, 86400000); return bytes;
        });
        let processed: ImageResult;
        try { processed = await processor.process(source, sliceCount(chapter.scrambleId, Number(chapterId), image.name), { ...request, signal }); }
        catch (error) {
          if (error instanceof JmError && ['INVALID_RESPONSE', 'UNSUPPORTED_IMAGE'].includes(error.code)) await cache.delete(sourceKey);
          throw error;
        }
        checkSignal(signal);
        const header = encoder.encode(JSON.stringify({ width: processed.width, height: processed.height, mime: processed.mime }));
        const packed = new Uint8Array(4 + header.length + processed.data.length);
        new DataView(packed.buffer).setUint32(0, header.length); packed.set(header, 4); packed.set(processed.data, 4 + header.length);
        await cache.set(outputKey, packed, 86400000); return processed;
      });
      return { ...result, data: result.data.slice() };
    },
    dispose() { flights.dispose(); network.dispose(); },
  };
  return client;
}
