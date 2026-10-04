/** Browser-side shapes returned by the Worker's `/api/mobile/*` routes. */
export type MobileComic = {
    id: string; name: string; author: string; image: string;
    category: { id: string; title: string } | null;
    liked: boolean | null; favorite: boolean | null; updatedAt: number | null;
};
export type MobileSection = { id: string; title: string; type: string; filterValue: string; items: MobileComic[] };
export type ComicPage = { total: number; items: MobileComic[] };
export type Categories = {
    categories: { id: string; name: string; slug: string; total: number }[];
    blocks: { title: string; tags: string[] }[];
};
export type Week = { periods: { id: string; title: string; time: string }[]; types: { id: string; title: string }[] };
export type MobileComment = {
    id: string; parentId: string | null; albumId: string; userId: string; username: string;
    content: string; likes: number; createdAt: string; spoiler: boolean;
};
export type Favorites = { total: number; folders: { id: string; name: string }[]; items: MobileComic[] };
export type Daily = {
    dailyId: string; eventName: string; progress: string;
    record: { date: string; signed: boolean; bonus: boolean }[][];
    rewards: { threeDaysCoin: number; sevenDaysCoin: number; threeDaysExp: number; sevenDaysExp: number };
};
export type Member = { uid: string; username: string; email: string; level: string; coin: number };
export type LoginResponse = { session: string; expiresAt: number; remember?: boolean; member: Member };
export type WriteResult = { ok: boolean; message: string; type?: string };
export type FolderEdit =
    | { type: "add"; name: string }
    | { type: "edit"; folderId: string; name: string }
    | { type: "del"; folderId: string }
    | { type: "move"; folderId: string; aid: string };
