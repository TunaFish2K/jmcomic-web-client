import pLimit from "p-limit";

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
