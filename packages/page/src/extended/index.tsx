import { useCallback, useMemo, useRef, useState } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Compass, Home as HomeIcon, Star, User } from "lucide-react";
import Home from "../home";
import { AlbumModal } from "../home/AlbumModal";
import { TaskContext } from "../home/task-context";
import { TaskPanel } from "../home/TaskPanel";
import { useDownloads } from "../home/useDownloads";
import type { BatchAlbumItem } from "../api";
import { LoginDialog } from "./AccountForms";
import { AlbumActions } from "./AlbumActions";
import { mobileApi } from "./api";
import { DiscoverPage } from "./DiscoverPage";
import { FavoritesPage } from "./FavoritesPage";
import { HomePage } from "./HomePage";
import { MePage } from "./MePage";
import { loadAccount } from "./session";
import { ExtendedShellContext, type ExtendedShell } from "./shell";

const NAV = [
    { to: "/", label: "首页", icon: HomeIcon },
    { to: "/discover", label: "发现", icon: Compass },
    { to: "/favorites", label: "收藏", icon: Star },
    { to: "/me", label: "我的", icon: User },
] as const;

const renderAlbumExtras = (albumId: string) => <AlbumActions albumId={albumId} />;

/** Extended mode: bottom navigation around discovery, favorites and account pages. The reader stays full screen. */
export default function ExtendedApp() {
    const { pathname } = useLocation();
    const [params] = useSearchParams();
    const queryClient = useQueryClient();
    const { showTaskPanel, setShowTaskPanel, taskContextValue, clearCompleted } = useDownloads();
    const [album, setAlbum] = useState<{ id: string; cached?: BatchAlbumItem } | null>(null);
    const [loginOpen, setLoginOpen] = useState(false);
    const pendingAction = useRef<(() => void) | null>(null);
    const config = useQuery({ queryKey: ["mobile", "config"], queryFn: ({ signal }) => mobileApi.config(signal), staleTime: 5 * 60_000, retry: 1 });

    const requireLogin = useCallback((action?: () => void) => {
        if (loadAccount()) {
            action?.();
            return;
        }
        pendingAction.current = action ?? null;
        setLoginOpen(true);
    }, []);
    const shell = useMemo<ExtendedShell>(() => ({
        openAlbum: (id, cached) => setAlbum({ id, cached }),
        requireLogin,
        accountEnabled: config.isError ? false : config.data?.accountEnabled,
    }), [config.data, config.isError, requireLogin]);

    const closeLogin = () => {
        pendingAction.current = null;
        setLoginOpen(false);
    };
    const loggedIn = () => {
        const action = pendingAction.current;
        pendingAction.current = null;
        setLoginOpen(false);
        // Account data cached for a previous user must not leak into the new session.
        queryClient.removeQueries({ queryKey: ["account"] });
        action?.();
    };

    const page = pathname === "/discover" ? <DiscoverPage />
        : pathname === "/favorites" ? <FavoritesPage />
            : pathname === "/me" ? <MePage />
                : params.has("q") ? <Home embedded renderAlbumExtras={renderAlbumExtras} />
                    : <HomePage />;

    return (
        <ExtendedShellContext.Provider value={shell}>
            <TaskContext.Provider value={taskContextValue}>
                <div className="fixed inset-0 flex flex-col">
                    <main className="relative min-h-0 flex-1">{page}</main>
                    <nav aria-label="主导航" className="shrink-0 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-gray-800 dark:bg-gray-950">
                        <ul className="mx-auto grid h-14 max-w-2xl grid-cols-4">
                            {NAV.map(({ to, label, icon: Icon }) => (
                                <li key={to}>
                                    <NavLink to={to} end className={({ isActive }) => `flex h-full flex-col items-center justify-center gap-0.5 text-xs ${isActive && !(to === "/" && params.has("q")) ? "text-brand-600 dark:text-brand-300" : "text-gray-500"}`}>
                                        <Icon size={20} />{label}
                                    </NavLink>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>
                {album && (
                    <AlbumModal albumId={album.id} cachedData={album.cached} onClose={() => setAlbum(null)} extras={renderAlbumExtras(album.id)} />
                )}
                {showTaskPanel && <TaskPanel onClose={() => { setShowTaskPanel(false); clearCompleted(); }} />}
                {loginOpen && <LoginDialog onClose={closeLogin} onLoggedIn={loggedIn} />}
            </TaskContext.Provider>
        </ExtendedShellContext.Provider>
    );
}
