import type { ReactNode } from "react";
import { EmptyBlock, ErrorBlock, LoadingState } from "../ui/feedback";

/** A scrollable page above the bottom navigation, with the same width as the search page. */
export function PageFrame({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
    return (
        <div className="absolute inset-0 overflow-y-auto">
            <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
                <header className="flex min-h-10 items-center justify-between gap-2">
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
            <div className="flex min-h-8 items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{title}</h2>
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
    if (pending) return <LoadingState />;
    if (error) return <ErrorBlock message={error} onRetry={onRetry} />;
    if (empty) return <EmptyBlock>暂无内容</EmptyBlock>;
    return <>{children}</>;
}
