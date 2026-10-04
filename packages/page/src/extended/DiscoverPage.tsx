import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { describeError, mobileApi } from "./api";
import { ComicGrid } from "./ComicGrid";
import { todayIndex } from "./text";
import { PageFrame, Pager, QueryState, Section } from "./ui";
import { buttonClass, chipClass, inputClass } from "./shell";

const TABS = [["categories", "分类排行"], ["serialization", "连载"], ["week", "每周必看"], ["tags", "热门标签"], ["random", "随机推荐"]] as const;
const ORDERS = [["", "最新"], ["tf", "最多爱心"], ["mv", "总排行"], ["mv_m", "月排行"], ["mp_w", "周排行"]] as const;
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function useParam(name: string, fallback: string): [string, (value: string, reset?: string[]) => void] {
    const [params, setParams] = useSearchParams();
    const set = (value: string, reset: string[] = []) => setParams((current) => {
        const next = new URLSearchParams(current);
        next.set(name, value);
        for (const key of reset) next.delete(key);
        return next;
    }, { replace: true });
    return [params.get(name) ?? fallback, set];
}
const pageNumber = (value: string) => Math.max(1, Number.parseInt(value, 10) || 1);

function Categories() {
    const [category, setCategory] = useParam("c", "0");
    const [order, setOrder] = useParam("o", "");
    const [pageValue, setPage] = useParam("page", "1");
    const page = pageNumber(pageValue);
    const categories = useQuery({ queryKey: ["mobile", "categories"], queryFn: ({ signal }) => mobileApi.categories(signal), staleTime: 60 * 60_000 });
    const list = useQuery({
        queryKey: ["mobile", "categories", category, order, page],
        queryFn: ({ signal }) => mobileApi.categoryFilter(category, order, page, signal),
        staleTime: 5 * 60_000,
    });
    return (
        <>
            <div className="flex gap-2 overflow-x-auto pb-1">
                {(categories.data?.categories ?? []).map((item) => {
                    const slug = item.slug || "0";
                    return <button key={item.id} type="button" className={chipClass(slug === category)} onClick={() => setCategory(slug, ["page"])}>{item.name}</button>;
                })}
            </div>
            <select aria-label="排序" className={inputClass} value={order} onChange={(event) => setOrder(event.target.value, ["page"])}>
                {ORDERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <QueryState pending={list.isPending} error={list.isError ? describeError(list.error) : null} empty={list.data?.items.length === 0} onRetry={() => void list.refetch()}>
                <ComicGrid items={list.data?.items ?? []} />
                <Pager page={page} hasPrev={page > 1} hasNext={(list.data?.items.length ?? 0) > 0 && page * (list.data?.items.length ?? 1) < (list.data?.total ?? 0)}
                    onChange={(next) => setPage(String(next))} />
            </QueryState>
        </>
    );
}

function Serialization() {
    const [dayValue, setDay] = useParam("day", String(todayIndex()));
    const [pageValue, setPage] = useParam("page", "1");
    const day = Math.min(7, Math.max(1, Number(dayValue) || todayIndex()));
    const page = pageNumber(pageValue);
    const list = useQuery({
        queryKey: ["mobile", "serialization", day, page],
        queryFn: ({ signal }) => mobileApi.serialization(day, page, signal),
        staleTime: 5 * 60_000,
    });
    return (
        <>
            <div className="flex gap-2">
                {WEEKDAYS.map((label, index) => (
                    <button key={label} type="button" className={chipClass(day === index + 1)} onClick={() => setDay(String(index + 1), ["page"])}>周{label}</button>
                ))}
            </div>
            <QueryState pending={list.isPending} error={list.isError ? describeError(list.error) : null} empty={list.data?.items.length === 0} onRetry={() => void list.refetch()}>
                <ComicGrid items={list.data?.items ?? []} />
                <Pager page={page} hasPrev={page > 1} hasNext={(list.data?.items.length ?? 0) > 0 && page * (list.data?.items.length ?? 1) < (list.data?.total ?? 0)}
                    onChange={(next) => setPage(String(next))} />
            </QueryState>
        </>
    );
}

function WeekPicks() {
    const week = useQuery({ queryKey: ["mobile", "week"], queryFn: ({ signal }) => mobileApi.week(signal), staleTime: 60 * 60_000 });
    const [periodValue, setPeriod] = useParam("period", "");
    const [typeValue, setType] = useParam("type", "");
    const period = periodValue || week.data?.periods[0]?.id || "";
    const type = typeValue || week.data?.types[0]?.id || "";
    const list = useQuery({
        queryKey: ["mobile", "week", period, type],
        queryFn: ({ signal }) => mobileApi.weekFilter(period, type, signal),
        enabled: !!period && !!type,
        staleTime: 10 * 60_000,
    });
    return (
        <QueryState pending={week.isPending} error={week.isError ? describeError(week.error) : null} onRetry={() => void week.refetch()}>
            <select aria-label="期数" className={inputClass} value={period} onChange={(event) => setPeriod(event.target.value)}>
                {week.data?.periods.map((item) => <option key={item.id} value={item.id}>{item.time || item.title}</option>)}
            </select>
            <div className="flex gap-2">
                {week.data?.types.map((item) => <button key={item.id} type="button" className={chipClass(item.id === type)} onClick={() => setType(item.id)}>{item.title}</button>)}
            </div>
            <QueryState pending={list.isPending} error={list.isError ? describeError(list.error) : null} empty={list.data?.items.length === 0} onRetry={() => void list.refetch()}>
                <ComicGrid items={list.data?.items ?? []} />
            </QueryState>
        </QueryState>
    );
}

function HotTags() {
    const navigate = useNavigate();
    const tags = useQuery({ queryKey: ["mobile", "hot-tags"], queryFn: ({ signal }) => mobileApi.hotTags(signal), staleTime: 60 * 60_000 });
    return (
        <QueryState pending={tags.isPending} error={tags.isError ? describeError(tags.error) : null} empty={tags.data?.length === 0} onRetry={() => void tags.refetch()}>
            <div className="flex flex-wrap gap-2">
                {tags.data?.map((tag) => (
                    <button key={tag} type="button" className={chipClass(false)} onClick={() => navigate(`/?q=${encodeURIComponent(tag)}&cat=3`)}>{tag}</button>
                ))}
            </div>
        </QueryState>
    );
}

function RandomPicks() {
    const random = useQuery({ queryKey: ["mobile", "random"], queryFn: ({ signal }) => mobileApi.random(signal), staleTime: Infinity });
    return (
        <>
            <button type="button" className={buttonClass} disabled={random.isFetching} onClick={() => void random.refetch()}>
                <RefreshCw size={14} />换一批
            </button>
            <QueryState pending={random.isPending} error={random.isError ? describeError(random.error) : null} empty={random.data?.length === 0} onRetry={() => void random.refetch()}>
                <ComicGrid items={random.data ?? []} />
            </QueryState>
        </>
    );
}

function PromoteSection({ id, title }: { id: string; title: string }) {
    const [pageValue, setPage] = useParam("page", "1");
    const page = pageNumber(pageValue);
    const list = useQuery({
        queryKey: ["mobile", "promote-list", id, page],
        // The upstream numbers these pages from 0.
        queryFn: ({ signal }) => mobileApi.promoteList(id, page - 1, signal),
        staleTime: 5 * 60_000,
    });
    return (
        <Section title={title}>
            <QueryState pending={list.isPending} error={list.isError ? describeError(list.error) : null} empty={list.data?.items.length === 0} onRetry={() => void list.refetch()}>
                <ComicGrid items={list.data?.items ?? []} />
                <Pager page={page} hasPrev={page > 1} hasNext={(list.data?.items.length ?? 0) > 0 && page * (list.data?.items.length ?? 1) < (list.data?.total ?? 0)}
                    onChange={(next) => setPage(String(next))} />
            </QueryState>
        </Section>
    );
}

export function DiscoverPage() {
    const [params, setParams] = useSearchParams();
    const tab = params.get("tab") ?? "categories";
    const sectionId = params.get("id");
    return (
        <PageFrame title="发现">
            <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
                {TABS.map(([id, label]) => (
                    <button key={id} type="button" role="tab" aria-selected={tab === id} className={chipClass(tab === id)}
                        onClick={() => setParams({ tab: id }, { replace: true })}>{label}</button>
                ))}
            </div>
            {tab === "section" && sectionId && /^\d+$/.test(sectionId) ? <PromoteSection id={sectionId} title={params.get("title") || "推荐"} />
                : tab === "serialization" ? <Serialization />
                    : tab === "week" ? <WeekPicks />
                        : tab === "tags" ? <HotTags />
                            : tab === "random" ? <RandomPicks />
                                : <Categories />}
        </PageFrame>
    );
}
