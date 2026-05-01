import { useEffect, useState } from 'react';
import { getSliceCount, reverseImageBySlice } from '@tiny-client/shared';
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
}: {
  image: { name: string; url: string };
  photo: PhotoWithScrambleId;
  onLoad?: (blobUrl: string) => void;
  className?: string;
}) {
  const cacheKey = `${photo.id}/${image.name}`;
  const [blobUrl, setBlobUrl] = useState<string | null>(() => memoryCache.get(cacheKey) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (blobUrl) return;

    let cancelled = false;
    let createdUrl: string | null = null;

    (async () => {
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
      className={`bg-gray-900 bg-gradient-to-r from-gray-900 via-gray-700 to-gray-900 bg-[length:200%_100%] animate-shimmer ${className ?? ''}`}
    />
  );

  return (
    <img
      src={blobUrl}
      alt=""
      className={className}
      draggable={false}
      onLoad={onLoad}
      onError={() => setFailed(true)}
    />
  );
}
