import { createUpstreamClient, discoverDomains, type UpstreamClient, type ConnectionInfo } from 'jmcomic-sdk-pwa/upstream';
import { JmError } from 'jmcomic-sdk-pwa';
import { normalizeSearchResult, type Album, type Photo, type SearchResult } from '@tiny-client/shared/client';

export async function getDomainsFromDomainServer(source: string) {
  return (await discoverDomains({ discoveryUrls: [source], retries: 0 })).map(url => new URL(url).host);
}

/** Maps upstream metadata to the established application wire format. No protocol code. */
export class ApplicationUpstream {
  constructor(private core: UpstreamClient, private connection: ConnectionInfo) {}
  async search(query: string, options: { page?: number; mainTag?: number; orderBy?: string; time?: string } = {}): Promise<SearchResult> {
    const raw = await this.core.request('/search', {
      search_query: query, page: String(options.page ?? 1), main_tag: String(options.mainTag ?? 0),
      o: options.orderBy ?? 'mr', t: options.time ?? 'a',
    });
    return normalizeSearchResult(raw as SearchResult);
  }
  async getAlbum(id: string): Promise<Album | null> {
    const raw = await this.core.request('/album', { id });
    if (raw.name === null) return null;
    return {
      id, name: raw.name, images: raw.images, description: raw.description,
      totalViews: raw.total_views, likes: raw.likes, series: raw.series, seriesID: raw.series_id,
      author: raw.author, tags: raw.tags, works: raw.works, actors: raw.actors,
    } as Album;
  }
  async getPhoto(id: string): Promise<Photo | null> {
    const raw = await this.core.request('/chapter', { id });
    if (raw.name === null) return null;
    if (typeof raw.name !== 'string' || !Array.isArray(raw.images) || !raw.images.every(x => typeof x === 'string'))
      throw new JmError('INVALID_RESPONSE', 'Invalid chapter metadata');
    return { id, name: raw.name, images: raw.images.map(name => ({ name, url: new URL(`/media/photos/${id}/${encodeURIComponent(name)}`, this.connection.imageBaseUrl).href })) };
  }
  async getScrambleId(id: string): Promise<number> {
    const template = await this.core.getChapterTemplate(id);
    const match = template.match(/\bscramble_id\s*=\s*['"]?(\d+)['"]?\s*;/);
    if (!match) throw new JmError('INVALID_RESPONSE', 'Chapter template lacks scramble ID');
    return Number(match[1]);
  }
  dispose() { this.core.dispose(); }
}

export async function getClientDataAndCreateClient(baseUrl: string): Promise<ApplicationUpstream> {
  const core = createUpstreamClient({ domains: [baseUrl], retries: 0 });
  try { return new ApplicationUpstream(core, await core.initialize()); }
  catch (error) { core.dispose(); throw error; }
}
