import assert from 'node:assert/strict';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  albumId: '1',
  locationState: null as unknown,
  navigate: vi.fn(),
  direction: 'left-right' as 'left-right' | 'top-down',
  autoSnap: false,
  seamlessMode: true,
  lazyRange: 2,
  barSide: 'bottom' as 'left' | 'right' | 'bottom',
  progress: null as null | { albumId: string; chapterId: string; chapterIndex: number; page: number; totalPages: number; updatedAt: number },
  latestProgress: null as null | { albumId: string; chapterId: string; chapterIndex: number; page: number; totalPages: number; updatedAt: number },
  noPhoto: false,
  noContainer: false,
  imageMode: 'complete' as 'complete' | 'decode' | 'decode-error' | 'missing',
  overlayProps: null as null | Record<string, unknown>,
  canvasProps: null as null | Record<string, unknown>,
  dialogProps: null as null | Record<string, unknown>,
  translationArgs: null as unknown,
  translation: null as null | Record<string, unknown>,
  networkCallback: null as null | ((value: unknown) => void),
  prefetchNextChapter: vi.fn(),
  saveReadingDirection: vi.fn(),
  saveAutoSnap: vi.fn(),
  saveSeamlessMode: vi.fn(),
  saveLazyRenderRange: vi.fn(),
  saveReadingProgress: vi.fn(),
  getProcessedPhotoImage: vi.fn(),
  decodeImage: vi.fn(),
}));

const chapters = [
  { id: '1', name: 'Chapter one', order: 1 },
  { id: '2', name: 'Chapter two', order: 2 },
  { id: '3', name: 'Chapter three', order: 3 },
];

function makePhoto(id: string) {
  return {
    id,
    name: `Chapter ${id}`,
    scrambleId: 0,
    images: Array.from({ length: 5 }, (_, index) => ({
      name: `${id}-${index}.jpg`,
      url: `https://cdn.test/${id}-${index}.jpg`,
    })),
  };
}

const photos = new Map(chapters.map((chapter) => [chapter.id, makePhoto(chapter.id)]));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ albumId: state.albumId }),
  useLocation: () => ({ state: state.locationState }),
  useNavigate: () => state.navigate,
}));

vi.mock('../src/reader/useReaderData', () => ({
  useReaderData: ({ currentChapterId }: { currentChapterId: string }) => {
    const currentChapterIndex = chapters.findIndex((chapter) => chapter.id === currentChapterId);
    const photo = state.noPhoto ? undefined : photos.get(currentChapterId);
    return {
      album: { id: 'series', seriesID: 'series', name: 'Reader album', series: chapters },
      isSeries: true,
      seriesItems: chapters,
      sortedChapters: chapters,
      currentChapterIndex,
      photo,
      images: photo?.images ?? [],
      prefetchNextChapter: state.prefetchNextChapter,
    };
  },
}));

vi.mock('../src/reader/reader-store', () => ({
  getReadingDirection: () => state.direction,
  saveReadingDirection: state.saveReadingDirection,
  getReadingProgress: () => state.progress,
  getLatestChapterProgress: () => state.latestProgress,
  getAutoSnap: () => state.autoSnap,
  saveAutoSnap: state.saveAutoSnap,
  getSeamlessMode: () => state.seamlessMode,
  saveSeamlessMode: state.saveSeamlessMode,
  getLazyRenderRange: () => state.lazyRange,
  saveLazyRenderRange: state.saveLazyRenderRange,
  getBarSide: () => state.barSide,
  saveReadingProgress: state.saveReadingProgress,
}));

vi.mock('../src/reader/network', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/reader/network')>();
  return {
    ...original,
    getBrowserReaderNetworkCapabilities: () => ({ effectiveType: '4g', deviceMemory: 8, hardwareConcurrency: 8 }),
    subscribeToReaderNetworkChanges: (callback: (value: unknown) => void) => {
      state.networkCallback = callback;
      return () => { state.networkCallback = null; };
    },
  };
});

vi.mock('@tiny-client/shared', () => ({
  getProcessedPhotoImage: state.getProcessedPhotoImage,
}));

vi.mock('../src/translation/useReaderTranslation', () => ({
  useReaderTranslation: (args: unknown) => {
    state.translationArgs = args;
    return state.translation;
  },
}));

vi.mock('../src/reader/ReaderOverlay', () => ({
  ReaderOverlay: (props: Record<string, unknown>) => {
    state.overlayProps = props;
    return <div data-testid="reader-overlay" data-visible={String(props.visible)} />;
  },
}));

function configureContainer(node: HTMLDivElement, imageCount: number) {
  const define = (target: object, key: string, value: unknown) => {
    Object.defineProperty(target, key, { configurable: true, value, writable: true });
  };
  define(node, 'clientWidth', 300);
  define(node, 'clientHeight', 600);
  define(node, 'scrollWidth', Math.max(300, imageCount * 300));
  define(node, 'scrollHeight', Math.max(600, imageCount * 600));
  node.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 600, width: 300, height: 600, x: 0, y: 0, toJSON() {} });
  node.scrollTo = vi.fn((options: ScrollToOptions) => {
    if (typeof options.left === 'number') node.scrollLeft = options.left;
    if (typeof options.top === 'number') node.scrollTop = options.top;
  });
  node.scrollBy = vi.fn((options: ScrollToOptions) => {
    if (typeof options.left === 'number') node.scrollLeft += options.left;
    if (typeof options.top === 'number') node.scrollTop += options.top;
  });

  [...node.children].forEach((child, index) => {
    const page = child as HTMLElement;
    define(page, 'offsetLeft', index * 300);
    define(page, 'offsetTop', index * 600);
    define(page, 'offsetWidth', 300);
    define(page, 'offsetHeight', 600);
    page.getBoundingClientRect = () => ({
      left: index * 300,
      top: index * 600,
      right: (index + 1) * 300,
      bottom: (index + 1) * 600,
      width: 300,
      height: 600,
      x: index * 300,
      y: index * 600,
      toJSON() {},
    });
    const image = page.querySelector('img');
    if (image) {
      define(image, 'complete', state.imageMode === 'complete');
      define(image, 'naturalWidth', 300);
      define(image, 'naturalHeight', 600);
      image.getBoundingClientRect = page.getBoundingClientRect;
      image.decode = state.decodeImage;
    }
  });
}

vi.mock('../src/reader/ReaderPageCanvas', () => ({
  ReaderPageCanvas: (props: Record<string, unknown> & {
    containerRef: { current: HTMLDivElement | null };
    images: Array<{ name: string }>;
    onClick: React.MouseEventHandler<HTMLDivElement>;
  }) => {
    state.canvasProps = props;
    return (
      <div
        data-testid="reader-container"
        ref={(node) => {
          props.containerRef.current = state.noContainer ? null : node;
          if (node) configureContainer(node, props.images.length);
        }}
        onClick={props.onClick}
      >
        {props.images.map((image, index) => (
          <div data-reader-page={index} key={image.name}>
            {state.imageMode !== 'missing' && (
              <img
                alt=""
                src={(props as { blobMap?: Map<number, string> }).blobMap?.get(index)
                  ?? `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==#${index}`}
              />
            )}
          </div>
        ))}
      </div>
    );
  },
}));

vi.mock('../src/reader/ReaderLoadingView', () => ({
  ReaderLoadingView: () => <div data-testid="reader-loading" />,
}));
vi.mock('../src/reader/ChapterTransitionOverlay', () => ({
  ChapterTransitionOverlay: (props: Record<string, unknown>) => <div data-testid="transition" data-active={String(props.transitioning)} />,
}));
vi.mock('../src/translation/TranslationSettingsDialog', () => ({
  TranslationSettingsDialog: (props: Record<string, unknown>) => {
    state.dialogProps = props;
    return <div data-testid="translation-dialog" data-open={String(props.open)} />;
  },
}));

import ReaderPage from '../src/reader/index';

function makeTranslation(overrides: Record<string, unknown> = {}) {
  return {
    settings: {},
    configured: true,
    dialogOpen: false,
    currentRecord: null,
    visible: false,
    autoMode: false,
    autoActive: false,
    task: null,
    busy: false,
    currentPageBusy: false,
    notice: null,
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    saveSettings: vi.fn(),
    clearCache: vi.fn(),
    translateCurrent: vi.fn(),
    retranslateCurrent: vi.fn(),
    cancelCurrentTranslation: vi.fn(),
    toggleAutoTranslation: vi.fn(),
    toggleVisible: vi.fn(),
    dismissNotice: vi.fn(),
    ...overrides,
  };
}

async function flushWork() {
  await act(async () => {
    for (let index = 0; index < 12; index++) await Promise.resolve();
  });
}

function touchEvent(type: string, touches: Array<{ clientX: number; clientY: number }>, changedTouches = touches) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { configurable: true, value: touches });
  Object.defineProperty(event, 'changedTouches', { configurable: true, value: changedTouches });
  return event;
}

describe('ReaderPage integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.albumId = '1';
    state.locationState = null;
    state.direction = 'left-right';
    state.autoSnap = false;
    state.seamlessMode = true;
    state.lazyRange = 2;
    state.barSide = 'bottom';
    state.progress = null;
    state.latestProgress = null;
    state.noPhoto = false;
    state.noContainer = false;
    state.imageMode = 'complete';
    state.overlayProps = null;
    state.canvasProps = null;
    state.dialogProps = null;
    state.translationArgs = null;
    state.networkCallback = null;
    state.navigate.mockReset();
    state.prefetchNextChapter.mockReset().mockResolvedValue(makePhoto('2'));
    state.saveReadingDirection.mockReset();
    state.saveAutoSnap.mockReset();
    state.saveSeamlessMode.mockReset();
    state.saveLazyRenderRange.mockReset();
    state.saveReadingProgress.mockReset();
    state.getProcessedPhotoImage.mockReset().mockResolvedValue({
      data: new Uint8Array([1, 2, 3]).buffer,
      width: 300,
      height: 600,
      byteLength: 3,
    });
    state.decodeImage.mockReset().mockResolvedValue(undefined);
    state.translation = makeTranslation();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => `blob:reader-${Math.random()}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => { callback(0); return 1; },
    });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query.includes('pointer: fine'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) { this.callback = callback; }
      observe = vi.fn(() => this.callback([], this as unknown as ResizeObserver));
      disconnect = vi.fn();
    });
  });

  test('shows a full-screen loading view before photo metadata is ready', () => {
    state.noPhoto = true;
    render(<ReaderPage />);
    assert.ok(screen.getByTestId('reader-loading'));
    assert.equal(state.canvasProps, null);
  });

  test('handles horizontal controls, clicks, wheel modes, and image residency', async () => {
    const view = render(<ReaderPage />);
    await flushWork();
    const container = screen.getByTestId('reader-container') as HTMLDivElement;
    const root = container.parentElement!;
    assert.ok(state.overlayProps);
    assert.ok(state.canvasProps);
    assert.equal(state.getProcessedPhotoImage.mock.calls.length, 3);
    assert.equal((state.translationArgs as { pages: unknown[] }).pages.length, 5);
    assert.ok(state.saveReadingProgress.mock.calls.length > 0);

    const overlay = state.overlayProps as Record<string, (...args: never[]) => unknown>;
    container.scrollLeft = 620;
    fireEvent.scroll(container);
    act(() => overlay.onVisibilityChange(false as never));
    assert.equal(screen.getByTestId('reader-overlay').dataset.visible, 'false');
    assert.equal(root.style.cursor, 'none');
    act(() => overlay.onVisibilityChange(true as never));
    assert.equal(root.style.cursor, '');
    act(() => overlay.onToggleDirection());
    assert.deepEqual(state.saveReadingDirection.mock.calls[0], ['top-down']);
    act(() => overlay.onToggleDirection());
    assert.deepEqual(state.saveReadingDirection.mock.calls[1], ['left-right']);
    act(() => overlay.onToggleAutoSnap());
    assert.deepEqual(state.saveAutoSnap.mock.calls[0], [true]);
    act(() => overlay.onToggleAutoSnap());
    act(() => overlay.onToggleSeamlessMode());
    assert.deepEqual(state.saveSeamlessMode.mock.calls[0], [false]);
    act(() => overlay.onChangeLazyRenderRange(99 as never));
    assert.deepEqual(state.saveLazyRenderRange.mock.calls[0], [12]);
    act(() => overlay.onChangeLazyRenderRange(-3 as never));
    assert.deepEqual(state.saveLazyRenderRange.mock.calls[1], [1]);
    act(() => overlay.onToggleBarVisible());
    act(() => overlay.onClose());
    assert.deepEqual(state.navigate.mock.calls.at(-1), [-1]);
    act(() => overlay.onTranslationAction());
    assert.equal((state.translation?.translateCurrent as ReturnType<typeof vi.fn>).mock.calls.length, 1);

    const canvas = state.canvasProps as Record<string, (...args: never[]) => unknown>;
    fireEvent.click(container, { clientX: 150, clientY: 300 });
    assert.equal(screen.getByTestId('reader-overlay').dataset.visible, 'false');
    fireEvent.click(container, { clientX: 290, clientY: 300 });
    fireEvent.click(container, { clientX: 5, clientY: 300 });
    act(() => canvas.onImageLoad('wrong' as never, 0 as never, container.querySelector('img') as never));
    act(() => canvas.onImageLoad('1' as never, 0 as never, container.querySelector('img') as never));
    act(() => canvas.onRetryPage(0 as never));

    const tiny = new WheelEvent('wheel', { deltaX: 2, deltaY: 1, deltaMode: 0, cancelable: true });
    container.dispatchEvent(tiny);
    assert.equal(tiny.defaultPrevented, false);
    const continuous = new WheelEvent('wheel', { deltaX: 20, deltaY: 1, deltaMode: 0, cancelable: true });
    container.dispatchEvent(continuous);
    assert.equal(continuous.defaultPrevented, true);
    assert.ok((container.scrollBy as ReturnType<typeof vi.fn>).mock.calls.some((call) => call[0].left === 20));

    act(() => (state.overlayProps as Record<string, () => void>).onToggleAutoSnap());
    container.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 0, deltaMode: 0, cancelable: true }));
    container.dispatchEvent(new WheelEvent('wheel', { deltaX: 31, deltaY: 0, deltaMode: 0, cancelable: true }));
    container.dispatchEvent(new WheelEvent('wheel', { deltaX: 80, deltaY: 0, deltaMode: 0, cancelable: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    container.dispatchEvent(new WheelEvent('wheel', { deltaX: 100, deltaY: 0, deltaMode: 1, cancelable: true }));
    container.dispatchEvent(new WheelEvent('wheel', { deltaX: 100, deltaY: 0, deltaMode: 1, cancelable: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    container.scrollLeft = 620;
    fireEvent.scroll(container);
    state.networkCallback?.({ effectiveType: '2g' });
    assert.ok(root.style.touchAction === 'pan-x' || root.style.touchAction === 'pan-y');
    view.unmount();
    assert.equal(state.networkCallback, null);
    assert.ok((URL.revokeObjectURL as ReturnType<typeof vi.fn>).mock.calls.length > 0);
  });

  test('handles vertical native scrolling, touch boundary pulls, and pinch zoom', async () => {
    state.direction = 'top-down';
    state.autoSnap = true;
    const view = render(<ReaderPage />);
    await flushWork();
    const container = screen.getByTestId('reader-container') as HTMLDivElement;
    const root = container.parentElement!;

    const nativeWheel = new WheelEvent('wheel', { deltaY: 30, deltaMode: 0, cancelable: true });
    container.dispatchEvent(nativeWheel);
    assert.equal(nativeWheel.defaultPrevented, false);
    fireEvent.click(container, { clientX: 100, clientY: 10 });
    fireEvent.click(container, { clientX: 100, clientY: 300 });
    fireEvent.click(container, { clientX: 100, clientY: 590 });

    container.scrollTop = 0;
    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 110 }]));
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 220 }]));
    container.dispatchEvent(touchEvent('touchend', [], [{ clientX: 100, clientY: 220 }]));
    container.dispatchEvent(touchEvent('touchcancel', []));

    await act(async () => {
      root.dispatchEvent(touchEvent('touchstart', [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]));
      root.dispatchEvent(touchEvent('touchmove', [
        { clientX: 70, clientY: 100 },
        { clientX: 230, clientY: 100 },
      ]));
      await vi.advanceTimersByTimeAsync(0);
      root.dispatchEvent(touchEvent('touchend', [], [{ clientX: 70, clientY: 100 }]));
    });
    assert.equal((state.overlayProps as { isZoomed: boolean }).isZoomed, true);
    act(() => (state.overlayProps as Record<string, () => void>).onResetZoom());
    assert.equal((state.overlayProps as { isZoomed: boolean }).isZoomed, false);
    view.unmount();
  });

  test('switches chapters, seeks pages, and prefetches the next first page', async () => {
    state.seamlessMode = false;
    const view = render(<ReaderPage />);
    await flushWork();
    let overlay = state.overlayProps as Record<string, (...args: never[]) => unknown>;
    let canvas = state.canvasProps as Record<string, (...args: never[]) => unknown>;
    const firstContainer = screen.getByTestId('reader-container') as HTMLDivElement;
    act(() => canvas.onImageLoad('1' as never, 0 as never, firstContainer.querySelector('img') as never));

    const seekScrollTo = firstContainer.scrollTo as ReturnType<typeof vi.fn>;
    act(() => overlay.onSeekPage(4 as never));
    assert.ok(seekScrollTo.mock.calls.some((call) => call[0].left === 1200));
    firstContainer.scrollLeft = 1200;
    fireEvent.scroll(firstContainer);
    assert.equal((state.overlayProps as { currentPage: number }).currentPage, 4);
    await act(async () => { await vi.advanceTimersByTimeAsync(350); });
    await flushWork();
    assert.ok(state.prefetchNextChapter.mock.calls.length > 0);

    act(() => overlay.onNextChapter());
    await flushWork();
    assert.match(String(state.navigate.mock.calls.at(-1)?.[0]), /\/reader\/2/);
    assert.equal((state.overlayProps as { currentChapterId: string }).currentChapterId, '2');
    assert.equal(screen.getByTestId('transition').dataset.active, 'false');

    overlay = state.overlayProps as Record<string, (...args: never[]) => unknown>;
    canvas = state.canvasProps as Record<string, (...args: never[]) => unknown>;
    act(() => canvas.onImageLoad('2' as never, 0 as never, screen.getByTestId('reader-container').querySelector('img') as never));
    act(() => overlay.onPrevChapter());
    await flushWork();
    assert.equal((state.overlayProps as { currentChapterId: string }).currentChapterId, '1');
    assert.ok((screen.getByTestId('reader-container') as HTMLDivElement).scrollLeft >= 0);

    overlay = state.overlayProps as Record<string, (...args: never[]) => unknown>;
    act(() => overlay.onGoToChapter('3' as never));
    await flushWork();
    assert.equal((state.overlayProps as { currentChapterId: string }).currentChapterId, '3');
    act(() => (state.overlayProps as Record<string, (...args: never[]) => unknown>).onNextChapter());
    act(() => (state.overlayProps as Record<string, (...args: never[]) => unknown>).onGoToChapter('3' as never));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    view.unmount();
  });

  test('handles mouse and trackpad pulls at both chapter boundaries', async () => {
    const view = render(<ReaderPage />);
    await flushWork();
    let container = screen.getByTestId('reader-container') as HTMLDivElement;

    container.scrollLeft = 0;
    const noPrevious = new WheelEvent('wheel', { deltaX: -100, deltaMode: 1, cancelable: true });
    act(() => container.dispatchEvent(noPrevious));
    assert.equal(noPrevious.defaultPrevented, true);
    assert.equal((state.overlayProps as { boundaryToast: string }).boundaryToast, 'prev');
    act(() => container.dispatchEvent(new WheelEvent('wheel', { deltaX: -100, deltaMode: 1, cancelable: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });

    container.scrollLeft = 600;
    act(() => container.dispatchEvent(new WheelEvent('wheel', { deltaX: 10, deltaMode: 0, cancelable: true })));
    container.scrollLeft = 1200;
    act(() => container.dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaMode: 0, cancelable: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(140); });

    act(() => container.dispatchEvent(new WheelEvent('wheel', { deltaX: 60, deltaMode: 0, cancelable: true })));
    await flushWork();
    assert.equal((state.overlayProps as { currentChapterId: string }).currentChapterId, '2');

    container = screen.getByTestId('reader-container') as HTMLDivElement;
    container.scrollLeft = 1200;
    act(() => container.dispatchEvent(new WheelEvent('wheel', { deltaX: 100, deltaMode: 1, cancelable: true })));
    await flushWork();
    assert.equal((state.overlayProps as { currentChapterId: string }).currentChapterId, '3');
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    container = screen.getByTestId('reader-container') as HTMLDivElement;
    container.scrollLeft = 1200;
    act(() => container.dispatchEvent(new WheelEvent('wheel', { deltaX: 100, deltaMode: 1, cancelable: true })));
    assert.equal((state.overlayProps as { boundaryToast: string }).boundaryToast, 'next');
    view.unmount();
  });

  test('supports grouped pinch, pan, control exclusion, and double-tap reset', async () => {
    state.direction = 'top-down';
    state.autoSnap = false;
    state.seamlessMode = true;
    const view = render(<ReaderPage />);
    await flushWork();
    const container = screen.getByTestId('reader-container') as HTMLDivElement;
    const root = container.parentElement!;
    const control = document.createElement('button');
    control.dataset.readerControl = '';
    root.append(control);
    control.dispatchEvent(touchEvent('touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]));

    await act(async () => {
      root.dispatchEvent(touchEvent('touchstart', [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]));
      root.dispatchEvent(touchEvent('touchmove', [
        { clientX: 50, clientY: 100 },
        { clientX: 250, clientY: 100 },
      ]));
      root.dispatchEvent(touchEvent('touchend', [{ clientX: 150, clientY: 150 }]));
      root.dispatchEvent(touchEvent('touchstart', [{ clientX: 150, clientY: 150 }]));
      root.dispatchEvent(touchEvent('touchmove', [{ clientX: 170, clientY: 180 }]));
      root.dispatchEvent(touchEvent('touchend', [], [{ clientX: 170, clientY: 180 }]));
    });
    assert.equal((state.overlayProps as { isZoomed: boolean }).isZoomed, true);
    fireEvent.click(container, { clientX: 150, clientY: 300 });
    act(() => (state.overlayProps as Record<string, () => void>).onResetZoom());

    root.dispatchEvent(touchEvent('touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]));
    root.dispatchEvent(touchEvent('touchmove', [
      { clientX: 100, clientY: 100 },
      { clientX: 100, clientY: 100 },
    ]));
    root.dispatchEvent(touchEvent('touchcancel', []));
    view.unmount();
  });

  test('handles pending, inward, incomplete, and completed touch boundary pulls', async () => {
    state.albumId = '2';
    state.direction = 'top-down';
    state.autoSnap = false;
    const view = render(<ReaderPage />);
    await flushWork();
    let container = screen.getByTestId('reader-container') as HTMLDivElement;
    act(() => (state.canvasProps as Record<string, (...args: never[]) => unknown>)
      .onImageLoad('2' as never, 0 as never, container.querySelector('img') as never));

    container.scrollTop = 0;
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 120 }]));
    const control = document.createElement('button');
    control.dataset.readerControl = '';
    container.append(control);
    control.dispatchEvent(touchEvent('touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 110, clientY: 110 },
    ]));
    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 105 }]));
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 70 }]));

    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    act(() => container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 130 }])));
    assert.equal((state.overlayProps as { hint: { dir: string } | null }).hint?.dir, 'prev');
    container.dispatchEvent(touchEvent('touchend', [], [{ clientX: 100, clientY: 130 }]));

    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 180 }]));
    container.dispatchEvent(touchEvent('touchend', [{ clientX: 100, clientY: 180 }]));
    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 180 }]));
    container.dispatchEvent(touchEvent('touchend', [], [{ clientX: 100, clientY: 180 }]));
    await flushWork();
    assert.equal((state.overlayProps as { currentChapterId: string }).currentChapterId, '1');

    act(() => (state.overlayProps as Record<string, (...args: never[]) => unknown>).onNextChapter());
    await flushWork();
    container = screen.getByTestId('reader-container') as HTMLDivElement;
    act(() => (state.canvasProps as Record<string, (...args: never[]) => unknown>)
      .onImageLoad('2' as never, 0 as never, container.querySelector('img') as never));
    container.scrollTop = 2400;
    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.scrollTop = 1000;
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 20 }]));

    container.scrollTop = 2400;
    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 20 }]));
    container.dispatchEvent(touchEvent('touchend', [], [{ clientX: 100, clientY: 20 }]));
    await flushWork();
    assert.equal((state.overlayProps as { currentChapterId: string }).currentChapterId, '3');
    view.unmount();
  });

  test('finishes photo readiness through decode, decode failure, timeout, and absent container paths', async () => {
    state.imageMode = 'decode';
    const decoded = render(<ReaderPage />);
    await flushWork();
    assert.ok(state.decodeImage.mock.calls.length > 0);
    decoded.unmount();

    state.imageMode = 'decode-error';
    state.decodeImage.mockRejectedValue(new Error('decode failed'));
    const rejected = render(<ReaderPage />);
    await flushWork();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    rejected.unmount();

    state.imageMode = 'missing';
    const missing = render(<ReaderPage />);
    await flushWork();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    missing.unmount();

    state.imageMode = 'complete';
    state.noContainer = true;
    const noContainer = render(<ReaderPage />);
    await flushWork();
    act(() => (state.overlayProps as Record<string, (...args: never[]) => unknown>).onSeekPage(2 as never));
    act(() => (state.overlayProps as Record<string, (...args: never[]) => unknown>).onScrollByInputStep(1 as never));
    noContainer.unmount();
  });

  test('restores saved progress and the latest chapter in a series', async () => {
    state.progress = { albumId: 'series', chapterId: '1', chapterIndex: 0, page: 2, totalPages: 5, updatedAt: 10 };
    state.latestProgress = { albumId: 'series', chapterId: '2', chapterIndex: 1, page: 3, totalPages: 5, updatedAt: 20 };
    const view = render(<ReaderPage />);
    await flushWork();
    assert.equal((state.overlayProps as { currentChapterId: string }).currentChapterId, '2');
    assert.equal((state.overlayProps as { currentPage: number }).currentPage, 3);
    assert.ok(Object.keys((state.overlayProps as { chapterProgress: object }).chapterProgress).length > 0);
    view.unmount();
  });

  test('settles horizontal snap and tracks vertical scroll centers', async () => {
    state.autoSnap = true;
    const horizontal = render(<ReaderPage />);
    await flushWork();
    let container = screen.getByTestId('reader-container') as HTMLDivElement;
    act(() => (state.canvasProps as Record<string, (...args: never[]) => unknown>)
      .onImageLoad('1' as never, 0 as never, container.querySelector('img') as never));
    container.scrollLeft = 470;
    fireEvent.scroll(container);
    await act(async () => { await vi.advanceTimersByTimeAsync(120); });
    assert.equal((state.overlayProps as { currentPage: number }).currentPage, 2);
    horizontal.unmount();

    state.direction = 'top-down';
    state.autoSnap = false;
    const vertical = render(<ReaderPage />);
    await flushWork();
    container = screen.getByTestId('reader-container') as HTMLDivElement;
    act(() => (state.canvasProps as Record<string, (...args: never[]) => unknown>)
      .onImageLoad('1' as never, 0 as never, container.querySelector('img') as never));
    container.scrollTop = 1300;
    fireEvent.scroll(container);
    assert.equal((state.overlayProps as { currentPage: number }).currentPage, 2);
    vertical.unmount();
  });

  test('reports a failed adjacent-page prefetch without failing the reader', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.seamlessMode = false;
    state.prefetchNextChapter.mockRejectedValue(new Error('prefetch failed'));
    const view = render(<ReaderPage />);
    await flushWork();
    const container = screen.getByTestId('reader-container') as HTMLDivElement;
    act(() => (state.canvasProps as Record<string, (...args: never[]) => unknown>)
      .onImageLoad('1' as never, 0 as never, container.querySelector('img') as never));
    container.scrollLeft = 1200;
    fireEvent.scroll(container);
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await flushWork();
    assert.ok(warn.mock.calls.some((call) => String(call[0]).includes('预取下一章首页失败')));
    view.unmount();
  });

  test('marks failed resident pages and retries them', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.getProcessedPhotoImage
      .mockRejectedValueOnce(new Error('decode failed'))
      .mockResolvedValue({ data: new Uint8Array([1]).buffer, width: 300, height: 600, byteLength: 1 });
    const view = render(<ReaderPage />);
    await flushWork();
    assert.ok(errorSpy.mock.calls.some((call) => String(call[0]).includes('加载第 1 页失败')));
    const failed = (state.canvasProps as { failedPages: Set<number> }).failedPages;
    assert.equal(failed.has(0), true);
    act(() => (state.canvasProps as Record<string, (...args: never[]) => unknown>).onRetryPage(0 as never));
    await flushWork();
    assert.equal((state.canvasProps as { failedPages: Set<number> }).failedPages.has(0), false);
    view.unmount();
  });

  test('renders translation task phases, notices, and dialog actions', async () => {
    const translation = makeTranslation({
      task: { pageKey: '1:0', stage: 'recognizing' },
    });
    state.translation = translation;
    const view = render(<ReaderPage />);
    await flushWork();
    assert.ok(screen.getByText('正在识别本页文字'));
    fireEvent.click(screen.getByTitle('取消当前页翻译'));
    assert.equal((translation.cancelCurrentTranslation as ReturnType<typeof vi.fn>).mock.calls.length, 1);

    for (const [task, label] of [
      [{ pageKey: '1:0', stage: 'translating' }, '正在翻译本页'],
      [{ pageKey: '1:0', stage: 'loading-model', ocrInitialization: { phase: 'checking-cache', loadedBytes: 0 } }, '正在检查 OCR 模型'],
      [{ pageKey: '1:0', stage: 'loading-model', ocrInitialization: { phase: 'initializing', loadedBytes: 0 } }, '正在初始化 OCR'],
      [{ pageKey: '1:0', stage: 'loading-model', ocrInitialization: { phase: 'ready', loadedBytes: 0 } }, '正在准备本页 OCR'],
      [{ pageKey: '1:0', stage: 'loading-model' }, '正在加载本页 OCR'],
    ] as const) {
      state.translation = { ...translation, task };
      view.rerender(<ReaderPage />);
      assert.ok(screen.getByText(label));
    }

    state.translation = {
      ...translation,
      task: {
        pageKey: '1:0',
        stage: 'loading-model',
        ocrInitialization: { phase: 'downloading', loadedBytes: 512 * 1024, totalBytes: 2 * 1024 * 1024 },
      },
    };
    view.rerender(<ReaderPage />);
    assert.ok(screen.getByText('首次使用，正在下载 OCR 模型 25%'));
    assert.ok(screen.getByText('512 KB / 2.0 MB'));
    assert.equal(screen.getByRole('progressbar').getAttribute('aria-valuenow'), '25');

    state.translation = {
      ...translation,
      task: {
        pageKey: '1:0',
        stage: 'loading-model',
        ocrInitialization: { phase: 'downloading', loadedBytes: -1, totalBytes: 0 },
      },
    };
    view.rerender(<ReaderPage />);
    assert.ok(screen.getByText('首次使用，正在下载 OCR 模型'));
    assert.ok(screen.getByText('0 KB'));

    state.translation = { ...translation, task: null, notice: { kind: 'error', message: 'Translation failed' } };
    view.rerender(<ReaderPage />);
    assert.ok(screen.getByText('Translation failed'));
    fireEvent.click(screen.getByTitle('关闭'));
    assert.equal((translation.dismissNotice as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    state.translation = { ...translation, task: null, notice: { kind: 'info', message: 'Done' }, dialogOpen: true };
    view.rerender(<ReaderPage />);
    assert.equal(screen.queryByText('Done'), null);

    act(() => (state.dialogProps as Record<string, () => void>).onRetranslate());
    assert.equal((translation.retranslateCurrent as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    const page = (state.translationArgs as { pages: Array<{ loadImageBlob: (signal: AbortSignal) => Promise<Blob> }> }).pages[0];
    const blob = await page.loadImageBlob(new AbortController().signal);
    assert.equal(blob.type, 'image/jpeg');
    view.unmount();
  });

  test('supports single-image zoom fallback, multi-touch continuation, double-tap reset, and zoomed clicks', async () => {
    state.direction = 'top-down';
    state.autoSnap = true;
    state.seamlessMode = false;
    const view = render(<ReaderPage />);
    await flushWork();
    const container = screen.getByTestId('reader-container') as HTMLDivElement;
    const root = container.parentElement!;
    const image = container.querySelector('img')!;
    image.getBoundingClientRect = () => ({ left: 1000, top: 1000, right: 1100, bottom: 1100, width: 100, height: 100, x: 1000, y: 1000, toJSON() {} });
    act(() => (state.overlayProps as Record<string, (visible: boolean) => void>).onVisibilityChange(false));

    root.dispatchEvent(touchEvent('touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]));
    root.dispatchEvent(touchEvent('touchmove', [
      { clientX: 50, clientY: 100 },
      { clientX: 250, clientY: 100 },
    ]));
    root.dispatchEvent(touchEvent('touchend', [
      { clientX: 80, clientY: 100 },
      { clientX: 220, clientY: 100 },
    ]));
    root.dispatchEvent(touchEvent('touchend', [{ clientX: 150, clientY: 100 }]));

    root.dispatchEvent(touchEvent('touchstart', [{ clientX: 150, clientY: 100 }]));
    root.dispatchEvent(touchEvent('touchend', [], [{ clientX: 150, clientY: 100 }]));
    root.dispatchEvent(touchEvent('touchstart', [{ clientX: 150, clientY: 100 }]));
    root.dispatchEvent(touchEvent('touchend', [], [{ clientX: 150, clientY: 100 }]));
    assert.equal((state.overlayProps as { isZoomed: boolean }).isZoomed, false);

    image.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} });
    root.dispatchEvent(touchEvent('touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]));
    image.getBoundingClientRect = (image.parentElement as HTMLElement).getBoundingClientRect;
    root.dispatchEvent(touchEvent('touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]));
    root.dispatchEvent(touchEvent('touchend', [], [{ clientX: 100, clientY: 100 }]));

    root.dispatchEvent(touchEvent('touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]));
    root.dispatchEvent(touchEvent('touchmove', [
      { clientX: 50, clientY: 100 },
      { clientX: 250, clientY: 100 },
    ]));
    const zoomWheel = new WheelEvent('wheel', { deltaY: 80, cancelable: true });
    container.dispatchEvent(zoomWheel);
    assert.equal(zoomWheel.defaultPrevented, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(501); });
    fireEvent.click(container, { clientX: 150, clientY: 300 });
    assert.equal(screen.getByTestId('reader-overlay').dataset.visible, 'true');
    view.unmount();
  });

  test('defers grouped aspect-ratio changes until zoom resets', async () => {
    state.direction = 'top-down';
    state.autoSnap = false;
    state.seamlessMode = true;
    const view = render(<ReaderPage />);
    await flushWork();
    const container = screen.getByTestId('reader-container') as HTMLDivElement;
    const root = container.parentElement!;
    const image = container.querySelector('img')!;
    root.dispatchEvent(touchEvent('touchstart', [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
    ]));
    root.dispatchEvent(touchEvent('touchmove', [
      { clientX: 50, clientY: 100 },
      { clientX: 250, clientY: 100 },
    ]));
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 600 },
      naturalHeight: { configurable: true, value: 600 },
    });
    act(() => (state.canvasProps as Record<string, (...args: never[]) => unknown>).onImageLoad('1' as never, 0 as never, image as never));
    act(() => (state.overlayProps as Record<string, () => void>).onResetZoom());
    assert.equal((state.canvasProps as { pageAspectRatios: Map<number, number> }).pageAspectRatios.get(0), 1);
    view.unmount();
  });

  test('unlocks a stalled chapter transition and blocks input while switching', async () => {
    state.imageMode = 'missing';
    const view = render(<ReaderPage />);
    await flushWork();
    act(() => (state.overlayProps as Record<string, () => void>).onNextChapter());
    const container = screen.getByTestId('reader-container') as HTMLDivElement;
    const wheel = new WheelEvent('wheel', { deltaX: 100, deltaMode: 1, cancelable: true });
    container.dispatchEvent(wheel);
    assert.equal(wheel.defaultPrevented, true);
    assert.equal(screen.getByTestId('transition').dataset.active, 'true');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    view.unmount();
  });

  test('handles pending programmatic overflow and partial trackpad boundary pulls', async () => {
    state.albumId = '2';
    const view = render(<ReaderPage />);
    await flushWork();
    const container = screen.getByTestId('reader-container') as HTMLDivElement;
    act(() => (state.overlayProps as Record<string, (...args: never[]) => unknown>).onScrollByInputStep(1 as never));
    act(() => (state.overlayProps as Record<string, (...args: never[]) => unknown>).onScrollByInputStep(-10 as never));
    assert.equal((state.overlayProps as { boundaryToast: string | null }).boundaryToast, null);

    container.scrollLeft = 0;
    const partial = new WheelEvent('wheel', { deltaX: -10, deltaMode: 0, cancelable: true });
    container.dispatchEvent(partial);
    assert.equal(partial.defaultPrevented, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    view.unmount();
  });

  test('cancels invalidated touch tracking and incomplete locked pulls', async () => {
    state.albumId = '2';
    state.direction = 'top-down';
    state.autoSnap = false;
    const view = render(<ReaderPage />);
    await flushWork();
    const container = screen.getByTestId('reader-container') as HTMLDivElement;

    container.scrollTop = 1000;
    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.scrollTop = 0;
    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.dispatchEvent(touchEvent('touchend', [], [{ clientX: 100, clientY: 100 }]));

    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.dispatchEvent(touchEvent('touchmove', [
      { clientX: 100, clientY: 120 },
      { clientX: 110, clientY: 120 },
    ]));
    container.dispatchEvent(touchEvent('touchstart', [{ clientX: 100, clientY: 100 }]));
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 120 }]));
    container.dispatchEvent(touchEvent('touchmove', [{ clientX: 100, clientY: 80 }]));
    container.dispatchEvent(touchEvent('touchend', [], [{ clientX: 100, clientY: 80 }]));
    view.unmount();
  });
});
