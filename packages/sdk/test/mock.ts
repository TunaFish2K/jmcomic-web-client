import type { Fetch } from '../src/types.js';
export function mockUpstream(image: Uint8Array, options: { waitMs?: number; onRequest?: (url: URL, init?: RequestInit) => void } = {}): Fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    options.onRequest?.(url, init);
    if (options.waitMs) await new Promise<void>((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { init?.signal?.removeEventListener('abort', cancel); resolve(); }, options.waitMs);
      if (init?.signal?.aborted) cancel(); else init?.signal?.addEventListener('abort', cancel, { once: true });
    });
    const json = (data: unknown) => new Response(JSON.stringify({ code: 200, data: JSON.stringify(data) }), { headers: { 'set-cookie': 'sid=mock; Path=/; HttpOnly' } });
    if (url.pathname === '/setting') return json({ version: '2.0.16', img_host: 'https://images.test' });
    if (url.pathname === '/search') return json({ total: '1', content: [{ id: 123, name: 'Fixture album', author: ['Author'] }] });
    if (url.pathname === '/album') return json({ id: 123, name: url.searchParams.get('id') === '404' ? null : 'Fixture album', description: 'Synthetic', total_views: '1,234', likes: '5', author: ['Author'], tags: ['tag'], series: [{ id: '123', name: 'Chapter', sort: '1' }] });
    if (url.pathname === '/chapter') return json({ name: 'Chapter', images: ['00001.png'] });
    if (url.pathname === '/chapter_view_template') return new Response('var scramble_id = 1;');
    if (url.pathname === '/media/photos/123/00001.png') return new Response(image.slice().buffer as ArrayBuffer, { headers: { 'content-type': 'image/png' } });
    return new Response('missing', { status: 404 });
  }) as Fetch;
}
