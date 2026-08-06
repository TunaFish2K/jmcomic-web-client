import { useState } from "react";
import { Button, InputGroup, Select, ListBox } from "@heroui/react";
import { SearchIcon, RefreshCw } from "lucide-react";
import { TaskContext } from "./task-context";
import { useSearchState } from "./useSearchState";
import { useAlbumBatch } from "./useAlbumBatch";
import { useDownloads } from "./useDownloads";
import { TaskPanel } from "./TaskPanel";
import { AlbumModal } from "./AlbumModal";
import { AlbumCard } from "./AlbumCard";
import { CoverImage } from "./CoverImage";
import { ThemePopover } from "../theme/ThemeControls";

export default function Home() {
    const [modalAlbumId, setModalAlbumId] = useState<string | null>(null);

    const {
        urlQuery, urlPage,
        query, category, setCategory, orderBy, setOrderBy, timeFilter, setTimeFilter,
        queryError, data, isSearchError, searchPending, refetchSearch, fallbackSearch,
        totalCount, totalPages, hasNextPage, hasPrevPage,
        redirectAid, hasResults,
        pushSearch, handleQueryChange, handleSubmit, handlePageChange,
        listRef,
    } = useSearchState(() => setModalAlbumId(null));

    const { showTaskPanel, setShowTaskPanel, taskContextValue, clearCompleted } = useDownloads();
    const { albumCache, getCardRef } = useAlbumBatch(data);

    return (
        <TaskContext.Provider value={taskContextValue}>
            <div className="fixed inset-0 flex flex-col items-center pt-4 px-4">

                {/* task panel */}
                {showTaskPanel && (
                    <TaskPanel onClose={() => { setShowTaskPanel(false); clearCompleted(); }} />
                )}

                {/* modal */}
                {modalAlbumId && (
                    <AlbumModal
                        albumId={modalAlbumId}
                        cachedData={albumCache.get(modalAlbumId)}
                        onClose={() => setModalAlbumId(null)}
                    />
                )}

                <div className="w-full max-w-2xl flex flex-col h-full">

                    {/* ── search bar ── */}
                    <form onSubmit={handleSubmit} className="shrink-0 mb-3">
                        <div className="flex h-12 w-full">
                            <InputGroup
                                className="search-input-group relative z-0 h-12 min-w-0 flex-1 rounded-r-none focus-within:z-10"
                                isInvalid={!!queryError}
                            >
                                <InputGroup.Prefix className="p-0 flex-shrink-0">
                                    <Select
                                        aria-label="搜索类别"
                                        className="w-24 min-w-[96px] h-full"
                                        variant="secondary"
                                        value={category}
                                        onChange={(value) => {
                                            const v = (value as "0" | "1" | "2" | "3" | "4") ?? "0";
                                            setCategory(v);
                                            if (query.trim()) pushSearch(query, v, orderBy, timeFilter, 1);
                                        }}
                                        placeholder="选择类别"
                                    >
                                        <Select.Trigger className="h-full rounded-none border-none shadow-none bg-transparent px-3 flex items-center justify-center gap-1">
                                            <Select.Value className="text-center flex-1" />
                                            <Select.Indicator className="flex-shrink-0" />
                                        </Select.Trigger>
                                        <Select.Popover>
                                            <ListBox>
                                                <ListBox.Item id="0" textValue="全部">全部</ListBox.Item>
                                                <ListBox.Item id="1" textValue="作品名称">作品名称</ListBox.Item>
                                                <ListBox.Item id="2" textValue="作者">作者</ListBox.Item>
                                                <ListBox.Item id="3" textValue="标签">标签</ListBox.Item>
                                                <ListBox.Item id="4" textValue="角色">角色</ListBox.Item>
                                            </ListBox>
                                        </Select.Popover>
                                    </Select>
                                </InputGroup.Prefix>
                                <InputGroup.Input
                                    placeholder="搜索内容..."
                                    name="query"
                                    value={query}
                                    onChange={handleQueryChange}
                                    aria-describedby={queryError ? "search-query-error" : undefined}
                                    aria-invalid={!!queryError}
                                    className="flex-1 min-w-0 [&:-webkit-autofill]:h-full [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_white] dark:[&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_#030712]"
                                />
                            </InputGroup>
                            <Button
                                type="submit"
                                className="relative z-0 -ml-px h-12 min-w-12 flex-shrink-0 rounded-field rounded-l-none px-4 bg-brand-500 text-brand-foreground hover:bg-brand-600 data-[hovered=true]:bg-brand-600 data-[pressed=true]:bg-brand-700 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                                variant="primary"
                                isDisabled={searchPending}
                                aria-label={searchPending ? '正在搜索' : '搜索'}
                                aria-busy={searchPending}
                            >
                                {searchPending
                                    ? <span className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-current border-t-transparent" />
                                    : <SearchIcon size={18} />}
                            </Button>
                        </div>
                        {queryError && (
                            <p id="search-query-error" role="alert" className="field-error mt-1 ml-1" data-visible="true">
                                {queryError}
                            </p>
                        )}

                        {/* sort & time */}
                        <div className="flex gap-2 mt-2 items-center">
                            <Select
                                aria-label="排序方式" className="flex-1" variant="secondary"
                                value={orderBy}
                                onChange={(value) => {
                                    const v = (value as "mr" | "mv" | "mp" | "tf") ?? "mr";
                                    setOrderBy(v);
                                    if (query.trim()) pushSearch(urlQuery, category, v, timeFilter, 1);
                                }}
                                
                            >
                                <Select.Trigger className="h-10 text-sm"><Select.Value /><Select.Indicator /></Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        <ListBox.Item id="mr" textValue="最新发布">最新发布</ListBox.Item>
                                        <ListBox.Item id="mv" textValue="最多浏览">最多浏览</ListBox.Item>
                                        <ListBox.Item id="mp" textValue="最多图片">最多图片</ListBox.Item>
                                        <ListBox.Item id="tf" textValue="最多喜欢">最多喜欢</ListBox.Item>
                                    </ListBox>
                                </Select.Popover>
                            </Select>
                            <Select
                                aria-label="时间范围" className="flex-1" variant="secondary"
                                value={timeFilter}
                                onChange={(value) => {
                                    const v = (value as "a" | "t" | "w" | "m") ?? "a";
                                    setTimeFilter(v);
                                    if (query.trim()) pushSearch(urlQuery, category, orderBy, v, 1);
                                }}
                                
                            >
                                <Select.Trigger className="h-10 text-sm"><Select.Value /><Select.Indicator /></Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        <ListBox.Item id="a" textValue="全部时间">全部时间</ListBox.Item>
                                        <ListBox.Item id="t" textValue="今天">今天</ListBox.Item>
                                        <ListBox.Item id="w" textValue="本周">本周</ListBox.Item>
                                        <ListBox.Item id="m" textValue="本月">本月</ListBox.Item>
                                    </ListBox>
                                </Select.Popover>
                            </Select>

                            <ThemePopover />
                        </div>
                    </form>

                    {isSearchError && (
                        <div className="shrink-0 mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                            <div className="min-w-0">
                                <div className="text-sm font-medium">第 {urlPage} 页加载失败</div>
                                <div className="text-xs opacity-80">
                                    {fallbackSearch ? '仍显示上一次成功加载的结果。' : '请检查网络或稍后重试。'}
                                </div>
                            </div>
                            <Button
                                size="sm"
                                variant="secondary"
                                className="shrink-0 text-xs"
                                onPress={() => { void refetchSearch(); }}
                            >
                                <RefreshCw size={14} className="mr-1" />重试
                            </Button>
                        </div>
                    )}

                    <div className="relative flex min-h-0 flex-1 flex-col" aria-busy={searchPending}>
                        {searchPending && data && (
                            <div
                                className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-brand-100 dark:bg-brand-950"
                                role="progressbar"
                                aria-label="正在更新搜索结果"
                            >
                                <div className="search-progress-bar h-full w-2/5 bg-brand-500" />
                            </div>
                        )}

                        {/* ── direct match ── */}
                        {redirectAid && (
                            <div className="shrink-0 mb-3 border dark:border-gray-700 rounded-lg bg-brand-50 dark:bg-brand-900/30 overflow-hidden">
                                <div className="p-2 bg-brand-100 dark:bg-brand-900/40 text-sm font-medium text-brand-800 dark:text-brand-200">搜索到直接匹配的本子</div>
                                <div
                                    className="p-3 cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-900/20"
                                    onClick={() => setModalAlbumId(redirectAid)}
                                >
                                    <div className="flex gap-3 items-center">
                                        {albumCache.get(redirectAid)?.photo?.images[0] && (
                                            <CoverImage
                                                coverUrl={albumCache.get(redirectAid)!.photo!.images[0].url}
                                                scrambleId={albumCache.get(redirectAid)!.photo!.scrambleId}
                                                albumId={redirectAid}
                                                className="w-12 h-16 rounded shrink-0"
                                            />
                                        )}
                                        <div>
                                            <div className="text-sm font-medium">{albumCache.get(redirectAid)?.album?.name ?? `#${redirectAid}`}</div>
                                            <div className="text-xs text-gray-400">点击查看详情</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* ── results grid ── */}
                        {hasResults && (
                            <div ref={listRef} className="flex-1 overflow-y-auto min-h-0 mb-3">
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                                    {data.content.map(item => (
                                        <AlbumCard
                                            key={item.id}
                                            item={item}
                                            cachedData={albumCache.get(item.id)}
                                            onClick={() => setModalAlbumId(item.id)}
                                            cardRef={getCardRef(item.id)}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── first load ── */}
                        {searchPending && !data && (
                            <div className="flex flex-1 items-center justify-center text-gray-500 dark:text-gray-400" role="status">
                                <div className="flex items-center gap-2">
                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500 dark:border-gray-600 dark:border-t-brand-500" />
                                    <span className="text-sm">正在搜索...</span>
                                </div>
                            </div>
                        )}

                        {/* ── empty ── */}
                        {data && "content" in data && data.content.length === 0 && !redirectAid && (
                            <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400 text-sm">
                                没有找到相关结果
                            </div>
                        )}

                        {/* ── pagination ── */}
                        {totalCount > 0 && (
                            <div className="shrink-0 py-3 border-t dark:border-gray-700">
                                <div className="flex items-center justify-center gap-1 mb-2">
                                    <Button variant="secondary" size="sm" className="px-2 text-xs"
                                        isDisabled={urlPage === 1 || searchPending} onPress={() => handlePageChange(1)}>首页</Button>
                                    <Button variant="secondary" size="sm" className="px-2 text-xs"
                                        isDisabled={!hasPrevPage || searchPending} onPress={() => handlePageChange(urlPage - 1)}>上页</Button>
                                    <Button variant="secondary" size="sm" className="px-2 text-xs"
                                        isDisabled={!hasNextPage || searchPending || isSearchError} onPress={() => handlePageChange(urlPage + 1)}>下页</Button>
                                    <Button variant="secondary" size="sm" className="px-2 text-xs"
                                        isDisabled={urlPage === totalPages || searchPending || isSearchError} onPress={() => handlePageChange(totalPages)}>尾页</Button>
                                </div>
                                <div className="text-center text-gray-500 dark:text-gray-400 text-xs">{totalCount}条·{urlPage}/{totalPages}页</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </TaskContext.Provider>
    );
}
