import md5 from 'crypto-js/md5';
import encodingHex from 'crypto-js/enc-hex';

export function getSliceCount(
    scrambleId: number,
    photoId: number,
    filename: string,
): number {
    if (photoId < scrambleId) return 0;
    if (filename.endsWith('.gif')) return 0;
    if (photoId < 268850) return 10;

    const hex = md5(`${photoId}${filename.split('.')[0]}`).toString(encodingHex);
    return (hex.charCodeAt(hex.length - 1) % (photoId < 421926 ? 10 : 8)) * 2 + 2;
}

export async function reverseImageBySlice(image: ArrayBuffer, sliceCount: number) {
    const bitmap = await createImageBitmap(new Blob([image]));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建图片画布');
        if (sliceCount <= 0) {
            context.drawImage(bitmap, 0, 0);
        } else {
            const remainder = bitmap.height % sliceCount;
            const baseHeight = Math.floor(bitmap.height / sliceCount);
            for (let index = 0; index < sliceCount; index++) {
                const sourceY = bitmap.height - baseHeight * (index + 1) - remainder;
                const destinationY = baseHeight * index + (index === 0 ? 0 : remainder);
                const height = baseHeight + (index === 0 ? remainder : 0);
                context.drawImage(
                    bitmap,
                    0,
                    sourceY,
                    bitmap.width,
                    height,
                    0,
                    destinationY,
                    bitmap.width,
                    height,
                );
            }
        }
        return {
            data: await (await canvas.convertToBlob()).arrayBuffer(),
            width: bitmap.width,
            height: bitmap.height,
        };
    } finally {
        bitmap.close();
        canvas.width = 1;
        canvas.height = 1;
    }
}
