import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { Notice } from "../ui/feedback";
import { SelectField, TextInput } from "../ui/fields";
import { Pager } from "../ui/Pager";
import { accountApi, describeError } from "./api";
import { AccountGate } from "./AccountGate";
import { ComicGrid } from "./ComicGrid";
import { PageFrame, QueryState } from "./ui";
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
    const [message, setMessage] = useState<{ text: string; tone: "success" | "error" } | null>(null);
    const list = useQuery({
        queryKey: ["account", uid, "favorites", page, folder, order],
        queryFn: ({ signal }) => accountApi.favorites(page, folder, order, signal),
        staleTime: 60_000,
    });
    const folders = list.data?.folders ?? [];
    const current = folders.find((item) => item.id === folder);
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["account", uid, "favorites"] });
    const report = (result: WriteResult, success: string) => setMessage({ text: result.message || (result.ok ? success : "操作失败"), tone: result.ok ? "success" : "error" });

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
        onError: (error) => setMessage({ text: describeError(error), tone: "error" }),
    });
    const remove = useMutation({
        mutationFn: (aid: string) => accountApi.toggleFavorite(aid),
        onSuccess: (result) => { report(result, "已取消收藏"); void refresh(); },
        onError: (error) => setMessage({ text: describeError(error), tone: "error" }),
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
                <SelectField label="收藏夹" value={folder} className="flex-1"
                    options={[["0", "全部收藏"] as const, ...folders.map((item) => [item.id, item.name] as const)]}
                    onChange={(next) => { setFolder(next); setPage(1); setEditing(null); }} />
                <SelectField label="排序" value={order} className="w-32" options={[["mr", "收藏时间"], ["mp", "更新时间"]] as const}
                    onChange={(next) => { setOrder(next); setPage(1); }} />
            </div>
            <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onPress={() => { setEditing("add"); setName(""); }}><FolderPlus size={14} />新建收藏夹</Button>
                {current && (
                    <>
                        <Button size="sm" variant="secondary" onPress={() => { setEditing("edit"); setName(current.name); }}><Pencil size={14} />重命名</Button>
                        <Button size="sm" variant="secondary" className="text-danger" onPress={() => setEditing("del")}><Trash2 size={14} />删除收藏夹</Button>
                    </>
                )}
            </div>
            {editing && (
                <form onSubmit={submitFolder} className="flex items-end gap-2" aria-label="编辑收藏夹">
                    {editing === "del"
                        ? <span className="flex-1 self-center text-sm">删除收藏夹“{current?.name}”？</span>
                        : <TextInput label="收藏夹名称" hideLabel value={name} maxLength={40} isRequired onChange={setName} className="flex-1" />}
                    <Button type="submit" variant={editing === "del" ? "danger" : "primary"} className="h-10" isPending={edit.isPending}>{editing === "del" ? "确认删除" : "保存"}</Button>
                    <Button variant="secondary" className="h-10" onPress={() => setEditing(null)}>取消</Button>
                </form>
            )}
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            <QueryState pending={list.isPending} error={list.isError ? describeError(list.error) : null} empty={list.data?.items.length === 0} onRetry={() => void list.refetch()}>
                <ComicGrid items={list.data?.items ?? []} renderAction={(item) => (
                    <Button size="sm" variant="ghost" fullWidth className="text-muted" isDisabled={remove.isPending} onPress={() => remove.mutate(item.id)}>取消收藏</Button>
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
