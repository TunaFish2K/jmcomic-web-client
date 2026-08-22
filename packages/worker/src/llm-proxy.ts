export const LLM_PROXY_TARGET_HEADER = 'X-LLM-Target-URL';
export const LLM_PROXY_MAX_BODY_BYTES = 512 * 1024;
const LLM_PROXY_TIMEOUT_MS = 65_000;

class RequestBodyTooLargeError extends Error {}

function jsonError(message: string, status: number, corsHeaders: Record<string, string>) {
	return Response.json(
		{ error: { message } },
		{
			status,
			headers: {
				...corsHeaders,
				'Cache-Control': 'no-store',
			},
		},
	);
}

function isIpLiteral(hostname: string) {
	const normalized = hostname.replace(/^\[|\]$/g, '');
	if (normalized.includes(':')) return true;
	const parts = normalized.split('.');
	return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isNonPublicHostname(hostname: string) {
	const normalized = hostname.toLowerCase().replace(/\.$/, '');
	if (isIpLiteral(normalized) || !normalized.includes('.')) return true;
	return ['localhost', '.localhost', '.local', '.internal', '.lan', '.home', '.home.arpa', '.invalid', '.test'].some(
		(suffix) => normalized === suffix.replace(/^\./, '') || normalized.endsWith(suffix),
	);
}

function parseTargetUrl(request: Request) {
	const value = request.headers.get(LLM_PROXY_TARGET_HEADER)?.trim();
	if (!value || value.length > 2048) return null;

	try {
		const target = new URL(value);
		const workerUrl = new URL(request.url);
		if (target.protocol !== 'https:') return null;
		if (target.username || target.password || target.search || target.hash) return null;
		if (target.host.toLowerCase() === workerUrl.host.toLowerCase()) return null;
		if (isNonPublicHostname(target.hostname)) return null;
		if (!/(?:\/responses|\/chat\/completions)$/.test(target.pathname)) return null;
		return target;
	} catch {
		return null;
	}
}

async function readRequestBody(request: Request) {
	if (!request.body) return new ArrayBuffer(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > LLM_PROXY_MAX_BODY_BYTES) {
			await reader.cancel();
			throw new RequestBodyTooLargeError();
		}
		chunks.push(value);
	}
	const combined = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return combined.buffer;
}

export async function handleLlmProxyRequest(request: Request, corsHeaders: Record<string, string>, fetchImpl: typeof fetch = fetch) {
	if (request.method !== 'POST') {
		return jsonError('LLM 代理仅接受 POST 请求', 405, corsHeaders);
	}

	const target = parseTargetUrl(request);
	if (!target) {
		return jsonError('LLM 目标地址无效或不受支持', 400, corsHeaders);
	}

	const authorization = request.headers.get('Authorization')?.trim();
	if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) {
		return jsonError('缺少有效的 Bearer Authorization', 401, corsHeaders);
	}

	const contentType = request.headers.get('Content-Type') ?? '';
	if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
		return jsonError('LLM 代理仅接受 application/json', 415, corsHeaders);
	}

	const declaredLength = Number(request.headers.get('Content-Length'));
	if (Number.isFinite(declaredLength) && declaredLength > LLM_PROXY_MAX_BODY_BYTES) {
		return jsonError('LLM 请求正文过大', 413, corsHeaders);
	}
	let body: ArrayBuffer;
	try {
		body = await readRequestBody(request);
	} catch (error) {
		return error instanceof RequestBodyTooLargeError
			? jsonError('LLM 请求正文过大', 413, corsHeaders)
			: jsonError('无法读取 LLM 请求正文', 400, corsHeaders);
	}
	try {
		JSON.parse(new TextDecoder().decode(body));
	} catch {
		return jsonError('LLM 请求正文不是有效的 JSON', 400, corsHeaders);
	}

	let upstream: Response;
	try {
		upstream = await fetchImpl(target, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				Authorization: authorization,
				'Content-Type': 'application/json',
			},
			body,
			redirect: 'manual',
			signal: AbortSignal.any([request.signal, AbortSignal.timeout(LLM_PROXY_TIMEOUT_MS)]),
		});
	} catch {
		return jsonError('LLM 上游连接失败', 502, corsHeaders);
	}

	if (upstream.status >= 300 && upstream.status < 400) {
		return jsonError('LLM 上游返回了不允许的重定向', 502, corsHeaders);
	}

	const responseHeaders = new Headers(corsHeaders);
	responseHeaders.set('Cache-Control', 'no-store');
	responseHeaders.set('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json');
	const retryAfter = upstream.headers.get('Retry-After');
	if (retryAfter) responseHeaders.set('Retry-After', retryAfter);

	return new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
}
