import { processImage } from './image-bridge';
export { sliceCount as getSliceCount } from 'jmcomic-sdk-pwa/image';

export async function reverseImageBySlice(image: ArrayBuffer, sliceCount: number, signal?: AbortSignal) {
    const result = await processImage(image, sliceCount, { format: 'png', signal });
    return { data: result.data.buffer as ArrayBuffer, width: result.width, height: result.height };
}
