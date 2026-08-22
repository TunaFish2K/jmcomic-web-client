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
