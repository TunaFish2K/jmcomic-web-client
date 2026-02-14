import pLimit from "p-limit";
import md5 from "crypto-js/md5";
import encodingHex from "crypto-js/enc-hex";
import type { PhotoWithScrambleId } from "./client";
import { AsyncZipDeflate, Zip } from "fflate";
import { PDFDocument } from "pdf-lib";
import { getCachedImage, setCachedImage, generateImageCacheKey } from "./cache";

async function downloadImage({ name, url }: { name: string; url: string }) {
    try {
        const res = await fetch(url);
        const data = await res.arrayBuffer();
        return {
            name,
            url,
            data,
        };
    } catch (e) {
        const possibleError = e as Error;
        console.log(
            possibleError.stack ?? possibleError.message ?? possibleError,
        );
        return {
            name,
            url,
            data: null,
        };
    }
}
async function convertToJpeg(imageData: ArrayBuffer): Promise<ArrayBuffer | null> {
    try {
        const blob = new Blob([imageData]);
        const bitmap = await createImageBitmap(blob);
        
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        
        const jpegBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
        const jpegData = await jpegBlob.arrayBuffer();
        
        return jpegData;
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`图片转换为 JPEG 失败: ${errorMsg}`);
        return null;
    }
}

export async function downloadAllImages(
    images: { name: string; url: string }[],
    concurrency: number = 20,
    onProgress?: (done: number, total: number) => void,
    photoId?: string,
    scrambleId?: number,
) {
    const limit = pLimit(concurrency);
    let completed = 0;
    const total = images.length;
    
    const tasks = images.map((v) =>
        limit(async () => {
            let result;
            
            // 尝试从缓存读取（缓存的是 JPEG 格式）
            if (photoId) {
                const cacheKey = generateImageCacheKey(photoId, v.name);
                const cached = await getCachedImage(cacheKey);
                if (cached) {
                    result = {
                        name: v.name,
                        url: v.url,
                        data: cached,
                    };
                    completed++;
                    onProgress?.(completed, total);
                    return result;
                }
            }
            
            // 下载图片
            result = await downloadImage(v);
            
            // 解密、转换为 JPEG 并保存到缓存
            if (photoId && scrambleId !== undefined && result.data) {
                const sliceCount = getSliceCount(
                    scrambleId,
                    parseInt(photoId),
                    v.name,
                );
                const decrypted = await reverseImageBySlice(result.data, sliceCount);
                const jpegData = await convertToJpeg(decrypted.data);
                
                if (jpegData) {
                    const cacheKey = generateImageCacheKey(photoId, v.name);
                    await setCachedImage(cacheKey, jpegData);
                    result.data = jpegData;
                }
            }
            
            completed++;
            onProgress?.(completed, total);
            return result;
        })
    );
    const result = await Promise.all(tasks);
    return result;
}
export function getSliceCount(
    scrambleId: number,
    photoId: number,
    filename: string,
): number {
    if (photoId < scrambleId) return 0;
    if (filename.endsWith(".gif")) return 0;
    if (photoId < 268850) return 10;

    const hex = md5(`${photoId}${filename.split(".")[0]}`).toString(
        encodingHex,
    );
    return (
        (hex.charCodeAt(hex.length - 1) % (photoId < 421926 ? 10 : 8)) * 2 + 2
    );
}

async function arrayBufferToOffscreenCanvas(buffer: ArrayBuffer) {
    const blob = new Blob([buffer]);

    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);

    bitmap.close();
    return canvas;
}

export async function reverseImageBySlice(
    image: ArrayBuffer,
    sliceCount: number,
) {
    const original = await arrayBufferToOffscreenCanvas(image);
    const result = new OffscreenCanvas(original.width, original.height);
    const ctx = result.getContext("2d")!;
    const over = original.height % sliceCount;
    for (let i = 0; i < sliceCount; i++) {
        const move = Math.floor(original.height / sliceCount);
        const sY = original.height - move * (i + 1) - over;
        let dY = move * i;
        let sliceHeight = move;

        if (i === 0) {
            sliceHeight += over;
        } else {
            dY += over;
        }

        ctx.drawImage(
            original,
            0,
            sY,
            original.width,
            sliceHeight,
            0,
            dY,
            original.width,
            sliceHeight,
        );
    }
    return {
        data: await (await result.convertToBlob()).arrayBuffer(),
        width: original.width,
        height: original.height,
    };
}

export function downloadAndDecryptImagesOfPhotoThenWriteIntoZipFile(
    photo: PhotoWithScrambleId,
    onProgress?: (done: number, total: number) => void,
) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
        const chunks: Uint8Array[] = [];

        const zip = new Zip((err, data, final) => {
            if (err) {
                reject(err);
                return;
            }
            chunks.push(data);
            if (final) {
                const totalLength = chunks.reduce(
                    (acc, chunk) => acc + chunk.length,
                    0,
                );
                const result = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    result.set(chunk, offset);
                    offset += chunk.length;
                }
                resolve(result.buffer);
            }
        });

        // 流式处理：下载一张，解密，压缩，写入
        (async () => {
            try {
                const total = photo.images.length;
                const filenameSize = total.toString().length;
                let processed = 0;

                for (let i = 0; i < photo.images.length; i++) {
                    const imageInfo = photo.images[i];
                    
                    try {
                        // 1. 下载单张图片
                        const downloadResult = await downloadImage(imageInfo);
                        
                        if (downloadResult.data === null) {
                            console.error(`跳过图片 ${imageInfo.name}: 下载失败`);
                            processed += 1;
                            onProgress?.(processed, total);
                            continue;
                        }

                        // 检查缓存
                        const cacheKey = generateImageCacheKey(photo.id, imageInfo.name);
                        let jpegData = await getCachedImage(cacheKey);
                        
                        if (!jpegData) {
                            // 2. 解密
                            const sliceCount = getSliceCount(
                                photo.scrambleId,
                                parseInt(photo.id),
                                imageInfo.name,
                            );
                            const decrypted = await reverseImageBySlice(
                                downloadResult.data,
                                sliceCount,
                            );

                            // 3. 转换为 JPEG
                            jpegData = await convertToJpeg(decrypted.data);
                            if (!jpegData) {
                                console.error(`跳过图片 ${imageInfo.name}: 转换失败`);
                                processed += 1;
                                onProgress?.(processed, total);
                                continue;
                            }
                            
                            // 保存到缓存
                            await setCachedImage(cacheKey, jpegData);
                        }

                        // 4. 立即写入 ZIP
                        const file = new AsyncZipDeflate(
                            `${i}`.padStart(filenameSize, "0") + ".jpg",
                            { level: 6 },
                        );
                        zip.add(file);
                        file.push(new Uint8Array(jpegData), true);
                        
                        processed += 1;
                        onProgress?.(processed, total);
                    } catch (error) {
                        console.error(`处理图片 ${imageInfo.name} 失败:`, error);
                        processed += 1;
                        onProgress?.(processed, total);
                    }
                }

                zip.end();
            } catch (err) {
                reject(err);
            }
        })();
    });
}

export async function downloadAndDecryptImagesOfPhotoThenWriteIntoPDFFile(
    photo: PhotoWithScrambleId,
    onProgress?: (done: number, total: number) => void,
) {
    const pdfDocument = await PDFDocument.create();
    let processed = 0;
    const total = photo.images.length;
    const downloadedImages = await downloadAllImages(photo.images, 20, onProgress, photo.id, photo.scrambleId);

    for (const image of downloadedImages) {
        processed += 1;
        
        if (image.data === null) {
            console.error(`跳过图片 ${image.name}: 下载失败`);
            onProgress?.(processed, total);
            continue;
        }
        
        try {
            // 获取图片尺寸
            let width, height;
            try {
                const bitmap = await createImageBitmap(new Blob([image.data]));
                width = bitmap.width;
                height = bitmap.height;
                bitmap.close();
            } catch (e) {
                console.error(`跳过图片 ${image.name}: 无法获取尺寸`);
                onProgress?.(processed, total);
                continue;
            }

            // 尝试嵌入 PDF，捕获 SOI 等错误
            let pdfImage;
            try {
                pdfImage = await pdfDocument.embedJpg(image.data);
            } catch (embedError) {
                const errorMsg = embedError instanceof Error ? embedError.message : String(embedError);
                console.error(`跳过图片 ${image.name}: 嵌入 PDF 失败 - ${errorMsg}`);
                onProgress?.(processed, total);
                continue;
            }
            
            const page = pdfDocument.addPage([width, height]);
            page.drawImage(pdfImage, {
                x: 0,
                y: 0,
                width: width,
                height: height,
            });
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            console.error(`跳过图片 ${image.name}: 处理失败 - ${errorMsg}`);
        }

        onProgress?.(processed, total);
    }

    return (await pdfDocument.save()).buffer;
}

export function startDownload(
    filename: string,
    data: Uint8Array,
    type?: string,
) {
    const blob = new Blob([new Uint8Array(data)], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
