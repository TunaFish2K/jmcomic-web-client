import assert from 'node:assert/strict';
import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, test, vi } from 'vitest';
import { DEFAULT_TRANSLATION_SETTINGS } from '../src/translation/settings';
import { TranslationLayer } from '../src/translation/TranslationLayer';
import { TranslationSettingsDialog } from '../src/translation/TranslationSettingsDialog';
import type { PageTranslationRecord, TranslationSettingsV6 } from '../src/translation/types';

const cacheState = vi.hoisted(() => ({
  stats: vi.fn(),
}));

vi.mock('../src/translation/cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/translation/cache')>()),
  getTranslationCacheStats: cacheState.stats,
}));

const configuredSettings: TranslationSettingsV6 = {
  ...DEFAULT_TRANSLATION_SETTINGS,
  baseUrl: 'https://api.example.test/v1',
  model: 'comic-model',
  apiKey: 'secret',
};

const record: PageTranslationRecord = {
  key: 'translation',
  ocrKey: 'ocr',
  pageKey: 'chapter:page.jpg',
  providerKey: 'provider',
  promptKey: 'prompt',
  promptVersion: 'v1',
  sourceWidth: 1000,
  sourceHeight: 1500,
  pageStatus: 'needs_translation',
  sourceRegionCount: 2,
  skippedRegionCount: 0,
  regions: [
    {
      id: 'wide',
      text: '原文',
      translation: '中文译文',
      score: 0.9,
      polygon: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.2 }, { x: 0.1, y: 0.2 }],
    },
    {
      id: 'vertical',
      text: '縦書き',
      translation: '竖排',
      score: 0.5,
      polygon: [{ x: 0.7, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.7 }, { x: 0.7, y: 0.7 }],
    },
  ],
  updatedAt: 1,
  lastAccessedAt: 1,
};

describe('TranslationSettingsDialog', () => {
  beforeEach(() => {
    cacheState.stats.mockReset().mockResolvedValue({ ocrPages: 3, translatedPages: 2 });
  });

  test('edits every setting, validates, saves, restores prompts, and clears cache', async () => {
    const onSave = vi.fn();
    const onClearCache = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <TranslationSettingsDialog
        open
        settings={configuredSettings}
        busy={false}
        canRetranslate
        onSave={onSave}
        onClearCache={onClearCache}
        onRetranslate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await screen.findByText('2 页译文 / 3 页 OCR');
    const baseUrl = screen.getByLabelText('OpenAI 兼容 API Base URL');
    fireEvent.change(baseUrl, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    assert.ok(screen.getByText('请输入有效的 HTTP(S) Base URL'));

    fireEvent.change(baseUrl, { target: { value: ' https://next.example/v1/ ' } });
    fireEvent.change(screen.getByLabelText('模型'), { target: { value: ' next-model ' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: ' next-key ' } });
    fireEvent.click(screen.getByTitle('显示 API Key'));
    assert.equal(screen.getByLabelText('API Key').getAttribute('type'), 'text');
    fireEvent.click(screen.getByTitle('隐藏 API Key'));

    fireEvent.click(screen.getByRole('button', { name: 'Responses API' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Worker 代理' }));
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[1]);
    fireEvent.change(screen.getByLabelText('预翻译范围'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('LLM 并发'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('switch', { name: '智能跳过拟声词' }));
    fireEvent.click(screen.getByRole('button', { name: '开启' }));
    fireEvent.change(screen.getByLabelText('思考等级'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('翻译风格提示词'), { target: { value: 'custom style' } });
    fireEvent.change(screen.getByLabelText('内容处理（破限）提示词'), { target: { value: 'custom content' } });
    fireEvent.click(screen.getByTitle('恢复默认翻译风格'));
    fireEvent.click(screen.getByTitle('恢复默认内容处理提示词'));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    assert.equal(onSave.mock.calls.length, 1);
    assert.deepEqual(onSave.mock.calls[0][0], {
      ...configuredSettings,
      apiProtocol: 'responses',
      baseUrl: 'https://next.example/v1',
      model: 'next-model',
      apiKey: 'next-key',
      useWorkerProxy: true,
      autoTranslate: true,
      pretranslateRange: 4,
      translationConcurrency: 3,
      reasoningMode: 'on',
      reasoningEffort: 'high',
      smartSkipSoundEffects: false,
    });

    fireEvent.click(screen.getByRole('button', { name: '清除翻译缓存' }));
    await waitFor(() => assert.equal(onClearCache.mock.calls.length, 1));
    assert.ok(screen.getByText('0 页译文 / 0 页 OCR'));

    view.rerender(
      <TranslationSettingsDialog
        open
        settings={{ ...configuredSettings, useWorkerProxy: true, autoTranslate: true, reasoningMode: 'on' }}
        busy
        canRetranslate={false}
        onSave={onSave}
        onClearCache={onClearCache}
        onRetranslate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    assert.ok(screen.getByText('开启表示你信任服务器传输你的API KEY。'));
    assert.equal(screen.getByRole('button', { name: '重新翻译当前页' }).hasAttribute('disabled'), true);
  });

  test('supports all close routes, retranslates, handles cache failure, and renders closed', async () => {
    const onClose = vi.fn();
    const onRetranslate = vi.fn();
    cacheState.stats.mockRejectedValueOnce(new Error('stats failed'));
    const onClearCache = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <TranslationSettingsDialog
        open
        settings={configuredSettings}
        busy={false}
        canRetranslate
        onSave={vi.fn()}
        onClearCache={onClearCache}
        onRetranslate={onRetranslate}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    fireEvent.mouseDown(screen.getByRole('dialog'));
    fireEvent.click(screen.getByTitle('关闭'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '重新翻译当前页' }));
    assert.equal(onClose.mock.calls.length, 5);
    assert.equal(onRetranslate.mock.calls.length, 1);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '清除翻译缓存' }));
      await Promise.resolve();
    });
    assert.equal(screen.getByRole('button', { name: '清除翻译缓存' }).textContent, '清除翻译缓存');

    view.rerender(
      <TranslationSettingsDialog
        open={false}
        settings={configuredSettings}
        busy={false}
        canRetranslate
        onSave={vi.fn()}
        onClearCache={onClearCache}
        onRetranslate={onRetranslate}
        onClose={onClose}
      />,
    );
    assert.equal(screen.queryByRole('dialog'), null);
  });
});

describe('TranslationLayer', () => {
  test('measures translated regions, fits text, toggles source, and cleans observers', async () => {
    const resizeDisconnect = vi.fn();
    const mutationDisconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe = vi.fn(() => this.callback([], this as unknown as ResizeObserver));
      disconnect = resizeDisconnect;
      unobserve = vi.fn();
    });
    vi.stubGlobal('MutationObserver', class {
      constructor(private callback: MutationCallback) {}
      observe = vi.fn(() => this.callback([], this as unknown as MutationObserver));
      disconnect = mutationDisconnect;
      takeRecords = vi.fn(() => []);
    });

    const image = document.createElement('img');
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1000 },
      naturalHeight: { configurable: true, value: 1500 },
    });
    image.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 600, right: 410, bottom: 620, x: 10, y: 20, toJSON() {} });
    const imageRef = { current: image } as React.RefObject<HTMLImageElement>;
    const view = render(<TranslationLayer imageRef={imageRef} record={record} visible />);
    const layer = view.container.firstElementChild as HTMLDivElement;
    layer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 600, right: 400, bottom: 600, x: 0, y: 0, toJSON() {} });
    fireEvent(window, new Event('resize'));

    const [translation] = await screen.findAllByRole('button', { name: '显示日文原文' });
    Object.defineProperties(translation, {
      clientWidth: { configurable: true, value: 120 },
      clientHeight: { configurable: true, value: 80 },
      scrollWidth: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 70 },
    });
    fireEvent.click(translation);
    assert.equal(screen.getByRole('button', { name: '显示中文译文' }).textContent, '原文');
    assert.equal(screen.getAllByRole('button').length, 2);

    view.rerender(<TranslationLayer imageRef={imageRef} record={record} visible={false} />);
    assert.equal(screen.queryAllByRole('button').length, 0);
    view.unmount();
    assert.ok(resizeDisconnect.mock.calls.length > 0);
    assert.ok(mutationDisconnect.mock.calls.length > 0);
  });

  test('does not measure absent or invalid images', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} takeRecords() { return []; } });
    const imageRef = createRef<HTMLImageElement>();
    const view = render(<TranslationLayer imageRef={imageRef} record={record} visible />);
    assert.equal(screen.queryAllByRole('button').length, 0);
    view.unmount();
  });
});
