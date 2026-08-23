import assert from 'node:assert/strict';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, test, vi } from 'vitest';

const cacheMocks = vi.hoisted(() => ({ getCacheStats: vi.fn(), clearAllCache: vi.fn() }));
vi.mock('@tiny-client/shared', () => cacheMocks);
vi.mock('../src/theme/ThemeControls', () => ({
  ThemePanel: ({ tone }: { tone: string }) => <div data-testid="theme-panel">{tone}</div>,
}));
vi.mock('../src/translation/TranslationLayer', () => ({
  ReaderTranslatedImage: ({ record, translationVisible, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { record: unknown; translationVisible: boolean }) => (
    <img
      alt=""
      data-has-record={String(record !== null)}
      data-translation-visible={String(translationVisible)}
      {...props}
    />
  ),
}));

import { ChapterTransitionOverlay } from '../src/reader/ChapterTransitionOverlay';
import { ReaderLoadingView } from '../src/reader/ReaderLoadingView';
import { ReaderOverlay } from '../src/reader/ReaderOverlay';
import { ReaderPageCanvas } from '../src/reader/ReaderPageCanvas';
import {
  parseSeriesOrder,
  restoreZoomElementStyle,
  saveZoomElementStyle,
  toZoomRect,
} from '../src/reader/reader-types';

function callbacks() {
  return {
    onToggleVisibility: vi.fn(),
    onClose: vi.fn(),
    onPrevChapter: vi.fn(),
    onNextChapter: vi.fn(),
    onGoToChapter: vi.fn(),
    onToggleDirection: vi.fn(),
    onToggleAutoSnap: vi.fn(),
    onToggleSeamlessMode: vi.fn(),
    onChangeLazyRenderRange: vi.fn(),
    onToggleBarVisible: vi.fn(),
    onResetZoom: vi.fn(),
    onTranslationAction: vi.fn(),
    onToggleAutoTranslation: vi.fn(),
    onToggleTranslation: vi.fn(),
    onOpenTranslationSettings: vi.fn(),
    onScrollByInputStep: vi.fn(),
    onSeekPage: vi.fn(),
  };
}

type OverlayProps = React.ComponentProps<typeof ReaderOverlay>;

function overlayProps(overrides: Partial<OverlayProps> = {}): OverlayProps {
  return {
    visible: true,
    title: 'Album title',
    currentPage: 2,
    totalPages: 10,
    chapterName: 'Chapter two',
    chapters: [
      { id: '1', name: 'One', order: 1 },
      { id: '2', name: 'Two', order: 2 },
    ],
    currentChapterId: '2',
    chapterProgress: { '1': { page: 2, totalPages: 8 } },
    direction: 'top-down',
    hasPrevChapter: true,
    hasNextChapter: true,
    hint: null,
    boundaryToast: null,
    autoSnap: false,
    seamlessMode: true,
    lazyRenderRange: 4,
    barSide: 'bottom',
    barVisible: true,
    isZoomed: false,
    externalDialogOpen: false,
    translationConfigured: true,
    translationAutoMode: false,
    translationAutoActive: false,
    translationBusy: false,
    translationProcessed: false,
    translationHasResult: false,
    translationVisible: false,
    ...callbacks(),
    ...overrides,
  };
}

describe('reader overlay controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cacheMocks.getCacheStats.mockReset().mockResolvedValue({ count: 3, totalSize: 2 * 1024 * 1024 });
    cacheMocks.clearAllCache.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => { callback(0); return 1; },
    });
    class TestPointerEvent extends MouseEvent {
      isPrimary: boolean;
      pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? false;
        this.pointerId = init.pointerId ?? 0;
      }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders accessible bars and handles global keyboard navigation', () => {
    const props = overlayProps({ isZoomed: true });
    const view = render(<ReaderOverlay {...props} />);
    assert.ok(screen.getByText('Album title'));
    assert.ok(screen.getByText('Chapter two'));
    assert.equal(screen.getByRole('slider', { name: '阅读进度' }).getAttribute('aria-valuenow'), '3');

    fireEvent.click(screen.getByRole('button', { name: '上一章' }));
    fireEvent.click(screen.getByRole('button', { name: '下一章' }));
    fireEvent.click(screen.getByRole('button', { name: '重置缩放' }));
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(window, { key: 'F' });
    fireEvent.keyDown(window, { key: 'Escape' });
    assert.deepEqual(props.onScrollByInputStep.mock.calls.map((call) => call[0]), [-1, 1]);
    assert.equal(props.onToggleVisibility.mock.calls.length, 2);
    assert.equal(props.onPrevChapter.mock.calls.length, 1);
    assert.equal(props.onNextChapter.mock.calls.length, 1);
    assert.equal(props.onResetZoom.mock.calls.length, 1);
    assert.equal(props.onClose.mock.calls.length, 1);

    view.rerender(<ReaderOverlay {...props} visible={false} externalDialogOpen />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Escape' });
    assert.equal(props.onScrollByInputStep.mock.calls.length, 2);
    assert.equal(props.onClose.mock.calls.length, 1);
  });

  test('opens the chapter dialog, traps focus, navigates, and restores trigger focus', () => {
    const props = overlayProps();
    render(<ReaderOverlay {...props} />);
    const trigger = screen.getByRole('button', { name: '打开章节列表' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: /章节列表/ });
    assert.equal(document.activeElement?.textContent?.includes('Two'), true);
    assert.ok(screen.getByText('已读 3/8'));
    fireEvent.keyDown(dialog, { key: 'x' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    assert.equal(props.onScrollByInputStep.mock.calls.length, 0);

    const close = screen.getByRole('button', { name: '关闭章节列表' });
    const enabledButtons = [...dialog.querySelectorAll('button')];
    for (const button of enabledButtons) button.disabled = true;
    fireEvent.keyDown(dialog, { key: 'Tab' });
    for (const button of enabledButtons) button.disabled = false;
    close.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    assert.notEqual(document.activeElement, close);
    fireEvent.keyDown(window, { key: 'Escape' });
    assert.equal(screen.queryByRole('dialog', { name: /章节列表/ }), null);
    assert.equal(document.activeElement, trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /1\. One/ }));
    assert.deepEqual(props.onGoToChapter.mock.calls[0], ['1']);
    assert.equal(screen.queryByRole('dialog', { name: /章节列表/ }), null);
  });

  test('focuses the chapter close button when the current chapter is absent', () => {
    render(<ReaderOverlay {...overlayProps({ currentChapterId: 'missing' })} />);
    fireEvent.click(screen.getByRole('button', { name: '打开章节列表' }));
    assert.equal(document.activeElement, screen.getByRole('button', { name: '关闭章节列表' }));
  });

  test('closes the chapter drawer through its backdrop and cycles forward focus', () => {
    render(<ReaderOverlay {...overlayProps()} />);
    fireEvent.click(screen.getByRole('button', { name: '打开章节列表' }));
    const dialog = screen.getByRole('dialog', { name: /章节列表/ });
    const buttons = dialog.querySelectorAll('button');
    const last = buttons[buttons.length - 1] as HTMLButtonElement;
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    assert.equal(document.activeElement, buttons[0]);
    fireEvent.click(dialog.parentElement!);
    assert.equal(screen.queryByRole('dialog', { name: /章节列表/ }), null);
  });

  test('operates every setting and clears cache', async () => {
    cacheMocks.getCacheStats
      .mockResolvedValueOnce({ count: 3, totalSize: 2 * 1024 * 1024 })
      .mockResolvedValueOnce({ count: 0, totalSize: 0 });
    const props = overlayProps();
    render(<ReaderOverlay {...props} />);
    const trigger = screen.getByRole('button', { name: '打开阅读设置' });
    fireEvent.click(trigger);
    screen.getByRole('dialog', { name: '阅读设置' });
    assert.equal(document.activeElement, screen.getByRole('button', { name: '关闭阅读设置' }));
    assert.equal(screen.getByRole('switch', { name: '自动吸附' }).getAttribute('aria-checked'), 'false');
    assert.equal(screen.getByRole('switch', { name: '无缝模式' }).getAttribute('aria-checked'), 'true');
    assert.ok(screen.getByTestId('theme-panel'));

    fireEvent.click(screen.getByRole('button', { name: /切换阅读方向/ }));
    fireEvent.click(screen.getByRole('switch', { name: '自动吸附' }));
    fireEvent.click(screen.getByRole('switch', { name: '无缝模式' }));
    fireEvent.click(screen.getByRole('switch', { name: '显示信息栏' }));
    fireEvent.change(screen.getByRole('slider', { name: '预取页数' }), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /翻译配置/ }));
    assert.equal(props.onToggleDirection.mock.calls.length, 1);
    assert.equal(props.onToggleAutoSnap.mock.calls.length, 1);
    assert.equal(props.onToggleSeamlessMode.mock.calls.length, 1);
    assert.equal(props.onToggleBarVisible.mock.calls.length, 1);
    assert.deepEqual(props.onChangeLazyRenderRange.mock.calls[0], [7]);
    assert.equal(props.onOpenTranslationSettings.mock.calls.length, 1);

    fireEvent.click(trigger);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '清除' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.ok(screen.getByText('0.0MB (0张)'));
    assert.equal(cacheMocks.clearAllCache.mock.calls.length, 1);
    fireEvent.click(screen.getByRole('button', { name: '关闭阅读设置' }));
    assert.equal(document.activeElement, trigger);
  });

  test('closes settings from backdrop and Escape while preserving inner clicks', () => {
    const props = overlayProps({ translationConfigured: false, direction: 'left-right' });
    render(<ReaderOverlay {...props} />);
    const trigger = screen.getByRole('button', { name: '打开阅读设置' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: '阅读设置' });
    assert.ok(screen.getByRole('button', { name: /左右滚动/ }));
    assert.ok(screen.getByRole('button', { name: /配置 LLM/ }));
    fireEvent.click(dialog);
    assert.ok(screen.getByRole('dialog', { name: '阅读设置' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    assert.equal(screen.queryByRole('dialog', { name: '阅读设置' }), null);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('dialog', { name: '阅读设置' }).parentElement!);
    assert.equal(screen.queryByRole('dialog', { name: '阅读设置' }), null);
  });

  test('routes all translation control states to the correct callback', () => {
    const props = overlayProps();
    const view = render(<ReaderOverlay {...props} translationAutoMode translationAutoActive translationBusy />);
    fireEvent.click(screen.getByRole('button', { name: '正在自动翻译，点击暂停' }));
    assert.equal(props.onToggleAutoTranslation.mock.calls.length, 1);

    view.rerender(<ReaderOverlay {...props} translationAutoMode translationAutoActive />);
    assert.ok(screen.getByRole('button', { name: '暂停自动翻译' }));

    view.rerender(<ReaderOverlay {...props} translationAutoMode translationAutoActive={false} />);
    fireEvent.click(screen.getByRole('button', { name: '继续自动翻译' }));
    assert.equal(props.onToggleAutoTranslation.mock.calls.length, 2);

    view.rerender(<ReaderOverlay {...props} translationHasResult translationVisible />);
    fireEvent.click(screen.getByRole('button', { name: '隐藏本页译文' }));
    assert.equal(props.onToggleTranslation.mock.calls.length, 1);
    view.rerender(<ReaderOverlay {...props} translationHasResult translationVisible={false} />);
    assert.ok(screen.getByRole('button', { name: '显示本页译文' }));

    view.rerender(<ReaderOverlay {...props} translationBusy />);
    assert.equal((screen.getByRole('button', { name: '正在翻译' }) as HTMLButtonElement).disabled, true);
    view.rerender(<ReaderOverlay {...props} translationProcessed />);
    assert.equal((screen.getByRole('button', { name: '本页未识别到文本' }) as HTMLButtonElement).disabled, true);
    view.rerender(<ReaderOverlay {...props} translationConfigured={false} />);
    fireEvent.click(screen.getByRole('button', { name: '配置漫画翻译' }));
    assert.equal(props.onTranslationAction.mock.calls.length, 1);
    view.rerender(<ReaderOverlay {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '翻译当前页' }));
    assert.equal(props.onTranslationAction.mock.calls.length, 2);
  });

  test('shows boundary pull hints and terminal toasts in both directions', () => {
    const view = render(<ReaderOverlay {...overlayProps({
      hint: { dir: 'prev', progress: 0.5, chapterName: 'Previous' },
      direction: 'top-down',
    })} />);
    assert.ok(screen.getByText('上一章'));
    assert.ok(screen.getByText('继续向下拉进入'));
    view.rerender(<ReaderOverlay {...overlayProps({
      hint: { dir: 'next', progress: 0.25, chapterName: 'Next vertical' },
      direction: 'top-down',
    })} />);
    assert.ok(screen.getByText('继续向上拉进入'));
    view.rerender(<ReaderOverlay {...overlayProps({
      hint: { dir: 'prev', progress: 0.75, chapterName: 'Previous horizontal' },
      direction: 'left-right',
    })} />);
    assert.ok(screen.getByText('继续向右拉进入'));
    view.rerender(<ReaderOverlay {...overlayProps({
      hint: { dir: 'next', progress: 1, chapterName: 'Next' },
      direction: 'left-right',
    })} />);
    assert.ok(screen.getByText('继续向左拉进入'));
    view.rerender(<ReaderOverlay {...overlayProps({ boundaryToast: 'prev' })} />);
    assert.ok(screen.getByText('没有上一章了'));
    view.rerender(<ReaderOverlay {...overlayProps({ boundaryToast: 'next' })} />);
    assert.ok(screen.getByText('没有下一章了'));
  });

  test('previews and commits horizontal pointer and keyboard seek gestures', async () => {
    const props = overlayProps();
    render(<ReaderOverlay {...props} />);
    const slider = screen.getByRole('slider', { name: '阅读进度' });
    Object.defineProperty(slider, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 10, top: 20, width: 100, height: 8, right: 110, bottom: 28, x: 10, y: 20, toJSON() {} }),
    });
    fireEvent.pointerDown(slider, { isPrimary: false, pointerId: 1, clientX: 60, clientY: 20 });
    fireEvent.pointerMove(slider, { isPrimary: true, pointerId: 1, clientX: 60, clientY: 20 });
    assert.equal(props.onSeekPage.mock.calls.length, 0);
    fireEvent.pointerDown(slider, { isPrimary: true, pointerId: 1, clientX: 60, clientY: 20 });
    fireEvent.pointerMove(slider, { isPrimary: true, pointerId: 1, clientX: 110, clientY: 20 });
    fireEvent.pointerMove(slider, { isPrimary: true, pointerId: 1, clientX: 110, clientY: 20 });
    fireEvent.pointerUp(slider, { isPrimary: true, pointerId: 1, clientX: 110, clientY: 20 });
    assert.deepEqual(props.onSeekPage.mock.calls[0], [9]);

    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyDown(slider, { key: 'Escape' });
    assert.deepEqual(props.onSeekPage.mock.calls[1], [0]);
    assert.deepEqual(props.onSeekPage.mock.calls[2], [9]);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    assert.equal(slider.getAttribute('aria-valuenow'), '3');
  });

  test('supports vertical seek, cancellation, one-page chapters, and hidden bars', () => {
    const props = overlayProps({ barSide: 'right', direction: 'left-right' });
    const view = render(<ReaderOverlay {...props} />);
    const slider = screen.getByRole('slider', { name: '阅读进度' });
    assert.equal(slider.getAttribute('aria-orientation'), 'vertical');
    Object.defineProperty(slider, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 10, width: 8, height: 100, right: 8, bottom: 110, x: 0, y: 10, toJSON() {} }),
    });
    fireEvent.pointerDown(slider, { isPrimary: true, pointerId: 2, clientX: 0, clientY: -10 });
    fireEvent.pointerCancel(slider, { pointerId: 2 });
    assert.equal(props.onSeekPage.mock.calls.length, 0);
    fireEvent.pointerDown(slider, { isPrimary: true, pointerId: 2, clientX: 0, clientY: 200 });
    fireEvent.pointerUp(slider, { isPrimary: false, pointerId: 2, clientX: 0, clientY: 200 });
    fireEvent.pointerUp(slider, { isPrimary: true, pointerId: 2, clientX: 0, clientY: 200 });
    assert.deepEqual(props.onSeekPage.mock.calls[0], [9]);

    fireEvent.pointerDown(slider, { isPrimary: true, pointerId: 4, clientX: 0, clientY: 50 });
    view.rerender(<ReaderOverlay {...props} totalPages={1} barSide="left" />);
    const onePageSlider = screen.getByRole('slider', { name: '阅读进度' });
    fireEvent.pointerMove(onePageSlider, { isPrimary: true, pointerId: 4, clientX: 0, clientY: 50 });
    fireEvent.pointerCancel(onePageSlider, { pointerId: 4 });
    fireEvent.pointerDown(onePageSlider, { isPrimary: true, pointerId: 3 });
    assert.equal(props.onSeekPage.mock.calls.length, 1);
    view.rerender(<ReaderOverlay {...props} barVisible={false} />);
    assert.equal(screen.queryByRole('slider', { name: '阅读进度' }), null);
  });
});

describe('reader canvas and transition views', () => {
  test('renders resident, loading, idle, and failed pages', () => {
    const containerRef = { current: null };
    const onClick = vi.fn();
    const onImageLoad = vi.fn();
    const onRetryPage = vi.fn();
    const view = render(<ReaderPageCanvas
      containerRef={containerRef}
      images={[
        { name: 'a.jpg', url: 'a' },
        { name: 'b.jpg', url: 'b' },
        { name: 'c.jpg', url: 'c' },
        { name: 'd.jpg', url: 'd' },
      ] as never}
      blobMap={new Map([[0, 'blob:a']])}
      loadingPages={new Set([1, 3])}
      failedPages={new Set([3])}
      pageAspectRatios={new Map([[0, 0.5]])}
      direction="top-down"
      seamlessMode
      snapEnabled={false}
      imgCls="page-image"
      chapterId="chapter"
      scrollDivStyle={{ overflow: 'auto' }}
      currentPage={0}
      translationRecord={{ status: 'ready' } as never}
      translationVisible
      onClick={onClick}
      onImageLoad={onImageLoad}
      onRetryPage={onRetryPage}
    />);
    assert.equal(view.container.querySelectorAll('[data-reader-page]').length, 4);
    const image = view.container.querySelector('img')!;
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 800 });
    fireEvent.load(image);
    assert.deepEqual(onImageLoad.mock.calls[0].slice(0, 2), ['chapter', 0]);
    fireEvent.click(screen.getByRole('button', { name: '重新加载第 4 页' }));
    assert.deepEqual(onRetryPage.mock.calls[0], [3]);
    assert.equal(onClick.mock.calls.length, 0);
    fireEvent.click(view.container.firstElementChild!);
    assert.equal(onClick.mock.calls.length, 1);
  });

  test('renders loading and both transition opacity states', () => {
    const view = render(<ReaderLoadingView />);
    assert.ok(screen.getByText('加载中...'));
    view.rerender(<ChapterTransitionOverlay snapshot={null} transitioning={false} />);
    assert.equal(view.container.firstElementChild, null);
    view.rerender(<ChapterTransitionOverlay snapshot={{ url: 'blob:snapshot', w: 10, h: 20 }} transitioning />);
    assert.match(view.container.firstElementChild?.className ?? '', /opacity-100/);
    assert.equal(view.container.querySelector('img')?.style.width, 'auto');
    view.rerender(<ChapterTransitionOverlay snapshot={{ url: 'blob:snapshot', w: 0, h: 20 }} transitioning={false} />);
    assert.match(view.container.firstElementChild?.className ?? '', /opacity-0/);
    assert.equal(view.container.querySelector('img')?.style.width, '');
  });
});

describe('reader type utilities', () => {
  test('normalizes series order and snapshots/restores zoom styles', () => {
    assert.equal(parseSeriesOrder(3), 3);
    assert.equal(parseSeriesOrder(Number.NaN), Number.MAX_SAFE_INTEGER);
    assert.equal(parseSeriesOrder('12'), 12);
    assert.equal(parseSeriesOrder(undefined), Number.MAX_SAFE_INTEGER);
    const rect = toZoomRect({ left: 1, top: 2, width: 3, height: 4 } as DOMRect);
    assert.deepEqual(rect, { left: 1, top: 2, width: 3, height: 4 });

    const element = document.createElement('div');
    element.style.cssText = 'transform: scale(2); transform-origin: 1px 2px; will-change: transform; position: absolute; z-index: 4; width: 10px; height: 20px; min-width: 3px; min-height: 4px; max-width: 30px; max-height: 40px; flex: 0 0 10px; flex-basis: 11px; aspect-ratio: 1 / 2;';
    const saved = saveZoomElementStyle(element);
    element.style.cssText = '';
    restoreZoomElementStyle(element, saved);
    assert.equal(element.style.transform, 'scale(2)');
    assert.equal(element.style.position, 'absolute');
    assert.equal(element.style.aspectRatio, '1 / 2');
  });
});
