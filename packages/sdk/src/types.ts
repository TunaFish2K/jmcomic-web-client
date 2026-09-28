export type Fetch = typeof globalThis.fetch;
export interface CallOptions { signal?: AbortSignal }
export interface SearchOptions extends CallOptions {
  page?: number; mainTag?: 0 | 1 | 2 | 3 | 4;
  orderBy?: 'mr' | 'mv' | 'mp' | 'tf'; time?: 'a' | 't' | 'w' | 'm';
}
export interface SearchResult {
  query: string; total: number; redirectId: string | null;
  items: { id: string; name: string; authors: string[] }[];
}
export interface Album {
  id: string; name: string; description: string; views: number; likes: number;
  authors: string[]; tags: string[]; works: string[]; actors: string[];
  seriesId: string; chapters: { id: string; name: string; order: number }[];
}
export interface Chapter {
  id: string; name: string; scrambleId: number;
  images: { name: string; index: number }[];
}
export interface ImageOptions extends CallOptions {
  maxSide?: number; format?: 'jpeg' | 'png' | 'original'; quality?: number;
}
export interface ImageResult {
  data: Uint8Array; mime: string; width: number; height: number;
}
export interface JmClient {
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
  getAlbum(id: string, options?: CallOptions): Promise<Album>;
  getChapter(id: string, options?: CallOptions): Promise<Chapter>;
  /** Image index is zero-based. Upstream URLs are resolved internally. */
  getImage(chapterId: string, index: number, options?: ImageOptions): Promise<ImageResult>;
  dispose(): void;
}
export interface LogEvent {
  event: 'request' | 'retry' | 'failover' | 'cache-hit' | 'error';
  operation: string; attempt?: number; durationMs?: number; code?: string;
}
export type Logger = (event: LogEvent) => void;
export interface Cache {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}
export type ErrorCode = 'INVALID_ARGUMENT' | 'NOT_FOUND' | 'UPSTREAM' | 'INVALID_RESPONSE'
  | 'TIMEOUT' | 'ABORTED' | 'UNAUTHORIZED' | 'PROTOCOL_MISMATCH' | 'UNSUPPORTED_IMAGE'
  | 'IMAGE_LIMIT' | 'BUSY' | 'DISPOSED' | 'INTERNAL';
