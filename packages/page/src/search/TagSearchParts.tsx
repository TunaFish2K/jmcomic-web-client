import { X } from "lucide-react";
import type { TagSearch } from "./useTagSearch";
import type { TermKind } from "./vocabulary";

const KIND_LABEL: Record<TermKind, string> = { tag: "标签", author: "作者", actor: "角色", work: "原作", history: "历史" };

/** Mode toggle and chips, rendered inside the search input group before the text input. */
export function TagChips({ search }: { search: TagSearch }) {
    if (!search.tokens.length) return null;
    return (
        <div className="flex shrink-0 items-center gap-1 pl-1">
            {search.showMode && (
                <button type="button" onClick={search.toggleMode} aria-pressed={search.mode === "all"}
                    aria-label={`匹配方式：${search.mode === "all" ? "全部包含" : "任一包含"}`}
                    title={search.mode === "all" ? "结果需包含全部标签，点击改为任一" : "结果包含任一标签即可，点击改为全部"}
                    className="h-7 shrink-0 rounded-full border border-border px-2 text-xs text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand-500">
                    {search.mode === "all" ? "全部" : "任一"}
                </button>
            )}
            <div className="flex items-center gap-1" role="list" aria-label="搜索标签">
            {search.tokens.map((token) => (
                <span key={token.text} role="listitem"
                    className={`flex h-7 max-w-40 shrink-0 items-center rounded-full text-xs ${token.exclude
                        ? "bg-danger/10 text-danger"
                        : "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"}`}>
                    <button type="button" onClick={() => search.toggleToken(token)}
                        aria-label={`${token.exclude ? "排除" : "包含"}：${token.text}，点击改为${token.exclude ? "包含" : "排除"}`}
                        className={`min-w-0 truncate rounded-full py-1 pl-2.5 pr-1 focus-visible:outline-2 focus-visible:outline-brand-500 ${token.exclude ? "line-through" : ""}`}>
                        {token.exclude ? "−" : ""}{token.text}
                    </button>
                    <button type="button" onClick={() => search.removeToken(token)} aria-label={`移除 ${token.text}`}
                        className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-brand-500">
                        <X size={12} />
                    </button>
                </span>
            ))}
            </div>
        </div>
    );
}

/** Autocomplete list positioned under the search bar (the input group clips overflow). */
export function TagSuggestions({ search }: { search: TagSearch }) {
    if (!search.suggestions.length) return null;
    return (
        <ul id={search.listId} role="listbox" aria-label="搜索建议"
            className="absolute inset-x-0 top-12 z-(--z-popover) mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-overlay p-1 shadow-xl">
            {search.suggestions.map((term, index) => (
                <li key={`${term.kind}:${term.text}`} id={search.optionId(index)} role="option" aria-selected={index === search.active}
                    // Keep focus in the input so blur does not commit the half-typed draft first.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => search.pick(term)}
                    className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-sm ${index === search.active ? "bg-surface-secondary" : "hover:bg-surface-secondary"}`}>
                    <span className="truncate">{term.text}</span>
                    <span className="shrink-0 text-xs text-muted">{KIND_LABEL[term.kind]}</span>
                </li>
            ))}
        </ul>
    );
}
