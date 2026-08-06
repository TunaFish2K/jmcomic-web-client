import type { PhotoWithScrambleId } from '@tiny-client/shared';
import { getReaderPageStyle } from './layout';
import type { ReadingDirection } from './reader-store';

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
  onClick: React.MouseEventHandler<HTMLDivElement>;
  onImageLoad: (chapterId: string, pageIndex: number, image: HTMLImageElement) => void;
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
  onClick,
  onImageLoad,
}: ReaderPageCanvasProps) {
  return (
    <div ref={containerRef} className="h-full w-full" style={scrollDivStyle} onClick={onClick}>
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
              <img
                src={url}
                alt=""
                draggable={false}
                className={imgCls}
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
