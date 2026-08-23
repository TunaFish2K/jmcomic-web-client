// @vitest-environment node

import assert from 'node:assert/strict';
import { afterEach, describe, test, vi } from 'vitest';
import { parseTranslationResponse, translateOcrRegions } from '../src/translation/llm';
import type { OcrRegion, TranslationSettingsV6 } from '../src/translation/types';

const settings: TranslationSettingsV6 = {
  version: 6,
  apiProtocol: 'chat-completions',
  baseUrl: 'https://api.test/v1',
  model: 'model',
  apiKey: 'key',
  useWorkerProxy: false,
  autoTranslate: false,
  pretranslateRange: 1,
  translationConcurrency: 1,
  reasoningMode: 'off',
  reasoningEffort: 'medium',
  smartSkipSoundEffects: true,
  translationStylePrompt: 'style',
  contentHandlingPrompt: 'content',
};
const regions: OcrRegion[] = [{
  id: 'r1',
  text: '今日は日本語を翻訳します',
  score: 0.91234,
  polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
}];

function successContent(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function expectCode(promise: Promise<unknown>, code: string, message: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    const value = error as { code?: string; message?: string };
    return value.code === code && message.test(value.message ?? '');
  });
}

describe('translation LLM errors', () => {
  afterEach(() => vi.useRealTimers());

  test('rejects malformed translation entries with actionable protocol errors', () => {
    const cases: Array<[string, RegExp]> = [
      ['not json', /有效的 JSON/],
      ['{}', /缺少 translations/],
      ['{"pageStatus":"needs_translation","translations":{}}', /不是数组/],
      ['{"pageStatus":"needs_translation","translations":[null]}', /无效的译文条目/],
      ['{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"translate","translation":"  "}]}', /空译文/],
      ['{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"other"}]}', /无效的处理动作/],
      ['{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"skip","reason":"other"}]}', /无效的跳过原因/],
    ];
    for (const [content, message] of cases) {
      assert.throws(() => parseTranslationResponse(content, ['r1'], true), message);
    }
  });

  test('maps authorization, rate limit, and generic HTTP response bodies', async () => {
    await expectCode(translateOcrRegions({
      settings, regions,
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: ' bad key ' } }), { status: 401 }),
    }), 'unauthorized', /bad key/);
    await expectCode(translateOcrRegions({
      settings, regions,
      fetchImpl: async () => new Response(JSON.stringify({ message: 'quota' }), { status: 429 }),
    }), 'rate-limit', /quota/);
    await expectCode(translateOcrRegions({
      settings, regions,
      fetchImpl: async () => new Response('not-json', { status: 503 }),
    }), 'http', /HTTP 503/);
  });

  test('rejects invalid successful JSON and missing Chat Completions content', async () => {
    await expectCode(translateOcrRegions({
      settings, regions,
      fetchImpl: async () => new Response('not-json', { status: 200 }),
    }), 'invalid-response', /不是 JSON/);
    await expectCode(translateOcrRegions({
      settings, regions,
      fetchImpl: async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    }), 'invalid-response', /choices/);
  });

  test('supports Responses output_text and rejects unusable nested outputs', async () => {
    const content = '{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"translate","translation":"中文"}]}';
    const outputText = await translateOcrRegions({
      settings: { ...settings, apiProtocol: 'responses', reasoningMode: 'provider-default' },
      regions,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: content }), { status: 200 }),
    });
    assert.equal(outputText.decisions.get('r1')?.action, 'translate');

    const nested = await translateOcrRegions({
      settings: { ...settings, apiProtocol: 'responses' }, regions,
      fetchImpl: async () => new Response(JSON.stringify({
        output: [null, {}, { content: 'wrong' }, { content: [null, {}, { type: 'other', text: content }, { type: 'output_text', text: content }] }],
      }), { status: 200 }),
    });
    assert.equal(nested.pageStatus, 'needs_translation');
    await expectCode(translateOcrRegions({
      settings: { ...settings, apiProtocol: 'responses' }, regions,
      fetchImpl: async () => new Response(JSON.stringify({ output: [{ content: [] }] }), { status: 200 }),
    }), 'invalid-response', /缺少输出文本/);
  });

  test('distinguishes CORS-like, generic network, and timeout failures', async () => {
    await expectCode(translateOcrRegions({
      settings, regions,
      fetchImpl: async () => { throw new TypeError('fetch failed'); },
    }), 'network', /CORS/);
    await expectCode(translateOcrRegions({
      settings, regions,
      fetchImpl: async () => { throw new Error('socket'); },
    }), 'network', /网络请求失败/);

    vi.useFakeTimers();
    const timedOut = translateOcrRegions({
      settings,
      regions,
      fetchImpl: async (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    });
    const timeoutAssertion = expectCode(timedOut, 'timeout', /超时/);
    await vi.advanceTimersByTimeAsync(60_000);
    await timeoutAssertion;
  });

  test('returns an empty decision map without making a request', async () => {
    const fetchImpl = vi.fn();
    const output = await translateOcrRegions({ settings, regions: [], fetchImpl });
    assert.equal(output.decisions.size, 0);
    assert.equal(fetchImpl.mock.calls.length, 0);
    const translated = await translateOcrRegions({
      settings, regions,
      fetchImpl: async () => successContent('{"pageStatus":"needs_translation","translations":[{"id":"r1","action":"translate","translation":"  中文  "}]}'),
    });
    assert.deepEqual(translated.decisions.get('r1'), { action: 'translate', translation: '中文' });
  });
});
