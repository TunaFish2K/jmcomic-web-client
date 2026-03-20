import { useState, useRef, createContext, useContext, useCallback, useEffect } from "react";
import { Button, InputGroup, Select, ListBox, FieldError } from "@heroui/react";
import { SearchIcon, ChevronDown, ChevronUp, X, Download, FileArchive, FileText, Sun, Moon, Monitor } from "lucide-react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { search, getPhoto, getBatchAlbum } from "../api";
import type { BatchAlbumItem } from "../api";
import type { SearchResult, PhotoWithScrambleId } from "@tiny-client/shared";
import { useSearchParams } from "react-router-dom";
import {
    startDownload,
    downloadAllImages,
    downloadAndDecryptImagesOfPhotoThenWriteIntoZipFile,
    getSliceCount,
    reverseImageBySlice,
} from "@tiny-client/shared";
import { PDFDocument } from "pdf-lib";

// ─── Cover image (decrypt in browser) ───────────────────────────────────────

function CoverImage({ coverUrl, scrambleId, albumId, className }: {
    coverUrl: string;
    scrambleId: number;
    albumId: string;
    className?: string;
}) {
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let created: string | null = null;
        (async () => {
            try {
                const res = await fetch(coverUrl);
                const buffer = await res.arrayBuffer();
                const filename = coverUrl.split('/').pop() ?? '';
                const slices = getSliceCount(scrambleId, parseInt(albumId), filename);
                const { data } = slices > 0
                    ? await reverseImageBySlice(buffer, slices)
                    : { data: buffer };
                const blob = new Blob([data], { type: 'image/jpeg' });
                created = URL.createObjectURL(blob);
                if (!cancelled) setObjectUrl(created);
            } catch {
                if (!cancelled) setFailed(true);
            }
        })();
        return () => {
            cancelled = true;
            if (created) URL.revokeObjectURL(created);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [coverUrl, scrambleId, albumId]);

    if (failed) return (
        <div className={`bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-300 dark:text-gray-600 text-xs ${className ?? ''}`}>✕</div>
    );
    if (!objectUrl) return (
        <div className={`bg-gray-100 dark:bg-gray-800 animate-pulse ${className ?? ''}`} />
    );
    return <img src={objectUrl} alt="" className={`object-cover ${className ?? ''}`} />;
}

// ─── Download task types & context ──────────────────────────────────────────

type DownloadTask = {
    id: string;
    albumId: string;
    name: string;
    format: 'pdf' | 'zip' | 'cbz';
    stage: 'downloading' | 'packaging' | 'completed' | 'error';
    progress: number;
    total: number;
    error?: string;
};

type TaskContextType = {
    tasks: DownloadTask[];
    addTask: (task: Omit<DownloadTask, 'id'>) => string;
    updateTask: (id: string, updates: Partial<DownloadTask>) => void;
    removeTask: (id: string) => void;
    clearCompleted: () => void;
};

const TaskContext = createContext<TaskContextType | null>(null);

function useTasks() {
    const ctx = useContext(TaskContext);
    if (!ctx) throw new Error('useTasks must be used within TaskProvider');
    return ctx;
}

// ─── Task panel (bottom-right float) ────────────────────────────────────────

function TaskPanel({ onClose }: { onClose: () => void }) {
    const { tasks, removeTask, clearCompleted } = useTasks();
    const [expanded, setExpanded] = useState(true);

    const activeTasks = tasks.filter(t => t.stage !== 'completed' && t.stage !== 'error');
    const completedTasks = tasks.filter(t => t.stage === 'completed');

    const stageText = (s: DownloadTask['stage']) =>
        ({ downloading: '下载图片', packaging: '打包中', completed: '完成', error: '错误' })[s];
    const stageColor = (s: DownloadTask['stage']) =>
        ({ downloading: 'bg-blue-500', packaging: 'bg-yellow-500', completed: 'bg-green-500', error: 'bg-red-500' })[s];

    if (tasks.length === 0) return null;

    return (
        <div className="fixed bottom-20 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50/80 dark:hover:bg-white/5 rounded-t-2xl"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">下载 ({activeTasks.length}进行中)</span>
                    {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
                </div>
                <div className="flex items-center gap-2">
                    {completedTasks.length > 0 && (
                        <button onClick={e => { e.stopPropagation(); clearCompleted(); }} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
                            清除
                        </button>
                    )}
                    <button onClick={e => { e.stopPropagation(); onClose(); }} className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400">
                        <X size={16} />
                    </button>
                </div>
            </div>
            {expanded && (
                <div className="max-h-48 overflow-y-auto border-t border-gray-100 dark:border-gray-800">
                    {tasks.map(task => (
                        <div key={task.id} className="px-4 py-3 border-b border-gray-50 dark:border-gray-800/50 last:border-b-0">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex-1 min-w-0 mr-2">
                                    <div className="text-sm font-medium truncate" title={task.name}>{task.name}</div>
                                    <div className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5 mt-0.5">
                                        <span className="font-mono">{task.format.toUpperCase()}</span>
                                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${stageColor(task.stage)}`} />
                                        <span>{stageText(task.stage)}</span>
                                    </div>
                                </div>
                                <button onClick={() => removeTask(task.id)} className="text-gray-300 dark:text-gray-600 hover:text-red-500 shrink-0">
                                    <X size={14} />
                                </button>
                            </div>
                            <div className="relative h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div
                                    className={`absolute top-0 left-0 h-full rounded-full ${stageColor(task.stage)}`}
                                    style={{ width: `${task.total > 0 ? (task.progress / task.total) * 100 : 0}%` }}
                                />
                            </div>
                            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 text-right tabular-nums">{task.progress}/{task.total}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Download buttons ────────────────────────────────────────────────────────

function DownloadButtons({ id, name }: { id: string; name: string }) {
    const { tasks, addTask, updateTask } = useTasks();

    const handleDownload = async (format: 'pdf' | 'zip' | 'cbz') => {
        const existingTask = tasks.find(t =>
            t.albumId === id && t.format === format && t.stage !== 'completed' && t.stage !== 'error'
        );
        if (existingTask) return;

        let taskId = '';
        try {
            taskId = addTask({ albumId: id, name, format, stage: 'downloading', progress: 0, total: 1 });

            const photo = await getPhoto(id);
            if (!photo) throw new Error('无法获取图片数据');

            const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
            const totalImages = photo.images.length;
            const totalProgress = format === 'pdf' ? 1 + totalImages * 2 : 1 + totalImages;

            updateTask(taskId, { total: totalProgress, progress: 1 });

            if (format === 'pdf') {
                const buffer = await (async () => {
                    const pdfDocument = await PDFDocument.create();
                    let processedCount = 0;

                    const downloadedImages = await downloadAllImages(
                        photo.images, 20,
                        (done) => updateTask(taskId, { progress: 1 + done, stage: 'downloading' }),
                        photo.id,
                        (photo as PhotoWithScrambleId).scrambleId,
                    );

                    updateTask(taskId, { stage: 'packaging' });

                    for (let i = 0; i < downloadedImages.length; i++) {
                        const image = downloadedImages[i];
                        processedCount++;
                        if (image.data === null) {
                            updateTask(taskId, { progress: 1 + totalImages + processedCount, stage: 'packaging' });
                            continue;
                        }
                        const bitmap = await createImageBitmap(new Blob([image.data]));
                        const width = bitmap.width;
                        const height = bitmap.height;
                        bitmap.close();
                        const page = pdfDocument.addPage([width, height]);
                        const pdfImage = await pdfDocument.embedJpg(image.data);
                        page.drawImage(pdfImage, { x: 0, y: 0, width, height });
                        updateTask(taskId, { progress: 1 + totalImages + processedCount, stage: 'packaging' });
                    }

                    const pdfBytes = await pdfDocument.save();
                    updateTask(taskId, { progress: totalProgress, stage: 'completed' });
                    return pdfBytes.buffer;
                })();
                startDownload(`${safeName}.pdf`, new Uint8Array(buffer), 'application/pdf');
            } else {
                const buffer = await downloadAndDecryptImagesOfPhotoThenWriteIntoZipFile(
                    photo as PhotoWithScrambleId,
                    (done, total) => updateTask(taskId, {
                        progress: 1 + done,
                        stage: done < total ? 'packaging' : 'completed',
                    }),
                );
                const mimeType = format === 'cbz' ? 'application/octet-stream' : 'application/zip';
                startDownload(`${safeName}.${format}`, new Uint8Array(buffer), mimeType);
                updateTask(taskId, { progress: totalProgress, stage: 'completed' });
            }
        } catch (error) {
            console.error('下载失败:', error);
            updateTask(taskId, { stage: 'error', error: (error as Error).message, progress: 0, total: 1 });
        }
    };

    return (
        <div className="mt-3 space-y-2">
            <div className="text-gray-500 dark:text-gray-400 text-xs">下载格式:</div>
            <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="text-xs flex-1" onPress={() => handleDownload('pdf')}>
                    <FileText size={14} className="mr-1" />PDF
                </Button>
                <Button size="sm" variant="secondary" className="text-xs flex-1" onPress={() => handleDownload('zip')}>
                    <FileArchive size={14} className="mr-1" />ZIP
                </Button>
                <Button size="sm" variant="secondary" className="text-xs flex-1" onPress={() => handleDownload('cbz')}>
                    <Download size={14} className="mr-1" />CBZ
                </Button>
            </div>
        </div>
    );
}

// ─── Album detail modal ──────────────────────────────────────────────────────

function AlbumModal({ albumId, cachedData, onClose }: {
    albumId: string;
    cachedData: BatchAlbumItem | undefined;
    onClose: () => void;
}) {
    const album = cachedData?.album ?? null;
    const photo = cachedData?.photo ?? null;

    return (
        /* backdrop */
        <div
            className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* header */}
                <div className="flex items-start justify-between p-4 border-b dark:border-gray-700 gap-3">
                    <div className="flex gap-3 min-w-0">
                        {photo && photo.images[0] && (
                            <CoverImage
                                coverUrl={photo.images[0].url}
                                scrambleId={photo.scrambleId}
                                albumId={albumId}
                                className="w-16 h-22 rounded shrink-0"
                            />
                        )}
                        <div className="min-w-0">
                            <div className="font-semibold text-sm leading-snug break-words">
                                {album?.name ?? `#${albumId}`}
                            </div>
                        <div className="text-xs text-gray-400 mt-1">#{albumId}</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 shrink-0 mt-0.5">
                        <X size={18} />
                    </button>
                </div>

                {/* body */}
                <div className="overflow-y-auto flex-1 p-4 text-sm space-y-3">
                    {!cachedData ? (
                        <div className="text-gray-400 text-center py-8">加载中...</div>
                    ) : cachedData.error ? (
                        <div className="text-red-500 text-center py-8">{cachedData.error}</div>
                    ) : (
                        <>
                            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                                <span>浏览 {album!.totalViews}</span>
                                <span>点赞 {album!.likes}</span>
                                <span>{photo!.images.length} 页</span>
                            </div>

                            {album!.author.length > 0 && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">作者</div>
                                    <div className="flex flex-wrap gap-1">
                                        {album!.author.map(a => (
                                            <span key={a} className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded text-xs">{a}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {album!.tags.length > 0 && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">标签</div>
                                    <div className="flex flex-wrap gap-1">
                                        {album!.tags.map(t => (
                                            <span key={t} className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded text-xs">{t}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {album!.works.length > 0 && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">作品</div>
                                    <div className="flex flex-wrap gap-1">
                                        {album!.works.map(w => (
                                            <span key={w} className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-xs">{w}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {album!.actors.length > 0 && (
                                <div>
                                    <div className="text-xs text-gray-400 mb-1">角色</div>
                                    <div className="flex flex-wrap gap-1">
                                        {album!.actors.map(a => (
                                            <span key={a} className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-xs">{a}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {album!.series && album!.series.length > 0 ? (
                                <div className="space-y-2">
                                    <div className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 p-2 rounded">
                                        此为合集，暂不支持批量下载全部章节
                                    </div>
                                    {(() => {
                                        const first = album!.series[0];
                                        return first ? (
                                            <DownloadButtons id={first.id} name={`${album!.name} - ${first.name}`} />
                                        ) : null;
                                    })()}
                                </div>
                            ) : (
                                <DownloadButtons id={albumId} name={album!.name} />
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Search result card ──────────────────────────────────────────────────────

function AlbumCard({ item, cachedData, onClick }: {
    item: { id: string; name: string; author: string };
    cachedData: BatchAlbumItem | undefined;
    onClick: () => void;
}) {
    const photo = cachedData?.photo ?? null;

    return (
        <div
            className="border dark:border-gray-700 rounded-lg overflow-hidden cursor-pointer hover:shadow-md transition-shadow bg-white dark:bg-gray-900 flex flex-col"
            onClick={onClick}
        >
            {/* cover */}
            <div className="w-full aspect-[3/4] bg-gray-100 shrink-0">
                {photo?.images[0] ? (
                    <CoverImage
                        coverUrl={photo.images[0].url}
                        scrambleId={photo.scrambleId}
                        albumId={item.id}
                        className="w-full h-full"
                    />
                ) : (
                    <div className="w-full h-full bg-gray-100 dark:bg-gray-800 animate-pulse" />
                )}
            </div>
            {/* info */}
            <div className="p-2 flex flex-col gap-0.5 flex-1 min-w-0">
                <div className="text-xs font-medium leading-snug line-clamp-2 break-words" title={item.name}>
                    {item.name}
                </div>
                <div className="text-xs text-gray-400 truncate">{item.author}</div>
                <div className="text-xs text-gray-300 dark:text-gray-600">#{item.id}</div>
            </div>
        </div>
    );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function Home() {
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
    const [tasks, setTasks] = useState<DownloadTask[]>([]);
    const [showTaskPanel, setShowTaskPanel] = useState(false);
    const [modalAlbumId, setModalAlbumId] = useState<string | null>(null);
    const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
        const stored = localStorage.getItem("theme");
        if (stored === "light" || stored === "dark") return stored;
        return "system";
    });
    const listRef = useRef<HTMLDivElement>(null);

    // ── dark mode ────────────────────────────────────────────────────────────
    const applyTheme = useCallback((t: 'light' | 'dark' | 'system') => {
        const isDark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', isDark);
    }, []);

    const cycleTheme = useCallback(() => {
        setTheme(prev => {
            const next = prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light';
            if (next === 'system') {
                localStorage.removeItem("theme");
            } else {
                localStorage.setItem("theme", next);
            }
            applyTheme(next);
            return next;
        });
    }, [applyTheme]);

    useEffect(() => {
        if (theme !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => applyTheme('system');
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [theme, applyTheme]);

    // ── task management ──────────────────────────────────────────────────────
    const addTask = useCallback((task: Omit<DownloadTask, 'id'>) => {
        const newTask: DownloadTask = { ...task, id: `${Date.now()}_${Math.random()}` };
        setTasks(prev => [...prev, newTask]);
        setShowTaskPanel(true);
        return newTask.id;
    }, []);
    const updateTask = useCallback((id: string, updates: Partial<DownloadTask>) =>
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t)), []);
    const removeTask = useCallback((id: string) =>
        setTasks(prev => prev.filter(t => t.id !== id)), []);
    const clearCompleted = useCallback(() =>
        setTasks(prev => prev.filter(t => t.stage !== 'completed' && t.stage !== 'error')), []);

    const taskContextValue = { tasks, addTask, updateTask, removeTask, clearCompleted };

    // ── search query — driven by URL params ──────────────────────────────────
    const { data, isFetching } = useQuery<SearchResult>({
        queryKey: ["search", urlQuery, urlPage, urlCategory, urlOrderBy, urlTime],
        queryFn: () => search(urlQuery, {
            mainTag: parseInt(urlCategory) as 1 | 2 | 3 | 4,
            page: urlPage,
            orderBy: urlOrderBy,
            time: urlTime,
        }),
        enabled: !!urlQuery,
        staleTime: 0,
        gcTime: 0,
        placeholderData: keepPreviousData,
    });

    // ── in-memory album cache (survives page changes within same session) ────
    const [albumCache, setAlbumCache] = useState<Map<string, BatchAlbumItem>>(new Map());

    useEffect(() => {
        if (!data || !('content' in data) || data.content.length === 0) return;

        const ids = data.content.map(item => item.id);
        const CHUNK = 20;
        let cancelled = false;

        (async () => {
            for (let i = 0; i < ids.length; i += CHUNK) {
                if (cancelled) break;
                const chunk = ids.slice(i, i + CHUNK);
                try {
                    const results = await getBatchAlbum(chunk);
                    if (cancelled) break;
                    setAlbumCache(prev => {
                        const next = new Map(prev);
                        for (const item of results) next.set(item.albumId, item);
                        return next;
                    });
                } catch (e) {
                    console.error('批量获取失败:', e);
                }
            }
        })();

        return () => { cancelled = true; };
    }, [data]);

    // ── pagination ───────────────────────────────────────────────────────────
    const totalCount = data?.total ? parseInt(data.total) : 0;
    const itemsPerPage = 20;
    const totalPages = Math.ceil(totalCount / itemsPerPage);
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
        setModalAlbumId(null);
        pushSearch(query, category, orderBy, timeFilter, 1);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) { setQueryError("请填写搜索内容"); return; }
        performSearch();
    };

    const handlePageChange = (newPage: number) => {
        setModalAlbumId(null);
        pushSearch(urlQuery, urlCategory, urlOrderBy, urlTime, newPage);
        listRef.current?.scrollTo({ top: 0 });
    };

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
                        <InputGroup className="h-12 w-full" isInvalid={!!queryError}>
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
                                    isDisabled={isFetching}
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
                                className="flex-1 min-w-0 [&:-webkit-autofill]:h-full [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_white] dark:[&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_#030712]"
                                disabled={isFetching}
                            />
                            <InputGroup.Suffix className="p-0 flex-shrink-0">
                                <Button
                                    type="submit"
                                    className="rounded-none px-4 flex-shrink-0"
                                    style={{ height: '48px' }}
                                    variant="primary"
                                    isDisabled={isFetching}
                                >
                                    <SearchIcon size={18} />
                                </Button>
                            </InputGroup.Suffix>
                        </InputGroup>
                        {queryError && <FieldError className="mt-1 ml-1">{queryError}</FieldError>}

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
                                isDisabled={isFetching}
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
                                isDisabled={isFetching}
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

                            {/* dark mode toggle */}
                            <button
                                type="button"
                                onClick={cycleTheme}
                                className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                title={theme === 'light' ? '浅色模式' : theme === 'dark' ? '深色模式' : '跟随系统'}
                            >
                                {theme === 'light' && <Sun size={18} />}
                                {theme === 'dark' && <Moon size={18} />}
                                {theme === 'system' && <Monitor size={18} />}
                            </button>
                        </div>
                    </form>

                    {/* ── direct match ── */}
                    {redirectAid && (
                        <div className="shrink-0 mb-3 border dark:border-gray-700 rounded-lg bg-blue-50 dark:bg-blue-900/30 overflow-hidden">
                            <div className="p-2 bg-blue-100 dark:bg-blue-900/40 text-sm font-medium text-blue-800 dark:text-blue-200">搜索到直接匹配的本子</div>
                            <div
                                className="p-3 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20"
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
                        <div
                            ref={listRef}
                            className={`flex-1 overflow-y-auto min-h-0 mb-3 relative ${isFetching ? 'pointer-events-none' : ''}`}
                        >
                            {isFetching && (
                                <div className="absolute inset-0 bg-white/70 dark:bg-gray-900/70 flex items-start justify-center pt-20 z-10">
                                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                                        <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                                        <span className="text-sm">加载中...</span>
                                    </div>
                                </div>
                            )}
                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                                {data.content.map(item => (
                                    <AlbumCard
                                        key={item.id}
                                        item={item}
                                        cachedData={albumCache.get(item.id)}
                                        onClick={() => setModalAlbumId(item.id)}
                                    />
                                ))}
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
                                    isDisabled={urlPage === 1 || isFetching} onPress={() => handlePageChange(1)}>首页</Button>
                                <Button variant="secondary" size="sm" className="px-2 text-xs"
                                    isDisabled={!hasPrevPage || isFetching} onPress={() => handlePageChange(urlPage - 1)}>上页</Button>
                                <Button variant="secondary" size="sm" className="px-2 text-xs"
                                    isDisabled={!hasNextPage || isFetching} onPress={() => handlePageChange(urlPage + 1)}>下页</Button>
                                <Button variant="secondary" size="sm" className="px-2 text-xs"
                                    isDisabled={urlPage === totalPages || isFetching} onPress={() => handlePageChange(totalPages)}>尾页</Button>
                            </div>
                            <div className="text-center text-gray-500 dark:text-gray-400 text-xs">{totalCount}条·{urlPage}/{totalPages}页</div>
                        </div>
                    )}
                </div>
            </div>
        </TaskContext.Provider>
    );
}
