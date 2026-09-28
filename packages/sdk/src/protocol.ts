import CryptoJS from 'crypto-js';
import { JmError } from './errors.js';

export const INITIAL_VERSION = '2.0.16';
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
export function decodeEnvelope(text: string, stamp: number): Record<string, unknown> {
  let raw = parseJson(text);
  if (typeof raw === 'string') raw = parseJson(raw);
  const envelope = object(raw);
  if (envelope.code !== undefined && ![0, 200].includes(Number(envelope.code)))
    throw new JmError('UPSTREAM', 'Upstream rejected the request', false);
  let data = envelope.data;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    data = parseJson(trimmed.startsWith('{') ? trimmed : decrypt(data, md5(`${stamp}185Hcomic3PAPP7R`)));
    if (typeof data === 'string') data = parseJson(data);
  }
  return object(data);
}
export function headers(stamp: number, version: string, content = false): Headers {
  return new Headers({
    token: md5(`${stamp}${content ? '18comicAPPContent' : '18comicAPP'}`),
    tokenparam: `${stamp},${version}`,
    'user-agent': 'Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 Chrome/91.0.4472.114 Mobile Safari/537.36',
  });
}
export function sliceCount(scrambleId: number, photoId: number, filename: string): number {
  if (photoId < scrambleId || /\.gif$/i.test(filename)) return 0;
  if (photoId < 268850) return 10;
  const hash = md5(`${photoId}${filename.split('.')[0]}`);
  return (hash.charCodeAt(hash.length - 1) % (photoId < 421926 ? 10 : 8)) * 2 + 2;
}
