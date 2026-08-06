import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { search } from "../api";
import type { SearchResult } from "@tiny-client/shared";
import { getSearchResultIds, SEARCH_PAGE_SIZE } from "@tiny-client/shared";

export type SettledSearch = {
    sessionKey: string;
    page: number;
    data: SearchResult;
    ids: string[];
};

export function useSearchState(onNavigate: () => void) {
    // ── URL search params (single source of truth) ───────────────────────────
    const [urlParams, setUrlParams] = useSearchParams();

    const urlQuery    = urlParams.get('q') ?? '';
    const urlCategory = (urlParams.get('cat') ?? '0') as "0"|"1"|"2"|"3"|"4";
    const urlOrderBy  = (urlParams.get('order') ?? 'mr') as "mr"|"mv"|"mp"|"tf";
    const urlTime     = (urlParams.get('time') ?? 'a') as "a"|"t"|"w"|"m";
    const urlPage     = parseInt(urlParams.get('page') ?? '1') || 1;

    // local input state (controlled input, not yet submitted)
    const [query, setQuery]           = useState(urlQuery);
    const [category, setCategory]     = useState<"0"|"1"|"2"|"3"|"4">(urlCategory);
    const [orderBy, setOrderBy]       = useState<"mr"|"mv"|"mp"|"tf">(urlOrderBy);
    const [timeFilter, setTimeFilter] = useState<"a"|"t"|"w"|"m">(urlTime);
    const [queryError, setQueryError] = useState<string | null>(null);

    const listRef = useRef<HTMLDivElement>(null);
    const lastSettledSearchRef = useRef<SettledSearch | null>(null);
    const displayedResultKeyRef = useRef<string | null>(null);

    // ── search query — driven by URL params ──────────────────────────────────
    const searchSessionKey = `${urlQuery}\u0000${urlCategory}\u0000${urlOrderBy}\u0000${urlTime}`;
    const searchQuery = useQuery<SearchResult>({
        queryKey: ["search", urlQuery, urlPage, urlCategory, urlOrderBy, urlTime],
        queryFn: () => {
            const previousSearch = lastSettledSearchRef.current;
            const previousIds = previousSearch?.sessionKey === searchSessionKey && previousSearch.page !== urlPage
                ? previousSearch.ids
                : undefined;
            return search(urlQuery, {
                mainTag: parseInt(urlCategory) as 1 | 2 | 3 | 4,
                page: urlPage,
                orderBy: urlOrderBy,
                time: urlTime,
                previousIds,
            });
        },
        enabled: !!urlQuery,
        staleTime: 5 * 60 * 1000,   // don't refetch the same query within 5 min
        gcTime: 10 * 60 * 1000,     // keep cached results for 10 min
        placeholderData: keepPreviousData,
        retry: 1,
    });
    const {
        data: queryData,
        isError: isSearchError,
        isFetching,
        isPlaceholderData,
        refetch: refetchSearch,
    } = searchQuery;
    /* eslint-disable react-hooks/refs -- 读取最近一次已成功落定的搜索，作为查询数据时的回退展示 */
    const fallbackSearch = lastSettledSearchRef.current?.sessionKey === searchSessionKey
        ? lastSettledSearchRef.current
        : null;
    /* eslint-enable react-hooks/refs */
    const data = queryData ?? fallbackSearch?.data;
    const searchPending = isFetching || isPlaceholderData;

    useEffect(() => {
        if (!queryData || isPlaceholderData || isSearchError) return;
        lastSettledSearchRef.current = {
            sessionKey: searchSessionKey,
            page: urlPage,
            data: queryData,
            ids: getSearchResultIds(queryData),
        };

        const resultKey = `${searchSessionKey}\u0000${urlPage}`;
        if (displayedResultKeyRef.current !== resultKey) {
            displayedResultKeyRef.current = resultKey;
            listRef.current?.scrollTo({ top: 0, behavior: 'auto' });
        }
    }, [isPlaceholderData, isSearchError, queryData, searchSessionKey, urlPage]);

    // ── pagination ───────────────────────────────────────────────────────────
    const totalCount = data?.total ? parseInt(data.total) : 0;
    const totalPages = Math.ceil(totalCount / SEARCH_PAGE_SIZE);
    const hasNextPage = urlPage < totalPages;
    const hasPrevPage = urlPage > 1;

    const redirectAid = data && "redirect_aid" in data && data.redirect_aid ? data.redirect_aid : null;
    const hasResults = data && "content" in data && data.content.length > 0;

    // helper: write all search params to URL at once
    const pushSearch = useCallback((
        q: string, cat: string, ord: string, time: string, pg: number
    ) => {
        setUrlParams({ q, cat, order: ord, time, page: String(pg) }, { replace: false });
    }, [setUrlParams]);

    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        if (queryError) setQueryError(null);
    };

    const performSearch = () => {
        if (!query.trim()) return;
        onNavigate();
        pushSearch(query, category, orderBy, timeFilter, 1);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) { setQueryError("请填写搜索内容"); return; }
        performSearch();
    };

    const handlePageChange = (newPage: number) => {
        onNavigate();
        pushSearch(urlQuery, urlCategory, urlOrderBy, urlTime, newPage);
    };

    /* eslint-disable react-hooks/refs -- data 由最近一次落定的搜索回退值推导，该回退值只在渲染期读取 ref */
    return {
        urlQuery, urlCategory, urlOrderBy, urlTime, urlPage,
        query, setQuery, category, setCategory, orderBy, setOrderBy, timeFilter, setTimeFilter,
        queryError, setQueryError,
        data, isSearchError, searchPending, refetchSearch, fallbackSearch,
        totalCount, totalPages, hasNextPage, hasPrevPage,
        redirectAid, hasResults,
        pushSearch, handleQueryChange, performSearch, handleSubmit, handlePageChange,
        listRef,
    };
    /* eslint-enable react-hooks/refs */
}
