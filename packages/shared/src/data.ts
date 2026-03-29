import pLimit from "p-limit";
import md5 from "crypto-js/md5";
import encodingHex from "crypto-js/enc-hex";
import type { PhotoWithScrambleId } from "./client";
import { ZipPassThrough, Zip } from "fflate";
import { PDFDocument } from "pdf-lib";
import { getCachedImage, setCachedImage, generateImageCacheKey } from "./cache";

type NamedPhoto = {
    name: string;
    photo: PhotoWithScrambleId;
};

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

function sanitizeArchiveSegment(name: string) {
    return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim() || "untitled";
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
    concurrency: number = 5,
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

        (async () => {
            try {
                const total = photo.images.length;
                const filenameSize = total.toString().length;
                let processed = 0;
                const limit = pLimit(concurrency);

                // Download + decrypt all images in parallel, preserving index order
                const decrypted = await Promise.all(
                    photo.images.map((imageInfo, i) =>
                        limit(async () => {
                            try {
                                // Check cache first
                                const cacheKey = generateImageCacheKey(photo.id, imageInfo.name);
                                const cached = await getCachedImage(cacheKey);
                                if (cached) {
                                    processed += 1;
                                    onProgress?.(processed, total);
                                    return { i, data: cached };
                                }

                                const downloadResult = await downloadImage(imageInfo);
                                if (downloadResult.data === null) {
                                    console.error(`跳过图片 ${imageInfo.name}: 下载失败`);
                                    processed += 1;
                                    onProgress?.(processed, total);
                                    return { i, data: null };
                                }

                                const sliceCount = getSliceCount(
                                    photo.scrambleId,
                                    parseInt(photo.id),
                                    imageInfo.name,
                                );
                                const reversedData = await reverseImageBySlice(
                                    downloadResult.data,
                                    sliceCount,
                                );
                                const jpegData = await convertToJpeg(reversedData.data);
                                if (!jpegData) {
                                    console.error(`跳过图片 ${imageInfo.name}: 转换失败`);
                                    processed += 1;
                                    onProgress?.(processed, total);
                                    return { i, data: null };
                                }

                                await setCachedImage(cacheKey, jpegData);
                                processed += 1;
                                onProgress?.(processed, total);
                                return { i, data: jpegData };
                            } catch (error) {
                                console.error(`处理图片 ${imageInfo.name} 失败:`, error);
                                processed += 1;
                                onProgress?.(processed, total);
                                return { i, data: null };
                            }
                        })
                    )
                );

                // Write into ZIP in index order
                for (const { i, data } of decrypted) {
                    if (data === null) continue;
                    const file = new ZipPassThrough(
                        `${i}`.padStart(filenameSize, "0") + ".jpg",
                    );
                    zip.add(file);
                    file.push(new Uint8Array(data), true);
                }

                zip.end();
            } catch (err) {
                reject(err);
            }
        })();
    });
}

export function downloadAndDecryptImagesOfPhotosThenWriteIntoZipFile(
    photos: NamedPhoto[],
    onProgress?: (done: number, total: number) => void,
    concurrency: number = 5,
    layout: "folders" | "flat" = "folders",
) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
        const chunks: Uint8Array[] = [];
        const total = photos.reduce((sum, { photo }) => sum + photo.images.length, 0);
        const chapterDigits = String(Math.max(photos.length, 1)).length;
        let completed = 0;

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

        (async () => {
            try {
                for (let photoIndex = 0; photoIndex < photos.length; photoIndex++) {
                    const { name, photo } = photos[photoIndex];
                    const chapterPrefix = `${String(photoIndex + 1).padStart(chapterDigits, "0")}-${sanitizeArchiveSegment(name)}`;
                    const imageDigits = String(Math.max(photo.images.length, 1)).length;
                    let previousDone = 0;

                    const downloadedImages = await downloadAllImages(
                        photo.images,
                        concurrency,
                        (done) => {
                            completed += done - previousDone;
                            previousDone = done;
                            onProgress?.(completed, total);
                        },
                        photo.id,
                        photo.scrambleId,
                    );

                    for (let imageIndex = 0; imageIndex < downloadedImages.length; imageIndex++) {
                        const image = downloadedImages[imageIndex];
                        if (image.data === null) continue;

                        const imageFileName = `${String(imageIndex + 1).padStart(imageDigits, "0")}.jpg`;
                        const entryName = layout === "folders"
                            ? `${chapterPrefix}/${imageFileName}`
                            : `${chapterPrefix}-${imageFileName}`;

                        const file = new ZipPassThrough(entryName);
                        zip.add(file);
                        file.push(new Uint8Array(image.data), true);
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

export async function downloadAndDecryptImagesOfPhotosThenWriteIntoPDFFile(
    photos: NamedPhoto[],
    onProgress?: (done: number, total: number) => void,
    concurrency: number = 20,
) {
    const pdfDocument = await PDFDocument.create();
    const totalImages = photos.reduce((sum, { photo }) => sum + photo.images.length, 0);
    const total = totalImages * 2;
    let processed = 0;

    for (const { photo } of photos) {
        let previousDone = 0;
        const downloadedImages = await downloadAllImages(
            photo.images,
            concurrency,
            (done) => {
                processed += done - previousDone;
                previousDone = done;
                onProgress?.(processed, total);
            },
            photo.id,
            photo.scrambleId,
        );

        for (const image of downloadedImages) {
            processed += 1;

            if (image.data === null) {
                onProgress?.(processed, total);
                continue;
            }

            try {
                const bitmap = await createImageBitmap(new Blob([image.data]));
                const width = bitmap.width;
                const height = bitmap.height;
                bitmap.close();

                const pdfImage = await pdfDocument.embedJpg(image.data);
                const page = pdfDocument.addPage([width, height]);
                page.drawImage(pdfImage, {
                    x: 0,
                    y: 0,
                    width,
                    height,
                });
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error(`跳过图片 ${image.name}: 合并 PDF 失败 - ${errorMsg}`);
            }

            onProgress?.(processed, total);
        }
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
