import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { accountApi, describeError } from "./api";
import { AccountGate } from "./AccountGate";
import { ComicGrid } from "./ComicGrid";
import { Notice, PageFrame, Pager, QueryState } from "./ui";
import { buttonClass, inputClass } from "./shell";
import type { AccountState } from "./session";
import type { FolderEdit, WriteResult } from "./types";

const PAGE_SIZE = 20;

function FavoriteList({ account }: { account: AccountState }) {
    const queryClient = useQueryClient();
    const uid = account.member.uid;
    const [folder, setFolder] = useState("0");
    const [order, setOrder] = useState<"mr" | "mp">("mr");
    const [page, setPage] = useState(1);
    const [editing, setEditing] = useState<"add" | "edit" | "del" | null>(null);
    const [name, setName] = useState("");
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
    const list = useQuery({
        queryKey: ["account", uid, "favorites", page, folder, order],
        queryFn: ({ signal }) => accountApi.favorites(page, folder, order, signal),
        staleTime: 60_000,
    });
    const folders = list.data?.folders ?? [];
    const current = folders.find((item) => item.id === folder);
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["account", uid, "favorites"] });
    const report = (result: WriteResult, success: string) => setMessage({ text: result.message || (result.ok ? success : "操作失败"), error: !result.ok });

    const edit = useMutation({
        mutationFn: (change: FolderEdit) => accountApi.editFolder(change),
        onSuccess: (result, change) => {
            report(result, "已保存");
            if (!result.ok) return;
            setEditing(null);
            setName("");
            if (change.type === "del") setFolder("0");
            void refresh();
        },
        onError: (error) => setMessage({ text: describeError(error), error: true }),
    });
    const remove = useMutation({
        mutationFn: (aid: string) => accountApi.toggleFavorite(aid),
        onSuccess: (result) => { report(result, "已取消收藏"); void refresh(); },
        onError: (error) => setMessage({ text: describeError(error), error: true }),
    });

    const submitFolder = (event: FormEvent) => {
        event.preventDefault();
        if (editing === "add") edit.mutate({ type: "add", name: name.trim() });
        else if (editing === "edit" && current) edit.mutate({ type: "edit", folderId: current.id, name: name.trim() });
        else if (editing === "del" && current) edit.mutate({ type: "del", folderId: current.id });
    };

    return (
        <div className="space-y-3">
            <div className="flex gap-2">
                <select aria-label="收藏夹" className={inputClass} value={folder} onChange={(event) => { setFolder(event.target.value); setPage(1); setEditing(null); }}>
                    <option value="0">全部收藏</option>
                    {folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select aria-label="排序" className={`${inputClass} w-32`} value={order} onChange={(event) => { setOrder(event.target.value as "mr" | "mp"); setPage(1); }}>
                    <option value="mr">收藏时间</option>
                    <option value="mp">更新时间</option>
                </select>
            </div>
            <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} onClick={() => { setEditing("add"); setName(""); }}><FolderPlus size={14} />新建收藏夹</button>
                {current && (
                    <>
                        <button type="button" className={buttonClass} onClick={() => { setEditing("edit"); setName(current.name); }}><Pencil size={14} />重命名</button>
                        <button type="button" className={buttonClass} onClick={() => setEditing("del")}><Trash2 size={14} />删除收藏夹</button>
                    </>
                )}
            </div>
            {editing && (
                <form onSubmit={submitFolder} className="flex gap-2" aria-label="编辑收藏夹">
                    {editing === "del"
                        ? <span className="flex-1 self-center text-sm">删除收藏夹“{current?.name}”？</span>
                        : <input aria-label="收藏夹名称" className={inputClass} value={name} maxLength={40} required onChange={(event) => setName(event.target.value)} />}
                    <button type="submit" className={buttonClass} disabled={edit.isPending}>{editing === "del" ? "确认删除" : "保存"}</button>
                    <button type="button" className={buttonClass} onClick={() => setEditing(null)}>取消</button>
                </form>
            )}
            {message && <Notice tone={message.error ? "error" : "info"}>{message.text}</Notice>}
            <QueryState pending={list.isPending} error={list.isError ? describeError(list.error) : null} empty={list.data?.items.length === 0} onRetry={() => void list.refetch()}>
                <ComicGrid items={list.data?.items ?? []} renderAction={(item) => (
                    <button type="button" className="text-xs text-gray-400 hover:text-red-500" disabled={remove.isPending} onClick={() => remove.mutate(item.id)}>取消收藏</button>
                )} />
                <Pager page={page} hasPrev={page > 1} hasNext={page * PAGE_SIZE < (list.data?.total ?? 0)} onChange={setPage}
                    label={`第 ${page} 页 · 共 ${list.data?.total ?? 0} 本`} />
            </QueryState>
        </div>
    );
}

export function FavoritesPage() {
    return (
        <PageFrame title="收藏">
            <AccountGate>{(account) => <FavoriteList account={account} />}</AccountGate>
        </PageFrame>
    );
}
