import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@heroui/react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { Segmented } from "../ui/controls";
import { SelectField } from "../ui/fields";
import { Pager } from "../ui/Pager";
import { describeError, mobileApi } from "./api";
import { ComicGrid } from "./ComicGrid";
import { todayIndex } from "./text";
import { PageFrame, QueryState, Section } from "./ui";

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
            {categories.data && (
                <Segmented label="分类" value={category} onChange={(slug) => setCategory(slug, ["page"])}
                    options={categories.data.categories.map((item) => [item.slug || "0", item.name] as const)} />
            )}
            <SelectField label="排序" value={order} options={ORDERS} onChange={(next) => setOrder(next, ["page"])} />
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
            <Segmented label="星期" fullWidth value={String(day)} onChange={(next) => setDay(next, ["page"])}
                options={WEEKDAYS.map((label, index) => [String(index + 1), `周${label}`] as const)} />
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
            <div className="space-y-3">
                <SelectField label="期数" value={period} onChange={setPeriod}
                    options={(week.data?.periods ?? []).map((item) => [item.id, item.time || item.title] as const)} />
                <Segmented label="类型" value={type} onChange={setType}
                    options={(week.data?.types ?? []).map((item) => [item.id, item.title] as const)} />
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
                    <Button key={tag} size="sm" variant="secondary" className="rounded-full" onPress={() => navigate(`/?q=${encodeURIComponent(tag)}&cat=3`)}>{tag}</Button>
                ))}
            </div>
        </QueryState>
    );
}

function RandomPicks() {
    const random = useQuery({ queryKey: ["mobile", "random"], queryFn: ({ signal }) => mobileApi.random(signal), staleTime: Infinity });
    return (
        <>
            <Button variant="secondary" isPending={random.isFetching} onPress={() => void random.refetch()}>
                <RefreshCw size={14} />换一批
            </Button>
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
            {tab === "section" ? (
                <Button size="sm" variant="ghost" onPress={() => setParams({ tab: "categories" }, { replace: true })}>
                    <ChevronLeft size={16} />返回发现
                </Button>
            ) : (
                <Segmented label="发现" value={TABS.some(([id]) => id === tab) ? tab : "categories"} options={TABS}
                    onChange={(id) => setParams({ tab: id }, { replace: true })} />
            )}
            {tab === "section" && sectionId && /^\d+$/.test(sectionId) ? <PromoteSection id={sectionId} title={params.get("title") || "推荐"} />
                : tab === "serialization" ? <Serialization />
                    : tab === "week" ? <WeekPicks />
                        : tab === "tags" ? <HotTags />
                            : tab === "random" ? <RandomPicks />
                                : <Categories />}
        </PageFrame>
    );
}
