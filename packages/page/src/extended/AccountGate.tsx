import type { ReactNode } from "react";
import { Button } from "@heroui/react";
import { LoadingState, Notice } from "../ui/feedback";
import { AccountForms } from "./AccountForms";
import { dismissAccountNotice, useAccount } from "./session";
import { useExtendedShell } from "./shell";
import type { AccountState } from "./session";
import { TRUST_NOTICE } from "./text";

/** Renders `children` for a signed-in user; otherwise explains why the page is unavailable. */
export function AccountGate({ children }: { children: (account: AccountState) => ReactNode }) {
    const { account, notice } = useAccount();
    const { accountEnabled } = useExtendedShell();
    if (accountEnabled === undefined) return <LoadingState />;
    if (!accountEnabled) return <Notice>此部署未启用账号功能。部署者配置 ACCOUNT_SESSION_KEY 后才能登录。</Notice>;
    if (account) return <>{children(account)}</>;
    return (
        <div className="space-y-3">
            {notice === "expired" && (
                <Notice tone="error" action={<Button size="sm" variant="ghost" onPress={dismissAccountNotice}>知道了</Button>}>
                    登录已过期，请重新登录。
                </Notice>
            )}
            <p className="text-xs text-muted">{TRUST_NOTICE}</p>
            <AccountForms />
        </div>
    );
}
