import { useState, type FormEvent } from "react";
import { accountApi, describeError } from "./api";
import { saveAccount } from "./session";
import { Notice } from "./ui";
import { buttonClass, chipClass, inputClass, primaryButtonClass } from "./shell";

type Mode = "login" | "register" | "forgot";

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <label className="block space-y-1 text-xs text-gray-500">
            <span>{label}</span>
            <input className={inputClass} required {...props} />
        </label>
    );
}

/** Login, registration and password reset. Passwords are only kept in component state. */
export function AccountForms({ onLoggedIn }: { onLoggedIn?: () => void }) {
    const [mode, setMode] = useState<Mode>("login");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

    const submit = (run: (form: FormData) => Promise<string | null>) => async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setMessage(null);
        try {
            const text = await run(form);
            if (text) setMessage({ text, error: false });
        } catch (error) {
            setMessage({ text: describeError(error), error: true });
        } finally {
            setBusy(false);
        }
    };
    const value = (form: FormData, name: string) => String(form.get(name) ?? "");

    const login = submit(async (form) => {
        const response = await accountApi.login(value(form, "username"), value(form, "password"));
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
            <div className="flex gap-2" role="tablist">
                {([["login", "登录"], ["register", "注册"], ["forgot", "找回密码"]] as const).map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={mode === id} className={chipClass(mode === id)}
                        onClick={() => { setMode(id); setMessage(null); }}>{label}</button>
                ))}
            </div>
            {message && <Notice tone={message.error ? "error" : "info"}>{message.text.replace(/^请求失败：/, "")}</Notice>}
            {mode === "login" && (
                <form onSubmit={login} className="space-y-2" aria-label="登录">
                    <Field label="用户名" name="username" autoComplete="username" />
                    <Field label="密码" name="password" type="password" autoComplete="current-password" />
                    <button type="submit" className={`${primaryButtonClass} w-full`} disabled={busy}>{busy ? "登录中..." : "登录"}</button>
                </form>
            )}
            {mode === "register" && (
                <form onSubmit={register} className="space-y-2" aria-label="注册">
                    <Field label="用户名" name="username" autoComplete="username" />
                    <Field label="邮箱" name="email" type="email" autoComplete="email" />
                    <Field label="密码" name="password" type="password" autoComplete="new-password" />
                    <Field label="确认密码" name="passwordConfirm" type="password" autoComplete="new-password" />
                    <fieldset className="flex gap-4 text-sm">
                        <legend className="mb-1 text-xs text-gray-500">性别</legend>
                        <label className="flex items-center gap-1"><input type="radio" name="gender" value="Male" defaultChecked />男</label>
                        <label className="flex items-center gap-1"><input type="radio" name="gender" value="Female" />女</label>
                    </fieldset>
                    <button type="submit" className={`${primaryButtonClass} w-full`} disabled={busy}>注册</button>
                </form>
            )}
            {mode === "forgot" && (
                <form onSubmit={forgot} className="space-y-2" aria-label="找回密码">
                    <Field label="注册邮箱" name="email" type="email" autoComplete="email" />
                    <button type="submit" className={`${buttonClass} w-full`} disabled={busy}>发送重设邮件</button>
                </form>
            )}
        </div>
    );
}

export function LoginDialog({ onClose, onLoggedIn }: { onClose: () => void; onLoggedIn: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div role="dialog" aria-modal="true" aria-label="登录账号"
                className="w-full max-w-sm space-y-3 rounded-xl bg-white p-4 shadow-2xl dark:bg-gray-900"
                onClick={(event) => event.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold">登录账号</h2>
                    <button type="button" className="text-sm text-gray-400" onClick={onClose}>关闭</button>
                </div>
                <p className="text-xs text-gray-500">账号和密码会经过本站部署者的 Worker 转发到上游，只在信任部署者时登录。</p>
                <AccountForms onLoggedIn={onLoggedIn} />
            </div>
        </div>
    );
}
