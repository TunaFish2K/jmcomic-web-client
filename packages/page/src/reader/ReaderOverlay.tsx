import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowLeftRight, ArrowDownUp, Bookmark, Settings, MoveDown, MoveLeft, MoveRight, Trash2 } from 'lucide-react';
import type { ReadingDirection, BarSide } from './reader-store';
import { getCacheStats, clearAllCache } from '@tiny-client/shared';

type ChapterInfo = { id: string; name: string; order: number };

function ChapterDrawer({
  chapters,
  currentChapterId,
  onGoTo,
  onClose,
}: {
  chapters: ChapterInfo[];
  currentChapterId: string;
  onGoTo: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 bg-black/60 flex justify-end" onClick={onClose}>
      <div
        className="w-72 max-w-[85vw] h-full bg-gray-900 overflow-y-auto shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-900 z-10">
          <span className="text-white font-semibold text-sm">章节列表 ({chapters.length})</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="py-1 flex-1">
          {chapters.map((ch) => (
            <button
              key={ch.id}
              onClick={() => { onGoTo(ch.id); onClose(); }}
              className={`w-full text-left px-4 py-3 text-sm border-b border-gray-800 hover:bg-gray-800 transition-colors ${
                ch.id === currentChapterId ? 'text-brand-400 bg-gray-800' : 'text-gray-300'
              }`}
            >
              <span className="line-clamp-1">{ch.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  direction,
  autoSnap,
  seamlessMode,
  lazyRenderRange,
  barSide,
  barVisible,
  onToggleDirection,
  onToggleAutoSnap,
  onToggleSeamlessMode,
  onChangeLazyRenderRange,
  onChangeBarSide,
  onToggleBarVisible,
  onClose,
  cacheStats,
  onClearCache,
}: {
  direction: ReadingDirection;
  autoSnap: boolean;
  seamlessMode: boolean;
  lazyRenderRange: number;
  barSide: BarSide;
  barVisible: boolean;
  onToggleDirection: () => void;
  onToggleAutoSnap: () => void;
  onToggleSeamlessMode: () => void;
  onChangeLazyRenderRange: (value: number) => void;
  onChangeBarSide: (side: BarSide) => void;
  onToggleBarVisible: () => void;
  onClose: () => void;
  cacheStats: { count: number; totalSize: number } | null;
  onClearCache: () => void;
}) {
  const isVertical = direction === 'top-down';

  return (
    <div className="absolute top-0 right-0 z-50 w-64 bg-gray-900/95 backdrop-blur rounded-bl-xl shadow-xl border-l border-b border-gray-700/50 overflow-hidden">
      <div className="p-3 border-b border-gray-700 flex items-center justify-between">
        <span className="text-white text-sm font-medium flex items-center gap-2">
          <Settings size={15} />阅读设置
        </span>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <div className="p-3 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-300 text-xs">阅读方向</span>
          <button
            onClick={onToggleDirection}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-xs transition-colors"
          >
            {isVertical ? <><ArrowDownUp size={14} /> 上下滚动</> : <><ArrowLeftRight size={14} /> 左右滚动</>}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-300 text-xs">自动吸附</span>
          <button
            onClick={onToggleAutoSnap}
            disabled={seamlessMode}
            className={`relative w-9 h-5 rounded-full transition-colors ${autoSnap ? 'bg-brand-500' : 'bg-gray-600'} ${seamlessMode ? 'opacity-40 cursor-default' : ''}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoSnap ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-300 text-xs">无缝模式</span>
          <button
            onClick={onToggleSeamlessMode}
            className={`relative w-9 h-5 rounded-full transition-colors ${seamlessMode ? 'bg-brand-500' : 'bg-gray-600'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${seamlessMode ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-300 text-xs">懒加载范围</span>
            <span className="text-gray-400 text-xs">前后各 {lazyRenderRange} 页</span>
          </div>
          <input
            type="range"
            min={1}
            max={12}
            step={1}
            value={lazyRenderRange}
            onChange={(e) => onChangeLazyRenderRange(Number.parseInt(e.target.value, 10))}
            className="mt-2 h-1.5 w-full cursor-pointer accent-brand-500"
          />
        </div>

        <div>
          <span className="text-gray-300 text-xs">信息栏位置</span>
          <div className="grid grid-cols-2 gap-1 mt-1.5">
            {(['left','right'] as BarSide[]).map(s => (
              <button key={s} onClick={() => onChangeBarSide(s)} className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs transition-colors ${barSide === s ? 'bg-brand-500/20 text-brand-400' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {s === 'left' ? <MoveLeft size={12} /> : <MoveRight size={12} />}
                {s === 'left' ? '左侧' : '右侧'}
              </button>
            ))}
            {(['bottom'] as BarSide[]).map(s => (
              <button key={s} onClick={() => onChangeBarSide(s)} className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs transition-colors ${barSide === s ? 'bg-brand-500/20 text-brand-400' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                <MoveDown size={12} />
                下方
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-300 text-xs">信息栏可见</span>
          <button onClick={onToggleBarVisible} className={`relative w-9 h-5 rounded-full transition-colors ${barVisible ? 'bg-brand-500' : 'bg-gray-600'}`}>
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${barVisible ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>

        <div className="border-t border-gray-700/50 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-300 text-xs">图片缓存</span>
            <button
              onClick={onClearCache}
              className="flex items-center gap-1 px-2 py-1 rounded bg-gray-800 hover:bg-red-900/50 text-gray-400 hover:text-red-400 text-xs transition-colors"
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
  scrollProgressPct,
  chapterName,
  chapters,
  currentChapterId,
  direction,
  hasPrevChapter,
  hasNextChapter,
  autoSnap,
  seamlessMode,
  lazyRenderRange,
  barSide,
  barVisible,
  onToggleVisibility,
  onClose,
  onPrevPage,
  onNextPage,
  onPrevChapter,
  onNextChapter,
  onGoToChapter,
  onToggleDirection,
  onToggleAutoSnap,
  onToggleSeamlessMode,
  onChangeLazyRenderRange,
  onChangeBarSide,
  onToggleBarVisible,
  onScrollByInputStep,
  onSeekPage,
}: {
  visible: boolean;
  title: string;
  currentPage: number;
  totalPages: number;
  scrollProgressPct: number;
  chapterName: string;
  chapters: ChapterInfo[];
  currentChapterId: string;
  direction: ReadingDirection;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  autoSnap: boolean;
  seamlessMode: boolean;
  lazyRenderRange: number;
  barSide: BarSide;
  barVisible: boolean;
  onToggleVisibility: () => void;
  onClose: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onGoToChapter: (id: string) => void;
  onToggleDirection: () => void;
  onToggleAutoSnap: () => void;
  onToggleSeamlessMode: () => void;
  onChangeLazyRenderRange: (value: number) => void;
  onChangeBarSide: (side: BarSide) => void;
  onToggleBarVisible: () => void;
  onScrollByInputStep: (step: number) => void;
  onSeekPage?: (page: number) => void;
}) {
  const [showChapterDrawer, setShowChapterDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [cacheStats, setCacheStats] = useState<{ count: number; totalSize: number } | null>(null);

  useEffect(() => {
    getCacheStats().then(setCacheStats);
  }, []);

  const handleClearCache = useCallback(async () => {
    await clearAllCache();
    const stats = await getCacheStats();
    setCacheStats(stats);
  }, []);

  const progressPct = scrollProgressPct;

  // ─── Seek drag ─────────────────────────────────────────────────
  const progressRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragPageRef = useRef(-1);
  const [displayPage, setDisplayPage] = useState<number | null>(null);

  const activePage = dragging && displayPage !== null ? displayPage : currentPage;
  const activePct = totalPages > 1 ? (activePage / (totalPages - 1)) * 100 : 0;

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

  const onDragStart = useCallback((clientX: number, clientY: number) => {
    setDragging(true);
    const page = pageFromEvent(clientX, clientY);
    dragPageRef.current = page;
    setDisplayPage(page);
  }, [pageFromEvent]);

  const onDragMove = useCallback((clientX: number, clientY: number) => {
    const page = pageFromEvent(clientX, clientY);
    if (page === dragPageRef.current) return;
    dragPageRef.current = page;
    setDisplayPage(page);
    onSeekPage?.(page);
  }, [pageFromEvent, onSeekPage]);

  const onDragEnd = useCallback(() => {
    setDragging(false);
    const page = dragPageRef.current;
    if (page >= 0) onSeekPage?.(page);
    dragPageRef.current = -1;
    setDisplayPage(null);
  }, [onSeekPage]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const pos = 'touches' in e
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : { x: e.clientX, y: e.clientY };
      onDragMove(pos.x, pos.y);
    };
    const onEnd = () => onDragEnd();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [dragging, onDragMove, onDragEnd]);

  // ─── Page dots ─────────────────────────────────────────────────
  const dotPositions = useMemo(() => {
    if (totalPages < 2) return [];
    const maxDots = 30;
    const step = Math.max(1, Math.floor(totalPages / maxDots));
    const last = totalPages - 1;
    const dots: number[] = [0];
    for (let i = step; i < last; i += step) dots.push(i);
    if (dots[dots.length - 1] !== last) dots.push(last);
    return dots;
  }, [totalPages]);

  // ────────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showSettings) { setShowSettings(false); return; }
      if (showChapterDrawer) { setShowChapterDrawer(false); return; }
      onClose();
      return;
    }
    if (showChapterDrawer || showSettings) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onScrollByInputStep(-1); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onScrollByInputStep(1); }
    if (e.key === 'f' || e.key === 'F') onToggleVisibility();
  }, [showChapterDrawer, showSettings, onClose, onScrollByInputStep, onToggleVisibility]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const isVertical = direction === 'top-down';
  const isHorizontalBar = barSide === 'bottom';

  return (
    <>
      {showChapterDrawer && (
        <ChapterDrawer chapters={chapters} currentChapterId={currentChapterId} onGoTo={onGoToChapter} onClose={() => setShowChapterDrawer(false)} />
      )}

      {visible && showSettings && (
        <SettingsPanel
          direction={direction} autoSnap={autoSnap} seamlessMode={seamlessMode} lazyRenderRange={lazyRenderRange}
          barSide={barSide} barVisible={barVisible}
          onToggleDirection={onToggleDirection} onToggleAutoSnap={onToggleAutoSnap}
          onToggleSeamlessMode={onToggleSeamlessMode}
          onChangeLazyRenderRange={onChangeLazyRenderRange}
          onChangeBarSide={onChangeBarSide} onToggleBarVisible={onToggleBarVisible}
          onClose={() => setShowSettings(false)}
          cacheStats={cacheStats} onClearCache={handleClearCache}
        />
      )}

      {/* Top bar */}
      <div className={`absolute top-0 left-0 right-0 z-40 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="text-white/90 hover:text-white shrink-0"><X size={22} /></button>
            <div className="min-w-0">
              <div className="text-white text-sm font-medium truncate">{title}</div>
              {chapterName && <div className="text-gray-400 text-xs truncate mt-0.5">{chapterName}</div>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {chapters.length > 1 && (
              <button onClick={() => setShowChapterDrawer(true)} className="text-white/80 hover:text-white p-1" title="章节列表"><Bookmark size={18} /></button>
            )}
            <button onClick={() => setShowSettings(v => !v)} className={`p-1 transition-colors ${showSettings ? 'text-brand-400' : 'text-white/80 hover:text-white'}`} title="阅读设置"><Settings size={18} /></button>
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
        <div className="absolute bottom-0 left-0 right-0 z-20 h-10 bg-black/90">
          <div className="flex items-center gap-3 px-4 h-full">
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={onPrevChapter} disabled={!hasPrevChapter} className="text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-default p-0.5" title="上一话"><ChevronLeft size={16} /></button>
              <span className="text-white/60 text-xs tabular-nums min-w-[5ch] text-center">{activePage + 1}/{totalPages}</span>
              <button onClick={onNextChapter} disabled={!hasNextChapter} className="text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-default p-0.5" title="下一话"><ChevronRight size={16} /></button>
            </div>
            <div
              ref={progressRef}
              className="flex-1 h-5 cursor-pointer relative group -my-1.5"
              onMouseDown={(e) => onDragStart(e.clientX, e.clientY)}
              onTouchStart={(e) => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
            >
              <div className="h-2 mt-1.5 bg-gray-700/50 rounded-full overflow-hidden">
                {totalPages > 1 && dotPositions.map((p, i) => {
                  const leftPct = totalPages > 1 ? (p / (totalPages - 1)) * 100 : 0;
                  const isBefore = p <= activePage;
                  return (
                    <div
                      key={i}
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
                      style={{ left: `${leftPct}%` }}
                    >
                      <div className={`rounded-full transition-all duration-150 ${isBefore ? 'w-2.5 h-2.5 bg-brand-300' : 'w-2 h-2 bg-gray-500'}`} />
                    </div>
                  );
                })}
                <div
                  className="h-full bg-brand-500 rounded-full relative flex items-center"
                  style={{
                    width: `${activePct}%`,
                    transition: dragging ? 'none' : undefined,
                  }}
                >
                  <div className="absolute right-0 w-4 h-4 bg-brand-500 rounded-full shadow-md -translate-y-1/2 top-1/2 translate-x-1/2 opacity-100 ring-2 ring-brand-700/30" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 text-white/40 text-xs shrink-0">
              <ChevronUp size={12} /><ChevronDown size={12} />
            </div>
          </div>
        </div>
      )}

      {/* Info bar — left/right */}
      {barVisible && !isHorizontalBar && (
        <div className={`absolute top-0 bottom-0 z-20 ${barSide === 'right' ? 'right-0' : 'left-0'}`} style={{ width: 40 }}>
          <div className="flex flex-col items-center gap-2 py-4 h-full" style={{ paddingTop: '3.5rem' }}>
            <div className="flex flex-col-reverse items-center gap-0.5">
              <button onClick={onNextChapter} disabled={!hasNextChapter} className="text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-default" title="下一话"><ChevronDown size={14} /></button>
              <span className="text-white/60 text-[10px] tabular-nums" style={{ writingMode: 'vertical-rl' }}>{activePage + 1}/{totalPages}</span>
              <button onClick={onPrevChapter} disabled={!hasPrevChapter} className="text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-default" title="上一话"><ChevronUp size={14} /></button>
            </div>
            <div
              ref={progressRef}
              className="w-5 flex-1 cursor-pointer relative group -mx-1.5"
              onMouseDown={(e) => onDragStart(e.clientX, e.clientY)}
              onTouchStart={(e) => onDragStart(e.touches[0].clientX, e.touches[0].clientY)}
            >
              <div className="w-2 mx-1.5 h-full bg-gray-700/50 rounded-full overflow-hidden">
                {totalPages > 1 && dotPositions.map((p, i) => {
                  const topPct = totalPages > 1 ? (p / (totalPages - 1)) * 100 : 0;
                  const isBefore = p <= activePage;
                  return (
                    <div
                      key={i}
                      className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
                      style={{ top: `${topPct}%` }}
                    >
                      <div className={`rounded-full transition-all duration-150 ${isBefore ? 'w-2.5 h-2.5 bg-brand-300' : 'w-2 h-2 bg-gray-500'}`} />
                    </div>
                  );
                })}
                <div
                  className="w-full bg-brand-500 rounded-full relative flex justify-center"
                  style={{
                    height: `${activePct}%`,
                    transition: dragging ? 'none' : undefined,
                  }}
                >
                  <div className="absolute bottom-0 w-4 h-4 bg-brand-500 rounded-full shadow-md -translate-x-1/2 left-1/2 translate-y-1/2 opacity-100 ring-2 ring-brand-700/30" />
                </div>
              </div>
            </div>
            <div className="flex flex-col items-center gap-0.5 text-white/40 text-xs">
              <ChevronLeft size={10} /><ChevronRight size={10} />
            </div>
          </div>
        </div>
      )}

      {!isVertical && (
        <div className={`absolute inset-0 z-10 flex transition-opacity duration-300 ${visible ? 'pointer-events-none' : 'pointer-events-auto'}`}>
          <div className="w-1/3 h-full" onClick={onPrevPage} />
          <div className="w-1/3 h-full" onClick={onToggleVisibility} />
          <div className="w-1/3 h-full" onClick={onNextPage} />
        </div>
      )}
    </>
  );
}
