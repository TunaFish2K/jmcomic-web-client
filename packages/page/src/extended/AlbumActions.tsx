import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, MessageSquare, Star } from "lucide-react";
import { accountApi, describeError, mobileApi } from "./api";
import { htmlToText } from "./text";
import { useAccount } from "./session";
import { Notice, Pager } from "./ui";
import { buttonClass, inputClass, useExtendedShell } from "./shell";
import type { MobileComment, WriteResult } from "./types";

function useWrite() {
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
    const report = (result: WriteResult, success: string) =>
        setMessage({ text: result.message || (result.ok ? success : "操作失败"), error: !result.ok });
    const fail = (error: unknown) => setMessage({ text: describeError(error), error: true });
    return { message, report, fail, clear: () => setMessage(null) };
}

/** Favorite, like and folder actions shown inside the album dialog. */
export function AlbumActions({ albumId }: { albumId: string }) {
    const { account } = useAccount();
    const { requireLogin, accountEnabled } = useExtendedShell();
    const queryClient = useQueryClient();
    const write = useWrite();
    const [folder, setFolder] = useState("");
    const folders = useQuery({
        queryKey: ["account", account?.member.uid, "favorites", 1, "0", "mr"],
        queryFn: ({ signal }) => accountApi.favorites(1, "0", "mr", signal),
        enabled: !!account,
        staleTime: 60_000,
    });
    const invalidateFavorites = () => queryClient.invalidateQueries({ queryKey: ["account", account?.member.uid, "favorites"] });

    const toggle = useMutation({
        mutationFn: () => accountApi.toggleFavorite(albumId),
        onSuccess: (result) => {
            write.report(result, result.type === "add" ? "已加入收藏" : "已取消收藏");
            void invalidateFavorites();
        },
        onError: write.fail,
    });
    const like = useMutation({ mutationFn: () => accountApi.like(albumId), onSuccess: (result) => write.report(result, "已点赞"), onError: write.fail });
    const move = useMutation({
        mutationFn: (folderId: string) => accountApi.editFolder({ type: "move", folderId, aid: albumId }),
        onSuccess: (result) => { write.report(result, "已移动"); void invalidateFavorites(); },
        onError: write.fail,
    });
    const busy = toggle.isPending || like.isPending || move.isPending;

    if (accountEnabled === false) return null;
    return (
        <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={busy} onClick={() => requireLogin(() => toggle.mutate())}>
                    <Star size={14} />收藏 / 取消收藏
                </button>
                <button type="button" className={buttonClass} disabled={busy} onClick={() => requireLogin(() => like.mutate())}>
                    <Heart size={14} />点赞
                </button>
            </div>
            {account && (folders.data?.folders.length ?? 0) > 0 && (
                <div className="flex gap-2">
                    <select aria-label="目标收藏夹" className={inputClass} value={folder} onChange={(event) => setFolder(event.target.value)}>
                        <option value="">选择收藏夹</option>
                        {folders.data!.folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <button type="button" className={buttonClass} disabled={!folder || busy} onClick={() => move.mutate(folder)}>移动</button>
                </div>
            )}
            {write.message && <Notice tone={write.message.error ? "error" : "info"}>{write.message.text}</Notice>}
            <CommentsPanel albumId={albumId} />
        </div>
    );
}

/** Groups the flat upstream list so replies follow their parent. */
function threads(items: MobileComment[]) {
    const ids = new Set(items.map((item) => item.id));
    const roots = items.filter((item) => !item.parentId || !ids.has(item.parentId));
    return roots.map((root) => ({ root, replies: items.filter((item) => item.parentId === root.id) }));
}

export function CommentsPanel({ albumId }: { albumId: string }) {
    const { account } = useAccount();
    const { requireLogin } = useExtendedShell();
    const [open, setOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [replyTo, setReplyTo] = useState<MobileComment | null>(null);
    const [draft, setDraft] = useState("");
    const write = useWrite();
    const comments = useQuery({
        queryKey: ["mobile", "comments", albumId, page],
        queryFn: ({ signal }) => mobileApi.comments(albumId, page, signal),
        enabled: open,
        staleTime: 60_000,
    });
    const send = useMutation({
        mutationFn: () => accountApi.comment(albumId, draft.trim(), replyTo?.id),
        onSuccess: (result) => {
            write.report(result, "评论已提交，列表可能稍后更新");
            if (result.ok) { setDraft(""); setReplyTo(null); }
        },
        onError: write.fail,
    });
    const remove = useMutation({
        mutationFn: (comment: MobileComment) => accountApi.deleteComment(comment.id, albumId),
        onSuccess: (result) => write.report(result, "已删除，列表可能稍后更新"),
        onError: write.fail,
    });

    if (!open) {
        return (
            <button type="button" className={`${buttonClass} w-full`} onClick={() => setOpen(true)}>
                <MessageSquare size={14} />查看评论
            </button>
        );
    }
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (draft.trim()) requireLogin(() => send.mutate());
    };
    const items = comments.data?.items ?? [];
    const renderComment = (comment: MobileComment, reply = false) => (
        <li key={comment.id} className={`space-y-1 ${reply ? "ml-4 border-l border-gray-200 pl-3 dark:border-gray-700" : ""}`}>
            <div className="flex items-center justify-between gap-2 text-xs text-gray-400">
                <span className="truncate">{comment.username} · {comment.createdAt}</span>
                <span className="flex shrink-0 gap-2">
                    {!reply && <button type="button" className="hover:text-brand-500" onClick={() => setReplyTo(comment)}>回复</button>}
                    {account && comment.userId === account.member.uid && (
                        <button type="button" className="hover:text-red-500" disabled={remove.isPending} onClick={() => remove.mutate(comment)}>删除</button>
                    )}
                </span>
            </div>
            <p className={`whitespace-pre-wrap break-words text-sm ${comment.spoiler ? "blur-sm hover:blur-none" : ""}`}>{htmlToText(comment.content)}</p>
        </li>
    );
    return (
        <div className="space-y-2">
            <div className="text-xs text-gray-400">评论{comments.data ? ` · 共 ${comments.data.total} 条` : ""}</div>
            <form onSubmit={submit} className="space-y-1">
                {replyTo && (
                    <div className="flex items-center justify-between text-xs text-gray-500">
                        <span>回复 {replyTo.username}</span>
                        <button type="button" onClick={() => setReplyTo(null)}>取消回复</button>
                    </div>
                )}
                <div className="flex gap-2">
                    <input aria-label="评论内容" className={inputClass} value={draft} maxLength={2000}
                        placeholder={account ? "写评论..." : "登录后发表评论"} onChange={(event) => setDraft(event.target.value)} />
                    <button type="submit" className={buttonClass} disabled={!draft.trim() || send.isPending}>发送</button>
                </div>
            </form>
            {write.message && <Notice tone={write.message.error ? "error" : "info"}>{write.message.text}</Notice>}
            {comments.isPending ? <div role="status" className="py-4 text-center text-xs text-gray-400">加载中...</div>
                : comments.isError ? <Notice tone="error">{describeError(comments.error)}</Notice>
                    : items.length === 0 ? <div className="py-4 text-center text-xs text-gray-400">暂无评论</div>
                        : (
                            <ul className="space-y-3">
                                {threads(items).map(({ root, replies }) => (
                                    <li key={root.id} className="list-none space-y-2">
                                        <ul className="space-y-2">{renderComment(root)}{replies.map((item) => renderComment(item, true))}</ul>
                                    </li>
                                ))}
                            </ul>
                        )}
            {comments.data && (
                <Pager page={page} hasPrev={page > 1} hasNext={items.length > 0 && page * items.length < comments.data.total} onChange={setPage} />
            )}
        </div>
    );
}
