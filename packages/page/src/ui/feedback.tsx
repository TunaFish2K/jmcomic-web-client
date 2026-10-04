import type { ReactNode } from "react";
import { Alert, Button, Spinner } from "@heroui/react";

/**
 * Inline status message. `info` is neutral, `success` confirms a finished write,
 * `error` reports a failure; errors are announced to assistive technology.
 */
export function Notice({ tone = "info", children, action }: {
    tone?: "info" | "success" | "error";
    children: ReactNode;
    action?: ReactNode;
}) {
    const status = tone === "error" ? "danger" : tone === "success" ? "success" : "default";
    return (
        <Alert status={status} role={tone === "error" ? "alert" : "status"} className="items-center py-2 text-sm">
            <Alert.Content className="min-w-0 flex-1">
                <Alert.Description className="break-words">{children}</Alert.Description>
            </Alert.Content>
            {action}
        </Alert>
    );
}

export function InlineSpinner({ className = "" }: { className?: string }) {
    return <Spinner size="sm" color="current" className={className} aria-hidden />;
}

/** Centered spinner with a short label, e.g. 加载中... or 正在搜索... */
export function LoadingState({ label = "加载中...", compact = false }: { label?: string; compact?: boolean }) {
    return (
        <div role="status" className={`flex items-center justify-center gap-2 text-sm text-muted ${compact ? "py-4" : "py-8"}`}>
            <Spinner size="sm" aria-hidden />
            <span>{label}</span>
        </div>
    );
}

export function EmptyBlock({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
    return <div className={`text-center text-sm text-muted ${compact ? "py-4" : "py-8"}`}>{children}</div>;
}

/** Error text with an optional retry button, used where a whole section failed to load. */
export function ErrorBlock({ message, onRetry }: { message: ReactNode; onRetry?: () => void }) {
    return (
        <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center text-sm text-danger">
            <span>{message}</span>
            {onRetry && <Button size="sm" variant="secondary" onPress={onRetry}>重试</Button>}
        </div>
    );
}
