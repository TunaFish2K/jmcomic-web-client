import { getClientDataAndCreateClient, getRandomDomainToBaseURL } from '@tiny-client/shared/client';

// Simple router
export default {
	async fetch(request): Promise<Response> {
		const url = new URL(request.url);

		// CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
			'Access-Control-Allow-Headers': '*',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			/*
			// Initialize client with fastest available domain
			console.log('Starting domain check...');
			const domain = await getFastestAvailableBaseURL();
			console.log('Fastest domain found:', domain);
			*/
			const domain = await getRandomDomainToBaseURL();

			if (!domain) return new Response('No available domain', { status: 503, headers: corsHeaders });

			const client = await getClientDataAndCreateClient(domain);
			console.log('Client created.');

			// API Routes
			if (url.pathname === '/search') {
				const query = url.searchParams.get('query');
				if (!query) return new Response("Missing query 'query'", { status: 400, headers: corsHeaders });

				const result = await client.search(query, {
					page: Number(url.searchParams.get('page')) || 1,
					orderBy: (url.searchParams.get('orderBy') as any) || 'mr',
					time: (url.searchParams.get('time') as any) || 'a',
					mainTag: (Number(url.searchParams.get('mainTag')) as any) || 0,
				});
				return Response.json(result, { headers: corsHeaders });
			}

			if (url.pathname.startsWith('/album')) {
				const id = url.pathname.split('/').pop();
				if (!id) return new Response('Missing album id', { status: 400, headers: corsHeaders });

				const result = await client.getAlbum(id);
				if (result === null) return new Response('album not found', { status: 404, headers: corsHeaders });
				return Response.json(result, { headers: corsHeaders });
			}

			if (url.pathname.startsWith('/photo')) {
				const id = url.pathname.split('/').pop();
				if (!id) return new Response('Missing photo id', { status: 400, headers: corsHeaders });

				const result = await client.getPhotoWithScrambleId(id);
				if (result === null) return new Response('photo not found', { status: 404, headers: corsHeaders });
				return Response.json(result, { headers: corsHeaders });
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
