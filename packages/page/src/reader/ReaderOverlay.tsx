import { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowLeftRight, ArrowDownUp, Bookmark, RotateCcw, Settings, Trash2, Languages, LoaderCircle } from 'lucide-react';
import type { ReadingDirection, BarSide } from './reader-store';
import { getCacheStats, clearAllCache } from '@tiny-client/shared';
import { ThemePanel } from '../theme/ThemeControls';
import { getTranslationControlAction } from '../translation/scheduler';
import { getSeekPageFromKey } from './input';
import {
  createReaderUiIdleController,
  READER_DESKTOP_POINTER_QUERY,
  type ReaderUiIdleController,
} from './idle-ui';

type ChapterInfo = { id: string; name: string; order: number };

const FOCUSABLE_SELECTOR = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])';

function trapDialogFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function SettingSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <span className="text-xs text-gray-300">{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand-500' : 'bg-gray-600'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </span>
    </button>
  );
}

function ChapterDrawer({
  chapters,
  currentChapterId,
  chapterProgress,
  onGoTo,
  onClose,
}: {
  chapters: ChapterInfo[];
  currentChapterId: string;
  chapterProgress: Record<string, { page: number; totalPages: number } | undefined>;
  onGoTo: (id: string) => void;
  onClose: () => void;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
    (activeRef.current ?? closeRef.current)?.focus();
  }, []);

  return (
    <div className="absolute inset-0 z-50 flex justify-end bg-black/60" onClick={onClose} data-reader-control>
      <div
        className="w-72 max-w-[85vw] h-full bg-gray-900 overflow-y-auto shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-chapter-drawer-title"
        onKeyDown={trapDialogFocus}
      >
        <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
          <span id="reader-chapter-drawer-title" className="text-white font-semibold text-sm">章节列表 ({chapters.length})</span>
          <button ref={closeRef} type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center text-gray-400 hover:text-white" aria-label="关闭章节列表">
            <X size={18} />
          </button>
        </div>
        <div className="py-1 flex-1">
          {chapters.map((ch, i) => {
            const prog = chapterProgress[ch.id];
            const isActive = ch.id === currentChapterId;
            return (
              <button
                key={ch.id}
                ref={isActive ? activeRef : undefined}
                onClick={() => { onGoTo(ch.id); onClose(); }}
                className={`w-full text-left px-4 py-3 text-sm border-b border-gray-800 hover:bg-gray-800 transition-colors ${
                  isActive ? 'text-brand-400 bg-gray-800' : 'text-gray-300'
                }`}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-gray-500 tabular-nums shrink-0">{i + 1}.</span>
                  <span className="line-clamp-1 flex-1 min-w-0">{ch.name}</span>
                </div>
                {prog && (
                  <span className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
                    已读 {prog.page + 1}/{prog.totalPages}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BoundaryHint({
  hint,
  boundaryToast,
  direction,
}: {
  hint: { dir: 'prev' | 'next'; progress: number; chapterName: string } | null;
  boundaryToast: 'prev' | 'next' | null;
  direction: ReadingDirection;
}) {
  const isVertical = direction === 'top-down';

  if (boundaryToast) {
    return (
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
        <div className="bg-gray-900/90 backdrop-blur-md text-white/90 text-sm px-4 py-2 rounded-xl shadow-xl ring-1 ring-white/10">
          {boundaryToast === 'prev' ? '没有上一章了' : '没有下一章了'}
        </div>
      </div>
    );
  }

  if (!hint) return null;
  const pct = Math.round(hint.progress * 100);
  const label = hint.dir === 'prev' ? '上一章' : '下一章';
  const Arrow = isVertical
    ? (hint.dir === 'prev' ? ChevronDown : ChevronUp)
    : (hint.dir === 'prev' ? ChevronRight : ChevronLeft);
  const hint2 = isVertical
    ? (hint.dir === 'prev' ? '继续向下拉进入' : '继续向上拉进入')
    : (hint.dir === 'prev' ? '继续向右拉进入' : '继续向左拉进入');

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <div
        className="flex flex-col items-center gap-2 bg-gray-900/85 backdrop-blur-md rounded-2xl shadow-2xl px-6 py-5 ring-1 ring-white/10 transition-all pointer-events-none"
        style={{ opacity: Math.max(0.25, hint.progress), transform: `scale(${0.92 + hint.progress * 0.08})` }}
      >
        <Arrow size={26} className="text-brand-400" style={{ strokeWidth: 2.4 }} />
        <div className="text-white text-sm font-semibold">{label}</div>
        <div className="text-gray-300 text-xs line-clamp-1 max-w-[60vw]">{hint.chapterName}</div>
        <div className="w-40 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-gray-400 text-[11px]">{hint2}</div>
      </div>
    </div>
  );
}

function SettingsPanel({
  direction,
  autoSnap,
  seamlessMode,
  lazyRenderRange,
  barVisible,
  translationConfigured,
  onToggleDirection,
  onToggleAutoSnap,
  onToggleSeamlessMode,
  onChangeLazyRenderRange,
  onToggleBarVisible,
  onOpenTranslationSettings,
  onClose,
  cacheStats,
  onClearCache,
}: {
  direction: ReadingDirection;
  autoSnap: boolean;
  seamlessMode: boolean;
  lazyRenderRange: number;
  barVisible: boolean;
  translationConfigured: boolean;
  onToggleDirection: () => void;
  onToggleAutoSnap: () => void;
  onToggleSeamlessMode: () => void;
  onChangeLazyRenderRange: (value: number) => void;
  onToggleBarVisible: () => void;
  onOpenTranslationSettings: () => void;
  onClose: () => void;
  cacheStats: { count: number; totalSize: number } | null;
  onClearCache: () => void;
}) {
  const isVertical = direction === 'top-down';
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      className="absolute right-0 top-0 z-50 max-h-[100dvh] w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-bl-md border-b border-l border-gray-700/50 bg-gray-900/95 shadow-xl backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-settings-title"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={trapDialogFocus}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <span id="reader-settings-title" className="text-white text-sm font-medium flex items-center gap-2">
          <Settings size={15} />阅读设置
        </span>
        <button ref={closeRef} type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center text-gray-400 hover:text-white" aria-label="关闭阅读设置">
          <X size={16} />
        </button>
      </div>

      <div className="p-3 space-y-4">
        <div className="flex min-h-11 items-center justify-between gap-3">
          <span className="text-gray-300 text-xs">阅读方向</span>
          <button
            type="button"
            onClick={onToggleDirection}
            className="flex min-h-10 items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-xs text-white transition-colors hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label={`切换阅读方向，当前为${isVertical ? '上下滚动' : '左右滚动'}`}
          >
            {isVertical ? <><ArrowDownUp size={14} /> 上下滚动</> : <><ArrowLeftRight size={14} /> 左右滚动</>}
          </button>
        </div>

        <SettingSwitch label="自动吸附" checked={autoSnap} onChange={onToggleAutoSnap} />

        <SettingSwitch label="无缝模式" checked={seamlessMode} onChange={onToggleSeamlessMode} />

        <div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-300 text-xs">预取上限</span>
            <span className="text-gray-400 text-xs">前后各 {lazyRenderRange} 页</span>
          </div>
          <input
            id="reader-prefetch-range"
            type="range"
            min={1}
            max={12}
            step={1}
            value={lazyRenderRange}
            onChange={(e) => onChangeLazyRenderRange(Number.parseInt(e.target.value, 10))}
            className="mt-2 h-1.5 w-full cursor-pointer accent-brand-500"
            aria-label="预取页数"
          />
        </div>

        <SettingSwitch label="显示信息栏" checked={barVisible} onChange={onToggleBarVisible} />

        <div className="border-t border-gray-700/50 pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-300 text-xs">
              漫画翻译 <span className="text-[9px] font-medium uppercase text-brand-400">Beta</span>
            </span>
            <button type="button" onClick={onOpenTranslationSettings} className="flex min-h-10 items-center gap-1.5 rounded-md bg-gray-800 px-2.5 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-700">
              <Languages size={14} />
              {translationConfigured ? '翻译配置' : '配置 LLM'}
            </button>
          </div>
        </div>

        <div className="border-t border-gray-700/50 pt-3">
          <div className="mb-3 text-xs font-medium text-gray-300">外观</div>
          <ThemePanel tone="dark" />
        </div>

        <div className="border-t border-gray-700/50 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-300 text-xs">图片缓存</span>
            <button
              type="button"
              onClick={onClearCache}
              className="flex min-h-10 items-center gap-1 rounded bg-gray-800 px-3 py-1 text-xs text-gray-400 transition-colors hover:bg-red-900/50 hover:text-red-400"
            >
              <Trash2 size={12} />清除
            </button>
          </div>
          <div className="text-gray-500 text-[10px] mt-1">
            {cacheStats
              ? `${(cacheStats.totalSize / 1024 / 1024).toFixed(1)}MB (${cacheStats.count}张)`
              : '计算中...'}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ReaderOverlay({
  visible,
  title,
  currentPage,
  totalPages,
  chapterName,
  chapters,
  currentChapterId,
  chapterProgress,
  direction,
  hasPrevChapter,
  hasNextChapter,
  hint,
  boundaryToast,
  autoSnap,
  seamlessMode,
  lazyRenderRange,
  barSide,
  barVisible,
  isZoomed,
  externalDialogOpen,
  translationConfigured,
  translationAutoMode,
  translationAutoActive,
  translationBusy,
  translationProcessed,
  translationHasResult,
  translationVisible,
  onVisibilityChange,
  onClose,
  onPrevChapter,
  onNextChapter,
  onGoToChapter,
  onToggleDirection,
  onToggleAutoSnap,
  onToggleSeamlessMode,
  onChangeLazyRenderRange,
  onToggleBarVisible,
  onResetZoom,
  onTranslationAction,
  onToggleAutoTranslation,
  onToggleTranslation,
  onOpenTranslationSettings,
  onScrollByInputStep,
  onSeekPage,
}: {
  visible: boolean;
  title: string;
  currentPage: number;
  totalPages: number;
  chapterName: string;
  chapters: ChapterInfo[];
  currentChapterId: string;
  chapterProgress: Record<string, { page: number; totalPages: number } | undefined>;
  direction: ReadingDirection;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  hint: { dir: 'prev' | 'next'; progress: number; chapterName: string } | null;
  boundaryToast: 'prev' | 'next' | null;
  autoSnap: boolean;
  seamlessMode: boolean;
  lazyRenderRange: number;
  barSide: BarSide;
  barVisible: boolean;
  isZoomed: boolean;
  externalDialogOpen: boolean;
  translationConfigured: boolean;
  translationAutoMode: boolean;
  translationAutoActive: boolean;
  translationBusy: boolean;
  translationProcessed: boolean;
  translationHasResult: boolean;
  translationVisible: boolean;
  onVisibilityChange: (visible: boolean) => void;
  onClose: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onGoToChapter: (id: string) => void;
  onToggleDirection: () => void;
  onToggleAutoSnap: () => void;
  onToggleSeamlessMode: () => void;
  onChangeLazyRenderRange: (value: number) => void;
  onToggleBarVisible: () => void;
  onResetZoom: () => void;
  onTranslationAction: () => void;
  onToggleAutoTranslation: () => void;
  onToggleTranslation: () => void;
  onOpenTranslationSettings: () => void;
  onScrollByInputStep: (step: number) => void;
  onSeekPage?: (page: number) => void;
}) {
  const [showChapterDrawer, setShowChapterDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cacheStats, setCacheStats] = useState<{ count: number; totalSize: number } | null>(null);
  const chapterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeChapterDrawer = useCallback(() => {
    setShowChapterDrawer(false);
    window.requestAnimationFrame(() => chapterTriggerRef.current?.focus());
  }, []);
  const closeSettings = useCallback(() => {
    setShowSettings(false);
    window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    getCacheStats().then(setCacheStats);
  }, []);

  const handleClearCache = useCallback(async () => {
    await clearAllCache();
    const stats = await getCacheStats();
    setCacheStats(stats);
  }, []);

  const translationControlAction = getTranslationControlAction({
    autoMode: translationAutoMode,
    autoActive: translationAutoActive,
    hasResult: translationHasResult,
  });
  const handleTranslationControl = () => {
    if (translationControlAction === 'pause-auto' || translationControlAction === 'resume-auto') {
      onToggleAutoTranslation();
    } else if (translationControlAction === 'toggle-current') {
      onToggleTranslation();
    } else {
      onTranslationAction();
    }
  };
  const translationControlDisabled = !translationAutoMode
    && (translationBusy || (translationProcessed && !translationHasResult));
  const translationControlActive = translationAutoMode
    ? translationAutoActive
    : translationHasResult && translationVisible;
  const translationControlTitle = translationAutoMode
    ? translationAutoActive
      ? translationBusy ? '正在自动翻译，点击暂停' : '暂停自动翻译'
      : '继续自动翻译'
    : translationBusy
      ? '正在翻译'
      : translationHasResult
        ? translationVisible ? '隐藏本页译文' : '显示本页译文'
        : translationProcessed
          ? '本页未识别到文本'
          : translationConfigured ? '翻译当前页' : '配置漫画翻译';

  // ─── Seek drag ─────────────────────────────────────────────────
  const progressRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const dragPageRef = useRef(-1);
  const [displayPage, setDisplayPage] = useState<number | null>(null);
  const idleControllerRef = useRef<ReaderUiIdleController | null>(null);
  const visibilityChangeRef = useRef(onVisibilityChange);

  const activePage = dragging && displayPage !== null ? displayPage : currentPage;
  const activePct = totalPages > 1 ? (activePage / (totalPages - 1)) * 100 : 0;
  const interactionActive = showChapterDrawer || showSettings || dragging || externalDialogOpen;

  useEffect(() => {
    visibilityChangeRef.current = onVisibilityChange;
  }, [onVisibilityChange]);

  useEffect(() => {
    const controller = createReaderUiIdleController({
      onVisibilityChange: (nextVisible) => visibilityChangeRef.current(nextVisible),
    });
    idleControllerRef.current = controller;

    const media = window.matchMedia(READER_DESKTOP_POINTER_QUERY);
    controller.setEnabled(media.matches);

    const handleMediaChange = (event: MediaQueryListEvent) => controller.setEnabled(event.matches);
    const handleMouseMove = () => controller.activity();
    media.addEventListener('change', handleMediaChange);
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      media.removeEventListener('change', handleMediaChange);
      window.removeEventListener('mousemove', handleMouseMove);
      controller.dispose();
      idleControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    idleControllerRef.current?.setVisible(visible);
  }, [visible]);

  useEffect(() => {
    idleControllerRef.current?.setPaused(interactionActive);
  }, [interactionActive]);

  const handleReaderControlActivity = useCallback(() => {
    idleControllerRef.current?.activity();
  }, []);

  const pageFromEvent = useCallback((clientX: number, clientY: number) => {
    const el = progressRef.current;
    if (!el || totalPages < 2) return 0;
    const rect = el.getBoundingClientRect();
    const isHorizontal = rect.width > rect.height;
    const pct = Math.max(0, Math.min(1,
      isHorizontal
        ? (clientX - rect.left) / rect.width
        : (clientY - rect.top) / rect.height,
    ));
    return Math.round(pct * (totalPages - 1));
  }, [totalPages]);

  const tooltipTimerRef = useRef<number | null>(null);

  const showTooltipTemporarily = useCallback(() => {
    if (tooltipTimerRef.current !== null) clearTimeout(tooltipTimerRef.current);
    tooltipTimerRef.current = window.setTimeout(() => {
      setDragging(false);
      setDisplayPage(null);
      dragPageRef.current = -1;
      tooltipTimerRef.current = null;
    }, 800);
  }, []);

  const updateDragPreview = useCallback((clientX: number, clientY: number) => {
    const page = pageFromEvent(clientX, clientY);
    if (page === dragPageRef.current) return;
    dragPageRef.current = page;
    setDisplayPage(page);
  }, [pageFromEvent]);

  const finishDrag = useCallback(() => {
    const page = dragPageRef.current;
    if (page >= 0) onSeekPage?.(page);
    draggingRef.current = false;
    showTooltipTemporarily();
  }, [onSeekPage, showTooltipTemporarily]);

  const onProgressPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || totalPages < 2) return;
    event.preventDefault();
    event.stopPropagation();
    if (tooltipTimerRef.current !== null) clearTimeout(tooltipTimerRef.current);
    draggingRef.current = true;
    setDragging(true);
    const page = pageFromEvent(event.clientX, event.clientY);
    dragPageRef.current = page;
    setDisplayPage(page);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pageFromEvent, totalPages]);

  const onProgressPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !event.isPrimary) return;
    event.preventDefault();
    updateDragPreview(event.clientX, event.clientY);
  }, [updateDragPreview]);

  const onProgressPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !event.isPrimary) return;
    updateDragPreview(event.clientX, event.clientY);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishDrag();
  }, [finishDrag, updateDragPreview]);

  const onProgressPointerCancel = useCallback(() => {
    draggingRef.current = false;
    dragPageRef.current = -1;
    setDragging(false);
    setDisplayPage(null);
  }, []);

  const onProgressKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const page = getSeekPageFromKey({
      key: event.key,
      currentPage,
      totalPages,
    });
    if (page === null) return;
    event.preventDefault();
    dragPageRef.current = page;
    setDisplayPage(page);
    setDragging(true);
    onSeekPage?.(page);
    showTooltipTemporarily();
  }, [currentPage, onSeekPage, showTooltipTemporarily, totalPages]);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current !== null) clearTimeout(tooltipTimerRef.current);
      draggingRef.current = false;
    };
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (externalDialogOpen) return;
    if (e.key === 'Escape') {
      if (showSettings) { closeSettings(); return; }
      if (showChapterDrawer) { closeChapterDrawer(); return; }
      onClose();
      return;
    }
    if (showChapterDrawer || showSettings) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onScrollByInputStep(-1); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onScrollByInputStep(1); }
    if (e.key === 'f' || e.key === 'F') onVisibilityChange(!visible);
  }, [closeChapterDrawer, closeSettings, externalDialogOpen, showChapterDrawer, showSettings, onClose, onScrollByInputStep, onVisibilityChange, visible]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const isHorizontalBar = barSide === 'bottom';

  return (
    <>
      {showChapterDrawer && (
        <ChapterDrawer
          chapters={chapters}
          currentChapterId={currentChapterId}
          chapterProgress={chapterProgress}
          onGoTo={onGoToChapter}
          onClose={closeChapterDrawer}
        />
      )}

      <BoundaryHint hint={hint} boundaryToast={boundaryToast} direction={direction} />

      {visible && showSettings && (
        <div
          className="absolute inset-0 z-50 bg-black/45"
          onClick={closeSettings}
          data-reader-control
        >
          <SettingsPanel
            direction={direction} autoSnap={autoSnap} seamlessMode={seamlessMode} lazyRenderRange={lazyRenderRange}
            barVisible={barVisible}
            onToggleDirection={onToggleDirection} onToggleAutoSnap={onToggleAutoSnap}
            onToggleSeamlessMode={onToggleSeamlessMode}
            onChangeLazyRenderRange={onChangeLazyRenderRange}
            onToggleBarVisible={onToggleBarVisible}
            translationConfigured={translationConfigured}
            onOpenTranslationSettings={() => {
              setShowSettings(false);
              onOpenTranslationSettings();
            }}
            onClose={closeSettings}
            cacheStats={cacheStats} onClearCache={handleClearCache}
          />
        </div>
      )}

      {/* Top bar */}
      <div
        data-reader-ui="top"
        className={`absolute top-0 left-0 right-0 z-40 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onPointerDownCapture={handleReaderControlActivity}
      >
        <div className="flex items-center justify-between px-3 pb-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}>
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center text-white/90 hover:text-white" aria-label="关闭阅读器"><X size={22} /></button>
            <div className="min-w-0">
              <div className="text-white text-sm font-medium truncate">{title}</div>
              {chapterName && <div className="text-gray-400 text-xs truncate mt-0.5">{chapterName}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {isZoomed && (
              <button
                type="button"
                onClick={onResetZoom}
                className="flex h-10 w-10 items-center justify-center text-brand-400 transition-colors hover:text-brand-300"
                title="重置缩放"
                aria-label="重置缩放"
              >
                <RotateCcw size={18} />
              </button>
            )}
            <button
              type="button"
              onClick={handleTranslationControl}
              disabled={translationControlDisabled}
              className={`flex h-10 w-10 items-center justify-center transition-colors disabled:cursor-default disabled:opacity-45 ${translationControlActive ? 'text-brand-400' : 'text-white/80 hover:text-white'}`}
              title={translationControlTitle}
              aria-label={translationControlTitle}
              aria-pressed={translationAutoMode ? translationAutoActive : undefined}
            >
              {translationBusy && (!translationAutoMode || translationAutoActive) ? <LoaderCircle size={18} className="animate-spin" /> : <Languages size={18} />}
            </button>
            {chapters.length >= 1 && (
              <button ref={chapterTriggerRef} type="button" onClick={() => setShowChapterDrawer(true)} className="flex h-10 w-10 items-center justify-center text-white/80 hover:text-white" title="章节列表" aria-label="打开章节列表"><Bookmark size={18} /></button>
            )}
            <button ref={settingsTriggerRef} type="button" onClick={() => setShowSettings(v => !v)} className={`flex h-10 w-10 items-center justify-center transition-colors ${showSettings ? 'text-brand-400' : 'text-white/80 hover:text-white'}`} title="阅读设置" aria-label="打开阅读设置"><Settings size={18} /></button>
          </div>
        </div>
      </div>

      {/* Floating page indicator — top-center during drag */}
      <div className={`absolute top-1/4 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-150 ${dragging ? 'opacity-100 scale-100' : 'opacity-0 scale-90'}`}>
        <div className="bg-gray-900/85 backdrop-blur-md text-white text-3xl font-bold px-5 py-3 rounded-2xl shadow-2xl whitespace-nowrap ring-1 ring-white/10">
          {activePage + 1}<span className="text-gray-400 text-xl font-normal mx-1">/</span>{totalPages}
        </div>
      </div>

      {/* Info bar — bottom */}
      {barVisible && isHorizontalBar && (
        <div
          data-reader-ui="info"
          className={`absolute bottom-0 left-0 right-0 z-20 transition-opacity duration-300 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
          onPointerDownCapture={handleReaderControlActivity}
        >
          <div className="bg-black/90" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}>
            <div className="flex min-h-10 items-center gap-2 px-3">
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={onPrevChapter} disabled={!hasPrevChapter} className="flex h-9 w-9 items-center justify-center text-white/70 hover:text-white disabled:cursor-default disabled:opacity-30" title="上一章" aria-label="上一章"><ChevronLeft size={16} /></button>
                <span className="text-white/60 text-xs tabular-nums min-w-[5ch] text-center">{activePage + 1}/{totalPages}</span>
                <button type="button" onClick={onNextChapter} disabled={!hasNextChapter} className="flex h-9 w-9 items-center justify-center text-white/70 hover:text-white disabled:cursor-default disabled:opacity-30" title="下一章" aria-label="下一章"><ChevronRight size={16} /></button>
              </div>
              <div
                ref={progressRef}
                className="group relative h-8 flex-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                onPointerDown={onProgressPointerDown}
                onPointerMove={onProgressPointerMove}
                onPointerUp={onProgressPointerUp}
                onPointerCancel={onProgressPointerCancel}
                onKeyDown={onProgressKeyDown}
                style={{ touchAction: 'none' }}
                role="slider"
                tabIndex={0}
                aria-label="阅读进度"
                aria-valuemin={1}
                aria-valuemax={Math.max(totalPages, 1)}
                aria-valuenow={activePage + 1}
                aria-valuetext={`第 ${activePage + 1} 页，共 ${totalPages} 页`}
              >
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-700/50">
                    <div
                      className="h-full bg-brand-500 rounded-full"
                      style={{
                        width: `${activePct}%`,
                        transition: dragging ? 'none' : undefined,
                      }}
                    />
                  </div>
                <div className="absolute w-5 h-5 bg-brand-500 rounded-full shadow-md opacity-100 ring-2 ring-brand-700/30 pointer-events-none"
                  style={{ left: `${activePct}%`, top: '50%', transform: 'translate(-50%, -50%)' }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Info bar — left/right */}
      {barVisible && !isHorizontalBar && (
        <div
          data-reader-ui="info"
          className={`absolute top-0 bottom-0 z-20 transition-opacity duration-300 ${barSide === 'right' ? 'right-0' : 'left-0'} ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
          onPointerDownCapture={handleReaderControlActivity}
          style={{ width: 40, paddingRight: barSide === 'right' ? 'env(safe-area-inset-right, 0px)' : undefined, paddingLeft: barSide === 'left' ? 'env(safe-area-inset-left, 0px)' : undefined }}
        >
          <div className="flex flex-col items-center gap-2 py-4 h-full" style={{ paddingTop: '3.5rem' }}>
            <div className="flex flex-col-reverse items-center gap-0.5">
              <button type="button" onClick={onNextChapter} disabled={!hasNextChapter} className="flex h-9 w-9 items-center justify-center text-white/70 hover:text-white disabled:cursor-default disabled:opacity-30" title="下一章" aria-label="下一章"><ChevronDown size={14} /></button>
              <span className="text-white/60 text-[10px] tabular-nums" style={{ writingMode: 'vertical-rl' }}>{activePage + 1}/{totalPages}</span>
              <button type="button" onClick={onPrevChapter} disabled={!hasPrevChapter} className="flex h-9 w-9 items-center justify-center text-white/70 hover:text-white disabled:cursor-default disabled:opacity-30" title="上一章" aria-label="上一章"><ChevronUp size={14} /></button>
            </div>
            <div
              ref={progressRef}
              className="w-5 flex-1 cursor-pointer relative group -mx-1.5"
              onPointerDown={onProgressPointerDown}
              onPointerMove={onProgressPointerMove}
              onPointerUp={onProgressPointerUp}
              onPointerCancel={onProgressPointerCancel}
              onKeyDown={onProgressKeyDown}
              style={{ touchAction: 'none' }}
              role="slider"
              tabIndex={0}
              aria-label="阅读进度"
              aria-orientation="vertical"
              aria-valuemin={1}
              aria-valuemax={Math.max(totalPages, 1)}
              aria-valuenow={activePage + 1}
              aria-valuetext={`第 ${activePage + 1} 页，共 ${totalPages} 页`}
            >
              <div className="w-2 mx-1.5 h-full bg-gray-700/50 rounded-full overflow-hidden">
                <div
                  className="w-full bg-brand-500 rounded-full"
                  style={{
                    height: `${activePct}%`,
                    transition: dragging ? 'none' : undefined,
                  }}
                />
              </div>
              <div className="absolute w-5 h-5 bg-brand-500 rounded-full shadow-md opacity-100 ring-2 ring-brand-700/30 pointer-events-none"
                style={{ top: `${activePct}%`, left: '50%', transform: 'translate(-50%, -50%)' }}
              />
            </div>
        </div>
      </div>
      )}

    </>
  );
}
