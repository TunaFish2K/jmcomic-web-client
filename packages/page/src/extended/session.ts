import { useEffect, useSyncExternalStore } from "react";
import type { LoginResponse } from "./types";

/**
 * The sealed account session token. By default it lives in sessionStorage and ends with the
 * tab. With "remember me" it is kept in localStorage for up to 30 days (the Worker caps the
 * session). Only one copy exists at a time; the token is opaque to the browser.
 */
export const ACCOUNT_STORAGE_KEY = "jm-account-session:v1";

export type AccountState = LoginResponse;
export type AccountNotice = "expired" | null;
type Snapshot = { raw: string | null; account: AccountState | null; notice: AccountNotice };

const listeners = new Set<() => void>();
let notice: AccountNotice = null;
let snapshot: Snapshot | null = null;

function storages(): Storage[] {
    const found: Storage[] = [];
    for (const read of [() => window.sessionStorage, () => window.localStorage]) {
        try {
            found.push(read());
        } catch {
            // Storage blocked in this context.
        }
    }
    return found;
}

function storageFor(remember: boolean): Storage | undefined {
    try {
        return remember ? window.localStorage : window.sessionStorage;
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

function readRaw(): string | null {
    for (const storage of storages()) {
        try {
            const raw = storage.getItem(ACCOUNT_STORAGE_KEY);
            if (raw) return raw;
        } catch {
            // Try the other storage.
        }
    }
    return null;
}

function readSnapshot(): Snapshot {
    const raw = readRaw();
    if (!snapshot || snapshot.raw !== raw || snapshot.notice !== notice) snapshot = { raw, account: parse(raw), notice };
    return snapshot;
}

function removeEverywhere() {
    for (const storage of storages()) {
        try {
            storage.removeItem(ACCOUNT_STORAGE_KEY);
        } catch {
            // Nothing stored there.
        }
    }
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
    removeEverywhere();
    try {
        storageFor(account.remember === true)?.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(account));
    } catch {
        // Without storage the login cannot survive; callers still get the response.
    }
    emit();
}

export function clearAccount(reason: "expired" | "logout" = "logout") {
    notice = reason === "expired" ? "expired" : null;
    removeEverywhere();
    emit();
}

export function dismissAccountNotice() {
    notice = null;
    emit();
}

function subscribe(listener: () => void) {
    // A remembered session is shared by every tab; follow logins and logouts elsewhere.
    const onStorage = (event: StorageEvent) => {
        if (event.key === ACCOUNT_STORAGE_KEY || event.key === null) listener();
    };
    listeners.add(listener);
    window.addEventListener("storage", onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

const serverSnapshot: Snapshot = { raw: null, account: null, notice: null };

export function useAccount() {
    const current = useSyncExternalStore(subscribe, readSnapshot, () => serverSnapshot);
    const expiresAt = current.account?.expiresAt;
    useEffect(() => {
        if (expiresAt === undefined) return;
        // Drops an already expired session right away, otherwise when it expires. Timers cap
        // at about 24.8 days, so a longer session is simply rechecked at that point.
        const delay = Math.min(Math.max(0, expiresAt - Date.now()), 2_147_000_000);
        const timer = setTimeout(() => loadAccount(), delay);
        return () => clearTimeout(timer);
    }, [expiresAt]);
    return { account: current.account, notice: current.notice };
}
