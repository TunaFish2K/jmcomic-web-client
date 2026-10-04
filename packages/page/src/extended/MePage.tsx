import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@heroui/react";
import { CalendarCheck, LogOut } from "lucide-react";
import { Notice } from "../ui/feedback";
import { TextInput } from "../ui/fields";
import { Pager } from "../ui/Pager";
import { accountApi, describeError } from "./api";
import { AccountGate } from "./AccountGate";
import { ComicGrid } from "./ComicGrid";
import { ExtendedModeToggle } from "./ExtendedModeToggle";
import { clearAccount, type AccountState } from "./session";
import { PageFrame, QueryState, Section } from "./ui";
import type { WriteResult } from "./types";

type Message = { text: string; tone: "info" | "success" | "error" } | null;
const toMessage = (result: WriteResult, success: string): Message => ({ text: result.message || (result.ok ? success : "操作失败"), tone: result.ok ? "success" : "error" });

function DailyCard({ uid }: { uid: string }) {
    const queryClient = useQueryClient();
    const [message, setMessage] = useState<Message>(null);
    const daily = useQuery({ queryKey: ["account", uid, "daily"], queryFn: ({ signal }) => accountApi.daily(signal), staleTime: 60_000 });
    const check = useMutation({
        mutationFn: (dailyId: string) => accountApi.dailyCheck(dailyId),
        onSuccess: (result) => { setMessage(toMessage(result, "签到成功")); void queryClient.invalidateQueries({ queryKey: ["account", uid, "daily"] }); },
        onError: (error) => setMessage({ text: describeError(error), tone: "error" }),
    });
    return (
        <Section title="每日签到">
            <QueryState pending={daily.isPending} error={daily.isError ? describeError(daily.error) : null} onRetry={() => void daily.refetch()}>
                {daily.data && (
                    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
                        <div className="flex items-center justify-between gap-2 text-sm">
                            <span>{daily.data.eventName || "签到"}</span>
                            <span className="text-xs text-muted">进度 {daily.data.progress || "0%"}</span>
                        </div>
                        <div className="grid grid-cols-7 gap-1 text-center text-xs">
                            {daily.data.record.flat().map((day, index) => (
                                <span key={`${day.date}-${index}`} title={day.bonus ? "奖励日" : undefined}
                                    className={`rounded py-1 ${day.signed ? "bg-brand-500 text-brand-foreground" : "bg-surface-secondary"} ${day.bonus ? "ring-1 ring-brand-500" : ""}`}>
                                    {day.date}
                                </span>
                            ))}
                        </div>
                        <Button fullWidth isDisabled={!daily.data.dailyId} isPending={check.isPending}
                            onPress={() => check.mutate(daily.data!.dailyId)}>
                            <CalendarCheck size={14} />签到
                        </Button>
                        {message && <Notice tone={message.tone}>{message.text}</Notice>}
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
        onError: (error) => setMessage({ text: describeError(error), tone: "error" }),
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
            if (password !== String(form.get("password_confirm") ?? "")) { setMessage({ text: "两次输入的密码不一致", tone: "error" }); return; }
            fields.password = password;
            fields.password_confirm = password;
        }
        if (Object.keys(fields).length === 0) { setMessage({ text: "没有修改", tone: "info" }); return; }
        save.mutate(fields);
    };
    if (!open) return <Button variant="secondary" fullWidth onPress={() => setOpen(true)}>编辑资料</Button>;
    return (
        <Section title="编辑资料">
            <QueryState pending={profile.isPending} error={profile.isError ? describeError(profile.error) : null} onRetry={() => void profile.refetch()}>
                <form onSubmit={submit} className="space-y-3" aria-label="编辑资料">
                    {PROFILE_FIELDS.map(([name, label, type]) => (
                        <TextInput key={name} label={label} name={name} type={type} defaultValue={profile.data?.[name] ?? ""} />
                    ))}
                    <TextInput label="新密码（不修改请留空）" name="password" type="password" autoComplete="new-password" />
                    <TextInput label="确认新密码" name="password_confirm" type="password" autoComplete="new-password" />
                    <div className="flex gap-2">
                        <Button type="submit" isPending={save.isPending}>保存</Button>
                        <Button variant="secondary" onPress={() => setOpen(false)}>收起</Button>
                    </div>
                    {message && <Notice tone={message.tone}>{message.text}</Notice>}
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
        onError: (error) => setMessage({ text: describeError(error), tone: "error" }),
    });
    const items = history.data?.items ?? [];
    return (
        <Section title="云端观看历史">
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            <QueryState pending={history.isPending} error={history.isError ? describeError(history.error) : null} empty={items.length === 0} onRetry={() => void history.refetch()}>
                <ComicGrid items={items} renderAction={(item) => (
                    <Button size="sm" variant="ghost" fullWidth className="text-muted" isDisabled={remove.isPending} onPress={() => remove.mutate(item.id)}>删除记录</Button>
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
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
                <div className="min-w-0">
                    <div className="truncate font-medium">{member.username}</div>
                    <div className="text-xs text-muted">{[member.level, `金币 ${member.coin}`].filter(Boolean).join(" · ")}</div>
                </div>
                <Button size="sm" variant="secondary" isPending={busy} onPress={() => void logout()}><LogOut size={14} />退出登录</Button>
            </div>
            <DailyCard uid={member.uid} />
            <ProfileCard uid={member.uid} />
            <CloudHistory uid={member.uid} />
        </div>
    );
}

export function MePage() {
    return (
        <PageFrame title="我的">
            <AccountGate>{(account) => <Member account={account} />}</AccountGate>
            <Section title="设置"><ExtendedModeToggle /></Section>
        </PageFrame>
    );
}
