import pLimit from "p-limit";
import md5 from "crypto-js/md5";
import encodingHex from "crypto-js/enc-hex";

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
