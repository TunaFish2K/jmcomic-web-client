import pLimit from "p-limit";
import md5 from "crypto-js/md5";
import encodingHex from "crypto-js/enc-hex";
import type { PhotoWithScrambleId } from "./client";
import { AsyncZipDeflate, Zip } from "fflate";
import { PDFDocument } from "pdf-lib";

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
export async function downloadAllImages(
    images: { name: string; url: string }[],
    concurrency: number = 20,
) {
    const limit = pLimit(concurrency);
    const tasks = images.map((v) => limit(() => downloadImage(v)));
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

        (async () => {
            try {
                let processed = 0;
                const total = photo.images.length;
                const filenameSize = total.toString().length;
                const downloadedImages = await downloadAllImages(photo.images);

                for (const image of downloadedImages) {
                    if (image.data === null) {
                        processed += 1;
                        if (onProgress) onProgress(processed, total);
                        continue;
                    }
                    const sliceCount = getSliceCount(
                        photo.scrambleId,
                        parseInt(photo.id),
                        image.name,
                    );
                    const decrypted = await reverseImageBySlice(
                        image.data,
                        sliceCount,
                    );

                    const file = new AsyncZipDeflate(
                        `${processed}`.padStart(filenameSize, "0") + ".jpg",
                        { level: 6 },
                    );
                    zip.add(file);
                    file.push(new Uint8Array(decrypted.data), true);
                    if (onProgress) onProgress(processed, total);
                    processed += 1;
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
    const downloadedImages = await downloadAllImages(photo.images);

    for (const image of downloadedImages) {
        if (image.data === null) {
            processed += 1;
            if (onProgress) onProgress(processed, total);
            continue;
        }
        const sliceCount = getSliceCount(
            photo.scrambleId,
            parseInt(photo.id),
            image.name,
        );
        const decrypted = await reverseImageBySlice(image.data, sliceCount);

        const page = pdfDocument.addPage([decrypted.width, decrypted.height]);
        const pdfImage = await pdfDocument.embedJpg(decrypted.data);
        page.drawImage(pdfImage, {
            x: 0,
            y: 0,
            width: decrypted.width,
            height: decrypted.height,
        });

        processed++;
        onProgress?.(processed, total);
    }

    return (await pdfDocument.save()).buffer;
}
