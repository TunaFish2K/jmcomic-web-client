import { useState, type FormEvent } from "react";
import { Button, Checkbox, Label, Radio, RadioGroup } from "@heroui/react";
import { accountApi, describeError } from "./api";
import { saveAccount } from "./session";
import { TRUST_NOTICE } from "./text";
import { AppDialog } from "../ui/AppDialog";
import { Segmented } from "../ui/controls";
import { Notice } from "../ui/feedback";
import { TextInput } from "../ui/fields";

type Mode = "login" | "register" | "forgot";
const MODES = [["login", "登录"], ["register", "注册"], ["forgot", "找回密码"]] as const;

/** Login, registration and password reset. Passwords are only kept in component state. */
export function AccountForms({ onLoggedIn }: { onLoggedIn?: () => void }) {
    const [mode, setMode] = useState<Mode>("login");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ text: string; tone: "success" | "error" } | null>(null);

    const submit = (run: (form: FormData) => Promise<string | null>) => async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setMessage(null);
        try {
            const text = await run(form);
            if (text) setMessage({ text, tone: "success" });
        } catch (error) {
            setMessage({ text: describeError(error).replace(/^请求失败：/, ""), tone: "error" });
        } finally {
            setBusy(false);
        }
    };
    const value = (form: FormData, name: string) => String(form.get(name) ?? "");

    const login = submit(async (form) => {
        const response = await accountApi.login(value(form, "username"), value(form, "password"), form.get("remember") === "on");
        saveAccount(response);
        onLoggedIn?.();
        return null;
    });
    const register = submit(async (form) => {
        if (value(form, "password") !== value(form, "passwordConfirm")) throw new Error("两次输入的密码不一致");
        const result = await accountApi.register({
            username: value(form, "username"), password: value(form, "password"),
            passwordConfirm: value(form, "passwordConfirm"), email: value(form, "email"), gender: value(form, "gender"),
        });
        if (!result.ok) throw new Error(result.message || "注册失败");
        setMode("login");
        return result.message || "注册成功，请登录";
    });
    const forgot = submit(async (form) => {
        const result = await accountApi.forgot(value(form, "email"));
        if (!result.ok) throw new Error(result.message || "提交失败");
        return result.message || "已发送重设密码邮件";
    });

    return (
        <div className="space-y-3">
            <Segmented label="账号操作" fullWidth value={mode} options={MODES} onChange={(next) => { setMode(next); setMessage(null); }} />
            {message && <Notice tone={message.tone}>{message.text}</Notice>}
            {mode === "login" && (
                <form onSubmit={login} className="space-y-3" aria-label="登录">
                    <TextInput label="用户名" name="username" autoComplete="username" isRequired />
                    <TextInput label="密码" name="password" type="password" autoComplete="current-password" isRequired />
                    <Checkbox name="remember" value="on" className="flex items-start gap-2 text-sm">
                        <Checkbox.Control className="mt-0.5"><Checkbox.Indicator /></Checkbox.Control>
                        <Checkbox.Content>
                            <span className="block">记住我（30 天）</span>
                            <span className="block text-xs text-muted">在公用设备上不要勾选</span>
                        </Checkbox.Content>
                    </Checkbox>
                    <Button type="submit" fullWidth isPending={busy}>{busy ? "登录中..." : "登录"}</Button>
                </form>
            )}
            {mode === "register" && (
                <form onSubmit={register} className="space-y-3" aria-label="注册">
                    <TextInput label="用户名" name="username" autoComplete="username" isRequired />
                    <TextInput label="邮箱" name="email" type="email" autoComplete="email" isRequired />
                    <TextInput label="密码" name="password" type="password" autoComplete="new-password" isRequired />
                    <TextInput label="确认密码" name="passwordConfirm" type="password" autoComplete="new-password" isRequired />
                    <RadioGroup name="gender" defaultValue="Male" orientation="horizontal" className="gap-1">
                        <Label className="text-xs text-muted">性别</Label>
                        <div className="flex gap-4">
                            {([["Male", "男"], ["Female", "女"]] as const).map(([id, text]) => (
                                <Radio key={id} value={id} className="flex items-center gap-2 text-sm">
                                    <Radio.Control><Radio.Indicator /></Radio.Control>
                                    <Radio.Content>{text}</Radio.Content>
                                </Radio>
                            ))}
                        </div>
                    </RadioGroup>
                    <Button type="submit" fullWidth isPending={busy}>注册</Button>
                </form>
            )}
            {mode === "forgot" && (
                <form onSubmit={forgot} className="space-y-3" aria-label="找回密码">
                    <TextInput label="注册邮箱" name="email" type="email" autoComplete="email" isRequired />
                    <Button type="submit" variant="secondary" fullWidth isPending={busy}>发送重设邮件</Button>
                </form>
            )}
        </div>
    );
}

export function LoginDialog({ onClose, onLoggedIn }: { onClose: () => void; onLoggedIn: () => void }) {
    return (
        <AppDialog title="登录账号" size="sm" onClose={onClose}>
            <p className="text-xs text-muted">{TRUST_NOTICE}</p>
            <AccountForms onLoggedIn={onLoggedIn} />
        </AppDialog>
    );
}
