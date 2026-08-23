export function resolveBackendUrl({
    rawUrl,
    development,
    hostname,
}: {
    rawUrl: string | undefined;
    development: boolean;
    hostname: string;
}) {
    const value = rawUrl?.trim() ?? "";
    if (!value) return "";
    if (development && value.includes("localhost")) {
        return value.replace("localhost", hostname);
    }
    return value;
}

export function getBackendUrl() {
    const environment = import.meta.env as
        | { VITE_BACKEND_URL?: string; DEV?: boolean }
        | undefined;
    return resolveBackendUrl({
        rawUrl: environment?.VITE_BACKEND_URL,
        development: environment?.DEV === true,
        hostname:
            typeof window === "undefined"
                ? "localhost"
                : window.location.hostname,
    });
}

export function ensureBackendPreconnect(backendUrl = getBackendUrl()) {
    if (!backendUrl || typeof document === "undefined") return;
    let origin: string;
    try {
        origin = new URL(backendUrl, document.baseURI).origin;
    } catch {
        return;
    }
    for (const rel of ["dns-prefetch", "preconnect"] as const) {
        if (document.head.querySelector(`link[rel="${rel}"][href="${origin}"]`)) continue;
        const link = document.createElement("link");
        link.rel = rel;
        link.href = origin;
        if (rel === "preconnect") link.crossOrigin = "anonymous";
        document.head.append(link);
    }
}
