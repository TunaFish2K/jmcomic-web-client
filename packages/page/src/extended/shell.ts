import { createContext, useContext } from "react";
import type { BatchAlbumItem } from "../api";

/** Services the extended shell offers to its pages and to the album dialog. */
export type ExtendedShell = {
    openAlbum(id: string, cached?: BatchAlbumItem): void;
    /** Runs `action` now when signed in; otherwise opens the login dialog and runs it after login. */
    requireLogin(action?: () => void): void;
    /** `undefined` while `/config` is loading. */
    accountEnabled: boolean | undefined;
};

export const ExtendedShellContext = createContext<ExtendedShell | null>(null);

export function useExtendedShell() {
    const shell = useContext(ExtendedShellContext);
    if (!shell) throw new Error("useExtendedShell must be used inside the extended shell");
    return shell;
}

export const buttonClass = "inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800";
export const primaryButtonClass = "inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-brand-500 px-3 text-sm text-brand-foreground transition-colors hover:bg-brand-600 disabled:opacity-50";
export const inputClass = "h-9 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-brand-500 dark:border-gray-600 dark:bg-gray-900";
export const chipClass = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${active
        ? "border-brand-500 bg-brand-500 text-brand-foreground"
        : "border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"}`;
