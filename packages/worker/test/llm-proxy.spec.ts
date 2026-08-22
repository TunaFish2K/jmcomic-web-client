import { describe, expect, it } from 'vitest';
import { handleLlmProxyRequest, LLM_PROXY_MAX_BODY_BYTES, LLM_PROXY_TARGET_HEADER } from '../src/llm-proxy';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
};

function createRequest(target: string, init?: RequestInit) {
	const headers = new Headers({
		Authorization: 'Bearer secret-key',
		'Content-Type': 'application/json',
		[LLM_PROXY_TARGET_HEADER]: target,
	});
	for (const [name, value] of new Headers(init?.headers)) {
		headers.set(name, value);
	}
	return new Request('https://worker.example.com/llm-proxy', {
		...init,
		method: init?.method ?? 'POST',
		headers,
		body: init?.body ?? JSON.stringify({ model: 'translator' }),
	});
}

describe('LLM proxy', () => {
	it('forwards a valid request and returns the upstream JSON response', async () => {
		let upstreamUrl = '';
		let upstreamInit: RequestInit | undefined;
		const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
			upstreamUrl = String(input);
			upstreamInit = init;
			return Response.json(
				{ output_text: 'translated' },
				{
					status: 200,
					headers: { 'Retry-After': '3' },
				},
			);
		}) as typeof fetch;

		const response = await handleLlmProxyRequest(createRequest('https://api.example.com/v1/responses'), corsHeaders, fetchImpl);

		expect(upstreamUrl).toBe('https://api.example.com/v1/responses');
		expect(upstreamInit?.method).toBe('POST');
		expect(upstreamInit?.redirect).toBe('manual');
		expect(new Headers(upstreamInit?.headers).get('Authorization')).toBe('Bearer secret-key');
		expect(new Headers(upstreamInit?.headers).has(LLM_PROXY_TARGET_HEADER)).toBe(false);
		expect(JSON.parse(new TextDecoder().decode(upstreamInit?.body as ArrayBuffer))).toEqual({ model: 'translator' });
		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(response.headers.get('Retry-After')).toBe('3');
		expect(await response.json()).toEqual({ output_text: 'translated' });
	});

	it.each([
		'http://api.example.com/v1/responses',
		'https://localhost/v1/responses',
		'https://127.0.0.1/v1/responses',
		'https://[::1]/v1/responses',
		'https://service.internal/v1/responses',
		'https://worker.example.com/v1/responses',
		'https://user:password@api.example.com/v1/responses',
		'https://api.example.com/v1/responses?api-version=1',
		'https://api.example.com/v1/models',
	])('rejects an unsafe or unsupported target: %s', async (target) => {
		const response = await handleLlmProxyRequest(createRequest(target), corsHeaders);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { message: 'LLM 目标地址无效或不受支持' },
		});
	});

	it('rejects requests without Bearer authorization', async () => {
		const request = createRequest('https://api.example.com/v1/chat/completions', {
			headers: { Authorization: '' },
		});
		const response = await handleLlmProxyRequest(request, corsHeaders);
		expect(response.status).toBe(401);
	});

	it('rejects non-JSON and oversized request bodies', async () => {
		const nonJson = createRequest('https://api.example.com/v1/responses', {
			headers: { 'Content-Type': 'text/plain' },
		});
		expect((await handleLlmProxyRequest(nonJson, corsHeaders)).status).toBe(415);
		const malformedJson = createRequest('https://api.example.com/v1/responses', {
			body: '{broken',
		});
		expect((await handleLlmProxyRequest(malformedJson, corsHeaders)).status).toBe(400);

		const oversized = createRequest('https://api.example.com/v1/responses', {
			body: 'x'.repeat(LLM_PROXY_MAX_BODY_BYTES + 1),
		});
		expect((await handleLlmProxyRequest(oversized, corsHeaders)).status).toBe(413);
	});

	it('does not follow or expose upstream redirects', async () => {
		const fetchImpl = (async () =>
			new Response(null, {
				status: 307,
				headers: { Location: 'https://other.example.com/v1/responses' },
			})) as typeof fetch;
		const response = await handleLlmProxyRequest(createRequest('https://api.example.com/v1/responses'), corsHeaders, fetchImpl);
		expect(response.status).toBe(502);
		expect(response.headers.has('Location')).toBe(false);
	});
});
