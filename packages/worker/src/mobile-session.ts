import { JmError } from 'jmcomic-sdk-pwa';
import type { AccountCredentials } from 'jmcomic-sdk-pwa/mobile';

/**
 * Encrypted account session handed to the browser. The Worker keeps no session store:
 * the token itself carries the upstream credentials, sealed with ACCOUNT_SESSION_KEY.
 */
export interface AccountSession extends AccountCredentials { exp: number }

export const SESSION_TTL_MS = 60 * 60 * 1000;
/** "Remember me" sessions; the upstream JWT's own expiry still caps them. */
export const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const VERSION = 'v1';
const AAD = new TextEncoder().encode('jm-account-session-v1');
const keys = new Map<string, Promise<CryptoKey>>();

export class SessionError extends Error {
	constructor(readonly code: 'SESSION_INVALID' | 'SESSION_EXPIRED' | 'ACCOUNT_DISABLED', message: string) {
		super(message);
	}
}

function key(secret: string): Promise<CryptoKey> {
	let pending = keys.get(secret);
	if (!pending) {
		pending = crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
			.then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
		keys.set(secret, pending);
	}
	return pending;
}
function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(value: string): Uint8Array {
	const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** Reads the `exp` claim of an upstream JWT, if it has one. */
export function jwtExpiry(jwt: string): number | null {
	try {
		const payload = JSON.parse(new TextDecoder().decode(fromBase64url(jwt.split('.')[1] ?? '')));
		return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
	} catch {
		return null;
	}
}

export async function sealSession(secret: string, credentials: AccountCredentials, now = Date.now(), ttl = SESSION_TTL_MS): Promise<{ token: string; expiresAt: number }> {
	const upstreamExpiry = jwtExpiry(credentials.jwt);
	const exp = Math.min(now + ttl, upstreamExpiry ?? Infinity);
	if (exp <= now) throw new JmError('INVALID_RESPONSE', 'Upstream session is already expired');
	const session: AccountSession = { uid: credentials.uid, jwt: credentials.jwt, avs: credentials.avs, exp };
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = new Uint8Array(await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: AAD },
		await key(secret),
		new TextEncoder().encode(JSON.stringify(session)),
	));
	const bytes = new Uint8Array(iv.length + sealed.length);
	bytes.set(iv);
	bytes.set(sealed, iv.length);
	return { token: `${VERSION}.${base64url(bytes)}`, expiresAt: exp };
}

export async function openSession(secret: string, token: string, now = Date.now()): Promise<AccountSession> {
	const [version, body, extra] = token.split('.');
	if (version !== VERSION || !body || extra !== undefined || body.length > 8192) throw new SessionError('SESSION_INVALID', 'Invalid session');
	let session: AccountSession;
	try {
		const bytes = fromBase64url(body);
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: AAD },
			await key(secret),
			bytes.slice(12),
		);
		session = JSON.parse(new TextDecoder().decode(plain));
	} catch {
		throw new SessionError('SESSION_INVALID', 'Invalid session');
	}
	if (!/^\d{1,16}$/.test(session.uid) || typeof session.jwt !== 'string' || typeof session.avs !== 'string' || typeof session.exp !== 'number')
		throw new SessionError('SESSION_INVALID', 'Invalid session');
	if (session.exp <= now) throw new SessionError('SESSION_EXPIRED', 'Session expired');
	return session;
}

/** Reads `Authorization: Bearer <session>` and opens it with the deployment's key. */
export async function requireSession(request: Request, secret: string | undefined): Promise<AccountSession> {
	if (!secret) throw new SessionError('ACCOUNT_DISABLED', 'Account features are not configured on this deployment');
	const header = request.headers.get('Authorization') ?? '';
	const match = /^Bearer\s+(\S+)$/.exec(header);
	if (!match) throw new SessionError('SESSION_INVALID', 'Login required');
	return openSession(secret, match[1]!);
}
