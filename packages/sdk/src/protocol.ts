import CryptoJS from 'crypto-js';
import { JmError } from './errors.js';

export const INITIAL_VERSION = '2.0.16';
/** Version and signing secret used by the official app's account and discovery calls (APK 2.1.9). */
export const APP_VERSION = '2.1.9';
const APP_SECRET = '185Hcomic3PAPP7R';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/91.0.4472.114 Mobile Safari/537.36';
export const DISCOVERY = [
  'https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt',
  'https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt',
];
export const md5 = (text: string): string => CryptoJS.MD5(text).toString();
export function decrypt(text: string, key: string): string {
  try {
    const data = CryptoJS.AES.decrypt(text, CryptoJS.enc.Utf8.parse(key), {
      mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.NoPadding,
    });
    const count = data.sigBytes;
    const bytes = new Uint8Array(count);
    for (let i = 0; i < count; i++) bytes[i] = (data.words[i >>> 2]! >>> (24 - (i % 4) * 8)) & 255;
    const pad = bytes[count - 1] ?? 0;
    const padded = pad > 0 && pad <= 16 && bytes.subarray(count - pad).every(x => x === pad);
    return new TextDecoder('utf-8', { fatal: true }).decode(padded ? bytes.subarray(0, count - pad) : bytes).replace(/\0+$/, '');
  } catch (cause) { throw new JmError('INVALID_RESPONSE', 'Invalid encrypted upstream response', true, undefined, { cause }); }
}
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new JmError('INVALID_RESPONSE', 'Expected an upstream object', true);
  return value as Record<string, unknown>;
}
export function parseJson(text: string): unknown {
  try { return JSON.parse(text); }
  catch { throw new JmError('INVALID_RESPONSE', 'Invalid upstream JSON', true); }
}
/** Upstream business message, trimmed so it can be shown without leaking large payloads. */
function upstreamMessage(envelope: Record<string, unknown>): string {
  const message = envelope.errorMsg ?? envelope.message;
  return typeof message === 'string' ? message.trim().slice(0, 200) : '';
}
/** Decodes an upstream envelope whose data may be any JSON value, such as a list. */
export function decodeData(text: string, stamp: number): unknown {
  let raw = parseJson(text);
  if (typeof raw === 'string') raw = parseJson(raw);
  const envelope = object(raw);
  if (envelope.code !== undefined && ![0, 200].includes(Number(envelope.code))) {
    const message = upstreamMessage(envelope);
    throw new JmError(Number(envelope.code) === 401 ? 'UNAUTHORIZED' : 'UPSTREAM',
      message ? `Upstream rejected the request: ${message}` : 'Upstream rejected the request', false);
  }
  let data = envelope.data;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) return null;
    data = parseJson(/^[[{]/.test(trimmed) ? trimmed : decrypt(data, md5(`${stamp}${APP_SECRET}`)));
    if (typeof data === 'string') data = parseJson(data);
  }
  return data;
}
export function decodeEnvelope(text: string, stamp: number): Record<string, unknown> {
  return object(decodeData(text, stamp));
}
export function headers(stamp: number, version: string, content = false): Headers {
  return new Headers({
    token: md5(`${stamp}${content ? '18comicAPPContent' : '18comicAPP'}`),
    tokenparam: `${stamp},${version}`,
    'user-agent': USER_AGENT,
  });
}
/** Headers signed the way APK 2.1.9 signs every API call. */
export function appHeaders(stamp: number): Headers {
  return new Headers({ token: md5(`${stamp}${APP_SECRET}`), tokenparam: `${stamp},${APP_VERSION}`, 'user-agent': USER_AGENT });
}
export function sliceCount(scrambleId: number, photoId: number, filename: string): number {
  if (photoId < scrambleId || /\.gif$/i.test(filename)) return 0;
  if (photoId < 268850) return 10;
  const hash = md5(`${photoId}${filename.split('.')[0]}`);
  return (hash.charCodeAt(hash.length - 1) % (photoId < 421926 ? 10 : 8)) * 2 + 2;
}
