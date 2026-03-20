import { getClientDataAndCreateClient, getRandomDomainToBaseURL } from '@tiny-client/shared/client';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
	'Access-Control-Allow-Headers': '*',
};

async function getClient() {
	const domain = await getRandomDomainToBaseURL();
	const client = await getClientDataAndCreateClient(domain);
	console.log('Client created.');
	return client;
}

// Simple router
export default {
	async fetch(request): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			// API Routes
			if (url.pathname === '/search') {
				const query = url.searchParams.get('query');
				if (!query) return new Response("Missing query 'query'", { status: 400, headers: corsHeaders });

				const client = await getClient();

				const result = await client.search(query, {
					page: Number(url.searchParams.get('page')) || 1,
					orderBy: (url.searchParams.get('orderBy') as any) || 'mr',
					time: (url.searchParams.get('time') as any) || 'a',
					mainTag: (Number(url.searchParams.get('mainTag')) as any) || 0,
				});
				return Response.json(result, { headers: corsHeaders });
			}

			if (url.pathname.startsWith('/album/')) {
				const id = url.pathname.split('/').pop();
				if (!id) return new Response('Missing album id', { status: 400, headers: corsHeaders });

				const client = await getClient();

				const result = await client.getAlbum(id);
				if (result === null) return new Response('album not found', { status: 404, headers: corsHeaders });
				return Response.json(result, { headers: corsHeaders });
			}

			if (url.pathname.startsWith('/photo/')) {
				const id = url.pathname.split('/').pop();
				if (!id) return new Response('Missing photo id', { status: 400, headers: corsHeaders });

				const client = await getClient();

				const result = await client.getPhotoWithScrambleId(id);
				if (result === null) return new Response('photo not found', { status: 404, headers: corsHeaders });
				return Response.json(result, { headers: corsHeaders });
			}

			if (url.pathname === '/batch-album') {
				const idsParam = url.searchParams.get('ids');
				if (!idsParam) return new Response("Missing query 'ids'", { status: 400, headers: corsHeaders });

				const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
				if (ids.length === 0) return new Response('Empty ids', { status: 400, headers: corsHeaders });
				if (ids.length > 20) return new Response('Too many ids, max 20', { status: 400, headers: corsHeaders });

				const client = await getClient();

				const results = await Promise.all(
					ids.map(async (albumId) => {
						try {
							// fetch album and photo concurrently
							const [album, photo] = await Promise.all([
								client.getAlbum(albumId),
								client.getPhotoWithScrambleId(albumId),
							]);
							if (album === null || photo === null) {
								return { albumId, album: null, photo: null, error: 'not found' };
							}
							return { albumId, album, photo };
						} catch (e) {
							const err = e as Error;
							return { albumId, album: null, photo: null, error: err.message };
						}
					}),
				);

				return Response.json(results, { headers: corsHeaders });
			}

			return new Response('Not found', { status: 404, headers: corsHeaders });
		} catch (e) {
			const shouldBeError = e as Error;
			console.error('WORKER ERROR:', shouldBeError);
			console.error('STACK:', shouldBeError.stack);
			return new Response(JSON.stringify({ error: shouldBeError.message || 'Internal Error', stack: shouldBeError.stack }), {
				status: 500,
				headers: corsHeaders,
			});
		}
	},
} satisfies ExportedHandler<Env>;
