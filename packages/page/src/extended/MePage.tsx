import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, LogOut } from "lucide-react";
import { getAlbumMeta, listRecentProgress } from "../reader/reader-store";
import { accountApi, describeError } from "./api";
import { AccountGate } from "./AccountGate";
import { ComicGrid } from "./ComicGrid";
import { ExtendedModeToggle } from "./ExtendedModeToggle";
import { clearAccount, type AccountState } from "./session";
import { Notice, PageFrame, Pager, QueryState, Section } from "./ui";
import { buttonClass, inputClass, primaryButtonClass, useExtendedShell } from "./shell";
import type { WriteResult } from "./types";

type Message = { text: string; error: boolean } | null;
const toMessage = (result: WriteResult, success: string): Message => ({ text: result.message || (result.ok ? success : "操作失败"), error: !result.ok });

function DailyCard({ uid }: { uid: string }) {
    const queryClient = useQueryClient();
    const [message, setMessage] = useState<Message>(null);
    const daily = useQuery({ queryKey: ["account", uid, "daily"], queryFn: ({ signal }) => accountApi.daily(signal), staleTime: 60_000 });
    const check = useMutation({
        mutationFn: (dailyId: string) => accountApi.dailyCheck(dailyId),
        onSuccess: (result) => { setMessage(toMessage(result, "签到成功")); void queryClient.invalidateQueries({ queryKey: ["account", uid, "daily"] }); },
        onError: (error) => setMessage({ text: describeError(error), error: true }),
    });
    return (
        <Section title="每日签到">
            <QueryState pending={daily.isPending} error={daily.isError ? describeError(daily.error) : null} onRetry={() => void daily.refetch()}>
                {daily.data && (
                    <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                        <div className="flex items-center justify-between gap-2 text-sm">
                            <span>{daily.data.eventName || "签到"}</span>
                            <span className="text-xs text-gray-400">进度 {daily.data.progress || "0%"}</span>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-xs">
                            {daily.data.record.flat().map((day, index) => (
                                <span key={`${day.date}-${index}`} title={day.bonus ? "奖励日" : undefined}
                                    className={`rounded py-1 ${day.signed ? "bg-brand-500 text-brand-foreground" : "bg-gray-100 dark:bg-gray-800"} ${day.bonus ? "ring-1 ring-amber-400" : ""}`}>
                                    {day.date}
                                </span>
                            ))}
                        </div>
                        <button type="button" className={`${primaryButtonClass} w-full`} disabled={!daily.data.dailyId || check.isPending}
                            onClick={() => check.mutate(daily.data!.dailyId)}>
                            <CalendarCheck size={14} />签到
                        </button>
                        {message && <Notice tone={message.error ? "error" : "info"}>{message.text}</Notice>}
                    </div>
                )}
            </QueryState>
        </Section>
    );
}

/** Profile fields the Worker accepts; password fields are only sent when filled in. */
const PROFILE_FIELDS = [["email", "邮箱", "email"], ["birthday", "生日", "date"], ["city", "城市", "text"], ["country", "国家/地区", "text"], ["website", "网站", "url"]] as const;

function ProfileCard({ uid }: { uid: string }) {
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState<Message>(null);
    const profile = useQuery({ queryKey: ["account", uid, "profile"], queryFn: ({ signal }) => accountApi.profile(signal), enabled: open });
    const save = useMutation({
        mutationFn: (fields: Record<string, string>) => accountApi.updateProfile(fields),
        onSuccess: (result) => setMessage(toMessage(result, "资料已保存")),
        onError: (error) => setMessage({ text: describeError(error), error: true }),
    });
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const fields: Record<string, string> = {};
        for (const [name] of PROFILE_FIELDS) {
            const value = String(form.get(name) ?? "");
            if (value !== (profile.data?.[name] ?? "")) fields[name] = value;
        }
        const password = String(form.get("password") ?? "");
        if (password) {
            if (password !== String(form.get("password_confirm") ?? "")) { setMessage({ text: "两次输入的密码不一致", error: true }); return; }
            fields.password = password;
            fields.password_confirm = password;
        }
        if (Object.keys(fields).length === 0) { setMessage({ text: "没有修改", error: false }); return; }
        save.mutate(fields);
    };
    if (!open) return <button type="button" className={`${buttonClass} w-full`} onClick={() => setOpen(true)}>编辑资料</button>;
    return (
        <Section title="编辑资料">
            <QueryState pending={profile.isPending} error={profile.isError ? describeError(profile.error) : null} onRetry={() => void profile.refetch()}>
                <form onSubmit={submit} className="space-y-2" aria-label="编辑资料">
                    {PROFILE_FIELDS.map(([name, label, type]) => (
                        <label key={name} className="block space-y-1 text-xs text-gray-500">
                            <span>{label}</span>
                            <input className={inputClass} name={name} type={type} defaultValue={profile.data?.[name] ?? ""} />
                        </label>
                    ))}
                    <label className="block space-y-1 text-xs text-gray-500">
                        <span>新密码（不修改请留空）</span>
                        <input className={inputClass} name="password" type="password" autoComplete="new-password" />
                    </label>
                    <label className="block space-y-1 text-xs text-gray-500">
                        <span>确认新密码</span>
                        <input className={inputClass} name="password_confirm" type="password" autoComplete="new-password" />
                    </label>
                    <div className="flex gap-2">
                        <button type="submit" className={primaryButtonClass} disabled={save.isPending}>保存</button>
                        <button type="button" className={buttonClass} onClick={() => setOpen(false)}>收起</button>
                    </div>
                    {message && <Notice tone={message.error ? "error" : "info"}>{message.text}</Notice>}
                </form>
            </QueryState>
        </Section>
    );
}

function CloudHistory({ uid }: { uid: string }) {
    const queryClient = useQueryClient();
    const [page, setPage] = useState(1);
    const [message, setMessage] = useState<Message>(null);
    const history = useQuery({ queryKey: ["account", uid, "history", page], queryFn: ({ signal }) => accountApi.history(page, signal), staleTime: 60_000 });
    const remove = useMutation({
        mutationFn: (aid: string) => accountApi.deleteHistory(aid),
        onSuccess: (result) => { setMessage(toMessage(result, "已删除")); void queryClient.invalidateQueries({ queryKey: ["account", uid, "history"] }); },
        onError: (error) => setMessage({ text: describeError(error), error: true }),
    });
    const items = history.data?.items ?? [];
    return (
        <Section title="云端观看历史">
            {message && <Notice tone={message.error ? "error" : "info"}>{message.text}</Notice>}
            <QueryState pending={history.isPending} error={history.isError ? describeError(history.error) : null} empty={items.length === 0} onRetry={() => void history.refetch()}>
                <ComicGrid items={items} renderAction={(item) => (
                    <button type="button" className="text-xs text-gray-400 hover:text-red-500" disabled={remove.isPending} onClick={() => remove.mutate(item.id)}>删除记录</button>
                )} />
                <Pager page={page} hasPrev={page > 1} hasNext={items.length > 0 && page * items.length < (history.data?.total ?? 0)} onChange={setPage} />
            </QueryState>
        </Section>
    );
}

function Member({ account }: { account: AccountState }) {
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const logout = async () => {
        setBusy(true);
        try {
            await accountApi.logout();
        } catch {
            // The local session is cleared even when the upstream logout fails.
        } finally {
            clearAccount("logout");
            queryClient.removeQueries({ queryKey: ["account"] });
            setBusy(false);
        }
    };
    const { member } = account;
    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="min-w-0">
                    <div className="truncate font-medium">{member.username}</div>
                    <div className="text-xs text-gray-400">{[member.level, `金币 ${member.coin}`].filter(Boolean).join(" · ")}</div>
                </div>
                <button type="button" className={buttonClass} disabled={busy} onClick={() => void logout()}><LogOut size={14} />退出登录</button>
            </div>
            <DailyCard uid={member.uid} />
            <ProfileCard uid={member.uid} />
            <CloudHistory uid={member.uid} />
        </div>
    );
}

function LocalHistory() {
    const { openAlbum } = useExtendedShell();
    const recent = listRecentProgress(20);
    return (
        <Section title="本地阅读记录">
            {recent.length === 0 ? <div className="py-4 text-center text-sm text-gray-400">还没有阅读记录</div> : (
                <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                    {recent.map((progress) => (
                        <li key={progress.albumId}>
                            <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                                onClick={() => openAlbum(progress.albumId)}>
                                <span className="truncate">{getAlbumMeta(progress.albumId)?.name ?? `#${progress.albumId}`}</span>
                                <span className="shrink-0 text-xs text-gray-400">第 {progress.page + 1}/{progress.totalPages} 页 · {new Date(progress.updatedAt).toLocaleDateString()}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </Section>
    );
}

export function MePage() {
    return (
        <PageFrame title="我的">
            <AccountGate>{(account) => <Member account={account} />}</AccountGate>
            <LocalHistory />
            <Section title="设置"><ExtendedModeToggle /></Section>
        </PageFrame>
    );
}
