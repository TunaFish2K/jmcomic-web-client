import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { Heart, MessageSquare, Star } from "lucide-react";
import { EmptyBlock, LoadingState, Notice } from "../ui/feedback";
import { SelectField, TextInput } from "../ui/fields";
import { Pager } from "../ui/Pager";
import { accountApi, describeError, mobileApi } from "./api";
import { htmlToText } from "./text";
import { useAccount } from "./session";
import { useExtendedShell } from "./shell";
import type { MobileComment, WriteResult } from "./types";

function useWrite() {
    const [message, setMessage] = useState<{ text: string; tone: "success" | "error" } | null>(null);
    const report = (result: WriteResult, success: string) =>
        setMessage({ text: result.message || (result.ok ? success : "操作失败"), tone: result.ok ? "success" : "error" });
    const fail = (error: unknown) => setMessage({ text: describeError(error), tone: "error" });
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
        <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => requireLogin(() => toggle.mutate())}>
                    <Star size={14} />收藏 / 取消收藏
                </Button>
                <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => requireLogin(() => like.mutate())}>
                    <Heart size={14} />点赞
                </Button>
            </div>
            {account && (folders.data?.folders.length ?? 0) > 0 && (
                <div className="flex items-center gap-2">
                    <SelectField label="目标收藏夹" placeholder="选择收藏夹" value={folder} className="flex-1"
                        options={folders.data!.folders.map((item) => [item.id, item.name] as const)} onChange={setFolder} />
                    <Button variant="secondary" className="h-10" isDisabled={!folder || busy} onPress={() => move.mutate(folder)}>移动</Button>
                </div>
            )}
            {write.message && <Notice tone={write.message.tone}>{write.message.text}</Notice>}
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
            <Button size="sm" variant="secondary" fullWidth onPress={() => setOpen(true)}>
                <MessageSquare size={14} />查看评论
            </Button>
        );
    }
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (draft.trim()) requireLogin(() => send.mutate());
    };
    const items = comments.data?.items ?? [];
    const renderComment = (comment: MobileComment, reply = false) => (
        <li key={comment.id} className={`space-y-1 ${reply ? "ml-4 border-l border-border pl-3" : ""}`}>
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
                <span className="truncate">{comment.username} · {comment.createdAt}</span>
                <span className="flex shrink-0">
                    {!reply && <Button size="sm" variant="ghost" onPress={() => setReplyTo(comment)}>回复</Button>}
                    {account && comment.userId === account.member.uid && (
                        <Button size="sm" variant="ghost" className="text-danger" isDisabled={remove.isPending} onPress={() => remove.mutate(comment)}>删除</Button>
                    )}
                </span>
            </div>
            <p className={`whitespace-pre-wrap break-words text-sm ${comment.spoiler ? "blur-sm hover:blur-none" : ""}`}>{htmlToText(comment.content)}</p>
        </li>
    );
    return (
        <div className="space-y-2">
            <div className="text-xs text-muted">评论{comments.data ? ` · 共 ${comments.data.total} 条` : ""}</div>
            <form onSubmit={submit} className="space-y-1">
                {replyTo && (
                    <div className="flex items-center justify-between text-xs text-muted">
                        <span>回复 {replyTo.username}</span>
                        <Button size="sm" variant="ghost" onPress={() => setReplyTo(null)}>取消回复</Button>
                    </div>
                )}
                <div className="flex items-end gap-2">
                    <TextInput label="评论内容" hideLabel value={draft} maxLength={2000} className="flex-1"
                        placeholder={account ? "写评论..." : "登录后发表评论"} onChange={setDraft} />
                    <Button type="submit" variant="secondary" className="h-10" isDisabled={!draft.trim() || send.isPending}>发送</Button>
                </div>
            </form>
            {write.message && <Notice tone={write.message.tone}>{write.message.text}</Notice>}
            {comments.isPending ? <LoadingState compact />
                : comments.isError ? <Notice tone="error">{describeError(comments.error)}</Notice>
                    : items.length === 0 ? <EmptyBlock compact>暂无评论</EmptyBlock>
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
