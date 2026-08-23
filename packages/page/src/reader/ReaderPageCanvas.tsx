import type { PhotoWithScrambleId } from '@tiny-client/shared';
import { ReaderTranslatedImage } from '../translation/TranslationLayer';
import type { PageTranslationRecord } from '../translation/types';
import { getReaderPageStyle } from './layout';
import type { ReadingDirection } from './reader-store';
import { RefreshCw } from 'lucide-react';

type ReaderPageCanvasProps = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  images: PhotoWithScrambleId['images'];
  blobMap: Map<number, string>;
  loadingPages: Set<number>;
  failedPages: Set<number>;
  pageAspectRatios: Map<number, number>;
  direction: ReadingDirection;
  seamlessMode: boolean;
  snapEnabled: boolean;
  imgCls: string;
  chapterId: string;
  scrollDivStyle: React.CSSProperties;
  currentPage: number;
  translationRecord: PageTranslationRecord | null;
  translationVisible: boolean;
  onClick: React.MouseEventHandler<HTMLDivElement>;
  onImageLoad: (chapterId: string, pageIndex: number, image: HTMLImageElement) => void;
  onRetryPage: (pageIndex: number) => void;
};

export function ReaderPageCanvas({
  containerRef,
  images,
  blobMap,
  loadingPages,
  failedPages,
  pageAspectRatios,
  direction,
  seamlessMode,
  snapEnabled,
  imgCls,
  chapterId,
  scrollDivStyle,
  currentPage,
  translationRecord,
  translationVisible,
  onClick,
  onImageLoad,
  onRetryPage,
}: ReaderPageCanvasProps) {
  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={scrollDivStyle}
      onClick={onClick}
      data-reader-container=""
      role="region"
      aria-label="漫画阅读区域"
    >
      {images.map((img, i) => {
        const url = blobMap.get(i);
        const shouldRenderImage = loadingPages.has(i);
        return (
          <div
            key={img.name}
            data-reader-page={i}
            className="shrink-0"
            style={getReaderPageStyle({
              direction,
              seamlessMode,
              aspectRatio: pageAspectRatios.get(i),
              snapEnabled,
            })}
          >
            {url ? (
              <ReaderTranslatedImage
                src={url}
                className={imgCls}
                record={i === currentPage ? translationRecord : null}
                translationVisible={translationVisible}
                onLoad={(event) => onImageLoad(chapterId, i, event.currentTarget)}
              />
            ) : (
              <div className="relative h-full w-full overflow-hidden bg-gray-900/60">
                {shouldRenderImage && !failedPages.has(i) && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-500/70 border-t-white" />
                    </div>
                  </div>
                )}
                {failedPages.has(i) && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      type="button"
                      className="flex min-h-11 items-center gap-2 rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-100 ring-1 ring-white/10 transition-colors hover:bg-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRetryPage(i);
                      }}
                      aria-label={`重新加载第 ${i + 1} 页`}
                    >
                      <RefreshCw size={16} />
                      重新加载
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
