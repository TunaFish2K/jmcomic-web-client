import { Button } from "@heroui/react";

/**
 * Page navigation. 上页/下页 are always shown; 首页/尾页 appear when the total page
 * count is known. `label` replaces the default "第 N 页" summary.
 */
export function Pager({ page, hasPrev, hasNext, onChange, totalPages, label, isDisabled = false }: {
    page: number;
    hasPrev: boolean;
    hasNext: boolean;
    onChange: (page: number) => void;
    totalPages?: number;
    label?: string;
    isDisabled?: boolean;
}) {
    return (
        <nav aria-label="分页" className="flex flex-col items-center gap-1 py-2">
            <div className="flex items-center justify-center gap-1">
                {totalPages !== undefined && (
                    <Button variant="secondary" size="sm" isDisabled={page <= 1 || isDisabled} onPress={() => onChange(1)}>首页</Button>
                )}
                <Button variant="secondary" size="sm" isDisabled={!hasPrev || isDisabled} onPress={() => onChange(page - 1)}>上页</Button>
                <Button variant="secondary" size="sm" isDisabled={!hasNext || isDisabled} onPress={() => onChange(page + 1)}>下页</Button>
                {totalPages !== undefined && (
                    <Button variant="secondary" size="sm" isDisabled={page >= totalPages || isDisabled} onPress={() => onChange(totalPages)}>尾页</Button>
                )}
            </div>
            <div className="text-xs text-muted">{label ?? (totalPages !== undefined ? `第 ${page} / ${totalPages} 页` : `第 ${page} 页`)}</div>
        </nav>
    );
}
