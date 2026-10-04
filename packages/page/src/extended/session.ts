import { useEffect, useSyncExternalStore } from "react";
import type { LoginResponse } from "./types";

/**
 * The sealed account session lives in sessionStorage only: it ends with the tab and is
 * never written to localStorage. The token is opaque to the browser.
 */
export const ACCOUNT_STORAGE_KEY = "jm-account-session:v1";

export type AccountState = LoginResponse;
export type AccountNotice = "expired" | null;
type Snapshot = { raw: string | null; account: AccountState | null; notice: AccountNotice };

const listeners = new Set<() => void>();
let notice: AccountNotice = null;
let snapshot: Snapshot | null = null;

function storage(): Storage | undefined {
    try {
        return window.sessionStorage;
    } catch {
        return undefined;
    }
}

function parse(raw: string | null): AccountState | null {
    if (!raw) return null;
    try {
        const value = JSON.parse(raw) as Partial<AccountState>;
        if (typeof value.session !== "string" || typeof value.expiresAt !== "number" || !value.member || typeof value.member.uid !== "string") return null;
        return value as AccountState;
    } catch {
        return null;
    }
}

function emit() {
    for (const listener of [...listeners]) listener();
}

function readSnapshot(): Snapshot {
    let raw: string | null = null;
    try {
        raw = storage()?.getItem(ACCOUNT_STORAGE_KEY) ?? null;
    } catch {
        raw = null;
    }
    if (!snapshot || snapshot.raw !== raw || snapshot.notice !== notice) snapshot = { raw, account: parse(raw), notice };
    return snapshot;
}

/** Returns the current account, dropping it once its session has expired. */
export function loadAccount(now = Date.now()): AccountState | null {
    const { account } = readSnapshot();
    if (account && account.expiresAt <= now) {
        clearAccount("expired");
        return null;
    }
    return account;
}

export function saveAccount(account: AccountState) {
    notice = null;
    try {
        storage()?.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(account));
    } catch {
        // Without sessionStorage the login cannot survive; callers still get the response.
    }
    emit();
}

export function clearAccount(reason: "expired" | "logout" = "logout") {
    notice = reason === "expired" ? "expired" : null;
    try {
        storage()?.removeItem(ACCOUNT_STORAGE_KEY);
    } catch {
        // Nothing stored.
    }
    emit();
}

export function dismissAccountNotice() {
    notice = null;
    emit();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

const serverSnapshot: Snapshot = { raw: null, account: null, notice: null };

export function useAccount() {
    const current = useSyncExternalStore(subscribe, readSnapshot, () => serverSnapshot);
    const expiresAt = current.account?.expiresAt;
    useEffect(() => {
        if (expiresAt === undefined) return;
        // Drops an already expired session right away, otherwise when it expires.
        const timer = setTimeout(() => loadAccount(), Math.max(0, expiresAt - Date.now()));
        return () => clearTimeout(timer);
    }, [expiresAt]);
    return { account: current.account, notice: current.notice };
}
