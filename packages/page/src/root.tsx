import { lazy } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useExtendedPreferences } from "./extended/preferences";

const Home = lazy(() => import("./home"));
const ExtendedApp = lazy(() => import("./extended"));

/** Chooses between the default search page and the extended shell. Extended code only loads when enabled. */
export function Root() {
    const { preferences } = useExtendedPreferences();
    const { pathname } = useLocation();
    if (preferences.enabled) return <ExtendedApp />;
    if (pathname !== "/") return <Navigate to="/" replace />;
    return <Home />;
}
