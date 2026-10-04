import type { ReactNode } from "react";
import { buttonClass } from "./shell";

/** A scrollable page above the bottom navigation. */
export function PageFrame({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <div className="absolute inset-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
                <header className="flex items-center justify-between gap-2">
                    <h1 className="text-lg font-semibold">{title}</h1>
                    {actions && <div className="flex items-center gap-2">{actions}</div>}
                </header>
                {children}
            </div>
        </div>
    );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h2>
                {actions}
            </div>
            {children}
        </section>
    );
}

/** Loading, error and empty states for a query, in one place. */
export function QueryState({ pending, error, empty, onRetry, children }: {
    pending: boolean; error: string | null; empty?: boolean; onRetry?: () => void; children: ReactNode;
}) {
    if (pending) return <div role="status" className="py-8 text-center text-sm text-gray-400">加载中...</div>;
    if (error) {
        return (
            <div role="alert" className="flex flex-col items-center gap-2 py-6 text-center text-sm text-red-500">
                <span>{error}</span>
                {onRetry && <button type="button" className={buttonClass} onClick={onRetry}>重试</button>}
            </div>
        );
    }
    if (empty) return <div className="py-8 text-center text-sm text-gray-400">暂无内容</div>;
    return <>{children}</>;
}

export function Pager({ page, hasPrev, hasNext, onChange, label }: {
    page: number; hasPrev: boolean; hasNext: boolean; onChange: (page: number) => void; label?: string;
}) {
    return (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-gray-500">
            <button type="button" className={buttonClass} disabled={!hasPrev} onClick={() => onChange(page - 1)}>上页</button>
            <span>{label ?? `第 ${page} 页`}</span>
            <button type="button" className={buttonClass} disabled={!hasNext} onClick={() => onChange(page + 1)}>下页</button>
        </div>
    );
}

export function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" }) {
    const colors = tone === "error"
        ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
        : "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300";
    return <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${colors}`}>{children}</div>;
}
