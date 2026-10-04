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
