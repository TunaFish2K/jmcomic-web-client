import { useState, type FormEvent } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SearchIcon } from "lucide-react";
import { ThemePopover } from "../theme/ThemeControls";
import { describeError, mobileApi } from "./api";
import { ComicGrid } from "./ComicGrid";
import { PageFrame, QueryState, Section } from "./ui";
import { buttonClass, inputClass } from "./shell";

/** Section types that list comics; library and novel sections are out of scope. */
const COMIC_SECTIONS = new Set(["promote", "category_id", "not_in_category_id"]);

export function HomePage() {
    const navigate = useNavigate();
    const [query, setQuery] = useState("");
    const promote = useQuery({ queryKey: ["mobile", "promote"], queryFn: ({ signal }) => mobileApi.promote(signal), staleTime: 5 * 60_000 });
    const latest = useInfiniteQuery({
        queryKey: ["mobile", "latest"],
        queryFn: ({ pageParam, signal }) => mobileApi.latest(pageParam, signal),
        initialPageParam: 0,
        getNextPageParam: (last, pages) => last.length > 0 ? pages.length : undefined,
        staleTime: 2 * 60_000,
    });
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (query.trim()) navigate(`/?q=${encodeURIComponent(query.trim())}`);
    };
    const sections = (promote.data ?? []).filter((section) => COMIC_SECTIONS.has(section.type) && section.items.length > 0);
    const latestItems = latest.data?.pages.flat() ?? [];

    return (
        <PageFrame title="首页" actions={<ThemePopover />}>
            <form onSubmit={submit} className="flex gap-2" role="search">
                <input aria-label="搜索内容" className={inputClass} placeholder="搜索内容..." value={query} onChange={(event) => setQuery(event.target.value)} />
                <button type="submit" className={buttonClass} aria-label="搜索"><SearchIcon size={16} /></button>
            </form>
            <QueryState pending={promote.isPending} error={promote.isError ? describeError(promote.error) : null} onRetry={() => void promote.refetch()}>
                {sections.map((section) => (
                    <Section key={section.id} title={section.title}
                        actions={/^\d+$/.test(section.id) && (
                            <button type="button" className="text-xs text-brand-600 dark:text-brand-300"
                                onClick={() => navigate(`/discover?tab=section&id=${section.id}&title=${encodeURIComponent(section.title)}`)}>更多</button>
                        )}>
                        <ComicGrid items={section.items.slice(0, 12)} layout="row" />
                    </Section>
                ))}
            </QueryState>
            <Section title="最新">
                <QueryState pending={latest.isPending} error={latest.isError ? describeError(latest.error) : null}
                    empty={latestItems.length === 0} onRetry={() => void latest.refetch()}>
                    <ComicGrid items={latestItems} />
                    {latest.hasNextPage && (
                        <button type="button" className={`${buttonClass} w-full`} disabled={latest.isFetchingNextPage} onClick={() => void latest.fetchNextPage()}>
                            {latest.isFetchingNextPage ? "加载中..." : "加载更多"}
                        </button>
                    )}
                </QueryState>
            </Section>
        </PageFrame>
    );
}
