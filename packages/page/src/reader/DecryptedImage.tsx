import { useEffect, useState } from 'react';
import { getSliceCount, reverseImageBySlice, getCachedImage, setCachedImage } from '@tiny-client/shared';
import type { PhotoWithScrambleId } from '@tiny-client/shared';

const memoryCache = new Map<string, string>();

const RETRY_DELAYS = [400, 1000, 2000];

function convertToJpeg(imageData: ArrayBuffer): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    try {
      const blob = new Blob([imageData]);
      createImageBitmap(blob).then((bitmap) => {
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 }).then((jpegBlob) => {
          jpegBlob.arrayBuffer().then(resolve);
        });
      }).catch(() => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

export function DecryptedImage({
  image,
  photo,
  onLoad,
  className,
  style,
}: {
  image: { name: string; url: string };
  photo: PhotoWithScrambleId;
  onLoad?: (blobUrl: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const cacheKey = `${photo.id}/${image.name}`;
  const [blobUrl, setBlobUrl] = useState<string | null>(() => memoryCache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (blobUrl) return;

    let cancelled = false;
    let createdUrl: string | null = null;

    (async () => {
      // Try IndexedDB cache first
      const cachedBuffer = await getCachedImage(cacheKey);
      if (cachedBuffer && !cancelled) {
        const blob = new Blob([cachedBuffer], { type: 'image/jpeg' });
        createdUrl = URL.createObjectURL(blob);
        memoryCache.set(cacheKey, createdUrl);
        setBlobUrl(createdUrl);
        onLoad?.(createdUrl);
        return;
      }

      for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
        if (cancelled) break;
        try {
          const res = await fetch(image.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = await res.arrayBuffer();
          const filename = image.url.split('/').pop() ?? '';
          const slices = getSliceCount(photo.scrambleId, parseInt(photo.id), filename);
          let finalBuffer: ArrayBuffer;
          if (slices > 0) {
            const reversed = await reverseImageBySlice(buffer, slices);
            finalBuffer = reversed.data;
          } else {
            finalBuffer = buffer;
          }
          const jpeg = await convertToJpeg(finalBuffer);
          if (!jpeg) throw new Error('JPEG conversion failed');
          const blob = new Blob([jpeg], { type: 'image/jpeg' });
          createdUrl = URL.createObjectURL(blob);
          memoryCache.set(cacheKey, createdUrl);
          setCachedImage(cacheKey, jpeg);
          if (!cancelled) {
            setBlobUrl(createdUrl);
            onLoad?.(createdUrl);
          }
          return;
        } catch {
          if (attempt < RETRY_DELAYS.length) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          }
        }
      }
      if (!cancelled) setFailed(true);
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, image.url, photo.id, photo.scrambleId]);

  if (failed) return <div className={`bg-gray-800 ${className ?? ''}`} />;
  if (!blobUrl) return (
    <div
      className={`relative overflow-hidden bg-gray-900/60 ${className ?? ''}`}
      style={style}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-500/70 border-t-white" />
        </div>
      </div>
    </div>
  );

  return (
    <img
      src={blobUrl}
      alt=""
      className={className}
      style={style}
      draggable={false}
      onLoad={() => onLoad?.(blobUrl!)}
      onError={() => setFailed(true)}
    />
  );
}
