import { useCallback, useEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowLeftRight, ArrowDownUp, List, Bookmark, Settings } from 'lucide-react';
import type { ReadingDirection } from './reader-store';

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
                ch.id === currentChapterId ? 'text-blue-400 bg-gray-800' : 'text-gray-300'
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
  seamless,
  autoSnap,
  onToggleDirection,
  onToggleSeamless,
  onToggleAutoSnap,
  onClose,
}: {
  direction: ReadingDirection;
  seamless: boolean;
  autoSnap: boolean;
  onToggleDirection: () => void;
  onToggleSeamless: () => void;
  onToggleAutoSnap: () => void;
  onClose: () => void;
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
        {/* Direction */}
        <div className="flex items-center justify-between">
          <span className="text-gray-300 text-xs">阅读方向</span>
          <button
            onClick={onToggleDirection}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-xs transition-colors"
          >
            {isVertical ? <><ArrowDownUp size={14} /> 上下滚动</> : <><ArrowLeftRight size={14} /> 左右翻页</>}
          </button>
        </div>

        {/* Seamless scroll */}
        <div className="flex items-center justify-between">
          <span className="text-gray-300 text-xs">无缝衔接</span>
          <button
            onClick={onToggleSeamless}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              seamless ? 'bg-blue-500' : 'bg-gray-600'
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                seamless ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* Auto snap */}
        <div className="flex items-center justify-between">
          <span className="text-gray-300 text-xs">自动吸附</span>
          <button
            onClick={onToggleAutoSnap}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              autoSnap ? 'bg-blue-500' : 'bg-gray-600'
            }`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                autoSnap ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
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
  direction,
  hasPrevChapter,
  hasNextChapter,
  seamless,
  autoSnap,
  onToggleVisibility,
  onClose,
  onPrevPage,
  onNextPage,
  onPrevChapter,
  onNextChapter,
  onGoToChapter,
  onToggleDirection,
  onToggleSeamless,
  onToggleAutoSnap,
}: {
  visible: boolean;
  title: string;
  currentPage: number;
  totalPages: number;
  chapterName: string;
  chapters: ChapterInfo[];
  currentChapterId: string;
  direction: ReadingDirection;
  hasPrevChapter: boolean;
  hasNextChapter: boolean;
  seamless: boolean;
  autoSnap: boolean;
  onToggleVisibility: () => void;
  onClose: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onGoToChapter: (id: string) => void;
  onToggleDirection: () => void;
  onToggleSeamless: () => void;
  onToggleAutoSnap: () => void;
}) {
  const [showChapterDrawer, setShowChapterDrawer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const progressPct = totalPages > 0 ? Math.round(((currentPage + 1) / totalPages) * 100) : 0;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (showSettings) { setShowSettings(false); return; }
      if (showChapterDrawer) { setShowChapterDrawer(false); return; }
      onClose();
      return;
    }
    if (showChapterDrawer || showSettings) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onPrevPage();
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onNextPage();
    }
    if (e.key === 'f' || e.key === 'F') onToggleVisibility();
  }, [showChapterDrawer, showSettings, onClose, onPrevPage, onNextPage, onToggleVisibility]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const isVertical = direction === 'top-down';

  return (
    <>
      {showChapterDrawer && (
        <ChapterDrawer
          chapters={chapters}
          currentChapterId={currentChapterId}
          onGoTo={onGoToChapter}
          onClose={() => setShowChapterDrawer(false)}
        />
      )}

      {!visible && (
        <button
          onClick={onToggleVisibility}
          className="absolute bottom-4 right-4 z-30 w-10 h-10 rounded-full bg-gray-800/80 text-gray-300 flex items-center justify-center hover:bg-gray-700 transition-colors"
          title="显示控制栏 (F)"
        >
          <List size={18} />
        </button>
      )}

      {/* Settings panel */}
      {visible && showSettings && (
        <SettingsPanel
          direction={direction}
          seamless={seamless}
          autoSnap={autoSnap}
          onToggleDirection={onToggleDirection}
          onToggleSeamless={onToggleSeamless}
          onToggleAutoSnap={onToggleAutoSnap}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Top bar */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${
          visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onClose} className="text-white/90 hover:text-white shrink-0">
              <X size={22} />
            </button>
            <div className="min-w-0">
              <div className="text-white text-sm font-medium truncate">{title}</div>
              {chapterName && (
                <div className="text-gray-400 text-xs truncate mt-0.5">{chapterName}</div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-2">
            {chapters.length > 1 && (
              <button
                onClick={() => setShowChapterDrawer(true)}
                className="text-white/80 hover:text-white p-1"
                title="章节列表"
              >
                <Bookmark size={18} />
              </button>
            )}
            <button
              onClick={() => setShowSettings((v) => !v)}
              className={`p-1 transition-colors ${showSettings ? 'text-blue-400' : 'text-white/80 hover:text-white'}`}
              title="阅读设置"
            >
              <Settings size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 bg-gradient-to-t from-black/80 to-transparent transition-opacity duration-300 ${
          visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex flex-col px-4 pb-4 pt-2">
          {/* Progress bar */}
          <div className="w-full h-1 bg-gray-700 rounded-full overflow-hidden mb-3">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            {/* Chapter nav */}
            <div className="flex items-center gap-1">
              <button
                onClick={onPrevChapter}
                disabled={!hasPrevChapter}
                className="text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-default p-1"
                title="上一话"
              >
                <ChevronLeft size={20} />
              </button>
              <span className="text-white/60 text-xs tabular-nums min-w-[5ch] text-center">
                {currentPage + 1}/{totalPages}
              </span>
              <button
                onClick={onNextChapter}
                disabled={!hasNextChapter}
                className="text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-default p-1"
                title="下一话"
              >
                <ChevronRight size={20} />
              </button>
            </div>

            {/* Direction hint */}
            <div className="flex items-center gap-1 text-white/40 text-xs">
              {isVertical
                ? <><ChevronUp size={14} /><ChevronDown size={14} /></>
                : <><ChevronLeft size={14} /><ChevronRight size={14} /></>
              }
            </div>
          </div>
        </div>
      </div>

      {/* Tap zones — only for left-right mode; vertical uses native scroll */}
      {!isVertical && (
        <div
          className={`absolute inset-0 z-10 flex transition-opacity duration-300 ${
            visible ? 'pointer-events-none' : 'pointer-events-auto'
          }`}
        >
          <div className="w-1/3 h-full" onClick={onPrevPage} />
          <div className="w-1/3 h-full" onClick={onToggleVisibility} />
          <div className="w-1/3 h-full" onClick={onNextPage} />
        </div>
      )}
    </>
  );
}
