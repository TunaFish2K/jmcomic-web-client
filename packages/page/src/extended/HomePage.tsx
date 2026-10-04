import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { describeError, mobileApi } from "./api";
import { ComicGrid } from "./ComicGrid";
import { Button } from "@heroui/react";
import { QueryState, Section } from "./ui";

/** Section types that list comics; library and novel sections are out of scope. */
const COMIC_SECTIONS = new Set(["promote", "category_id", "not_in_category_id"]);

/** Recommendations and latest comics shown under the search bar before the first search. */
export function HomeFeed() {
    const navigate = useNavigate();
    const promote = useQuery({ queryKey: ["mobile", "promote"], queryFn: ({ signal }) => mobileApi.promote(signal), staleTime: 5 * 60_000 });
    const latest = useInfiniteQuery({
        queryKey: ["mobile", "latest"],
        queryFn: ({ pageParam, signal }) => mobileApi.latest(pageParam, signal),
        initialPageParam: 0,
        getNextPageParam: (last, pages) => last.length > 0 ? pages.length : undefined,
        staleTime: 2 * 60_000,
    });
    const sections = (promote.data ?? []).filter((section) => COMIC_SECTIONS.has(section.type) && section.items.length > 0);
    const latestItems = latest.data?.pages.flat() ?? [];

    return (
        <>
            <QueryState pending={promote.isPending} error={promote.isError ? describeError(promote.error) : null} onRetry={() => void promote.refetch()}>
                {sections.map((section) => (
                    <Section key={section.id} title={section.title}
                        actions={/^\d+$/.test(section.id) && (
                            <Button size="sm" variant="ghost" className="text-brand-600 dark:text-brand-300"
                                onPress={() => navigate(`/discover?tab=section&id=${section.id}&title=${encodeURIComponent(section.title)}`)}>更多</Button>
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
                        <Button variant="secondary" fullWidth isPending={latest.isFetchingNextPage} onPress={() => void latest.fetchNextPage()}>
                            {latest.isFetchingNextPage ? "加载中..." : "加载更多"}
                        </Button>
                    )}
                </QueryState>
            </Section>
        </>
    );
}
