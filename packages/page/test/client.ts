// Optional developer smoke test; not part of CI.
import { createLocalClient } from 'jmcomic-sdk/node';
const client = createLocalClient();
try {
    const result = await client.search('291535');
    console.log({ total: result.total, redirectId: result.redirectId });
    const album = await client.getAlbum('291535');
    const chapter = await client.getChapter(album.chapters[0]?.id ?? album.id);
    console.log({ albumId: album.id, chapterId: chapter.id, pages: chapter.images.length });
} finally { client.dispose(); }
