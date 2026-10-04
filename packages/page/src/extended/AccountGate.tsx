import type { ReactNode } from "react";
import { AccountForms } from "./AccountForms";
import { dismissAccountNotice, useAccount } from "./session";
import { Notice } from "./ui";
import { useExtendedShell } from "./shell";
import type { AccountState } from "./session";

/** Renders `children` for a signed-in user; otherwise explains why the page is unavailable. */
export function AccountGate({ children }: { children: (account: AccountState) => ReactNode }) {
    const { account, notice } = useAccount();
    const { accountEnabled } = useExtendedShell();
    if (accountEnabled === undefined) return <div role="status" className="py-8 text-center text-sm text-gray-400">加载中...</div>;
    if (!accountEnabled) return <Notice>此部署未启用账号功能。部署者配置 ACCOUNT_SESSION_KEY 后才能登录。</Notice>;
    if (account) return <>{children(account)}</>;
    return (
        <div className="space-y-3">
            {notice === "expired" && (
                <Notice tone="error">
                    登录已过期，请重新登录。<button type="button" className="ml-2 underline" onClick={dismissAccountNotice}>知道了</button>
                </Notice>
            )}
            <p className="text-xs text-gray-500">账号和密码会经过本站部署者的 Worker 转发到上游，只在信任部署者时登录。</p>
            <AccountForms />
        </div>
    );
}
