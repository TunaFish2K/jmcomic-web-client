import { useCallback, useSyncExternalStore } from "react";

/** Extended mode is off by default; enabling it once records that the user saw the trust warning. */
export const EXTENDED_MODE_STORAGE_KEY = "jm-extended-mode:v1";

export type ExtendedPreferences = { version: 1; enabled: boolean; acknowledged: boolean };

export const DEFAULT_EXTENDED_PREFERENCES: ExtendedPreferences = { version: 1, enabled: false, acknowledged: false };

export function parseExtendedPreferences(raw: string | null): ExtendedPreferences {
    if (!raw) return DEFAULT_EXTENDED_PREFERENCES;
    try {
        const parsed = JSON.parse(raw) as Partial<ExtendedPreferences>;
        if (parsed.version !== 1) return DEFAULT_EXTENDED_PREFERENCES;
        return { version: 1, enabled: parsed.enabled === true, acknowledged: parsed.acknowledged === true };
    } catch {
        return DEFAULT_EXTENDED_PREFERENCES;
    }
}

function storage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

function readRaw(): string | null {
    try {
        return storage()?.getItem(EXTENDED_MODE_STORAGE_KEY) ?? null;
    } catch {
        return null;
    }
}

const listeners = new Set<() => void>();
let snapshot: { raw: string | null; value: ExtendedPreferences } | null = null;
/** Used for the rest of the page's life when the preference cannot be stored. */
let unsaved: ExtendedPreferences | null = null;

export function loadExtendedPreferences(): ExtendedPreferences {
    if (unsaved) return unsaved;
    const raw = readRaw();
    if (!snapshot || snapshot.raw !== raw) snapshot = { raw, value: parseExtendedPreferences(raw) };
    return snapshot.value;
}

export function saveExtendedPreferences(preferences: ExtendedPreferences) {
    try {
        storage()?.setItem(EXTENDED_MODE_STORAGE_KEY, JSON.stringify(preferences));
        unsaved = null;
    } catch {
        // The toggle still applies to this page when storage is unavailable.
        unsaved = preferences;
    }
    for (const listener of [...listeners]) listener();
}

export function subscribeExtendedPreferences(listener: () => void) {
    const onStorage = (event: StorageEvent) => {
        if (event.key === EXTENDED_MODE_STORAGE_KEY) listener();
    };
    listeners.add(listener);
    window.addEventListener("storage", onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

export function useExtendedPreferences() {
    const preferences = useSyncExternalStore(subscribeExtendedPreferences, loadExtendedPreferences, () => DEFAULT_EXTENDED_PREFERENCES);
    const setEnabled = useCallback((enabled: boolean) => {
        const current = loadExtendedPreferences();
        saveExtendedPreferences({ version: 1, enabled, acknowledged: current.acknowledged || enabled });
    }, []);
    return { preferences, setEnabled };
}
