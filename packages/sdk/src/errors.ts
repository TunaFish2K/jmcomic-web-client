import type { ErrorCode } from './types.js';

export class JmError extends Error {
  readonly name = 'JmError';
  /** Operation context, without URLs, cookies or credentials. */
  operation?: string;
  constructor(public readonly code: ErrorCode, message: string,
    public readonly retryable = false, public readonly requestId?: string,
    options?: ErrorOptions) { super(message, options); }
}
export function abortError(): JmError { return new JmError('ABORTED', 'Request cancelled'); }
export function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
export function asError(error: unknown): JmError {
  if (error instanceof JmError) return error;
  if (error instanceof Error && error.name === 'AbortError') return abortError();
  return new JmError('INTERNAL', 'Operation failed', false, undefined, { cause: error });
}
export function id(value: string): string {
  if (!/^\d{1,16}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new JmError('INVALID_ARGUMENT', 'Expected a safe numeric ID');
  return value;
}
export function integer(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new JmError('INVALID_ARGUMENT', `Invalid ${label}`);
  return value;
}
