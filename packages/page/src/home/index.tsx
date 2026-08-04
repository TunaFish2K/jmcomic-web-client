import { useState, useRef, createContext, useContext, useCallback, useEffect, useMemo } from "react";
import { Button, InputGroup, Select, ListBox, FieldError } from "@heroui/react";
import { SearchIcon, ChevronDown, ChevronUp, X, Download, FileArchive, FileText, BookOpen, RefreshCw } from "lucide-react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { search, getPhoto, getBatchAlbum, getBatchPhoto } from "../api";
import type { BatchAlbumItem, BatchError } from "../api";
import type { SearchResult, PhotoWithScrambleId } from "@tiny-client/shared";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
    exportPhotosToTemporaryFile,
    getSliceCount,
    getSearchResultIds,
    SEARCH_PAGE_SIZE,
    reverseImageBySlice,
    startTemporaryDownload,
    type ExportProgress,
} from "@tiny-client/shared";
import pLimit from "p-limit";
import { saveAlbumMeta, getLatestChapterProgress } from "../reader/reader-store";
import { getCachedAlbum, getCachedAlbums, setCachedAlbum, setCachedAlbums } from "../album-cache";
import { ThemePopover } from "../theme/ThemeControls";

// Global concurrency limiter for cover image fetches (shared across all CoverImage instances)
const coverLimit = pLimit(6);

// Global concurrency limiter for download tasks (shared across all active downloads)
const downloadLimit = pLimit(1);

const BATCH_PHOTO_CHUNK_SIZE = 20;
const BATCH_PHOTO_RETRY_DELAYS_MS = [1000, 2500];

type SettledSearch = {
    sessionKey: string;
    page: number;
    data: SearchResult;
    ids: string[];
};

type SuccessfulBatchAlbumItem = Extract<
    BatchAlbumItem,
    { album: NonNullable<BatchAlbumItem['album']> }
>;

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
        setObjectUrl(null);
        setFailed(false);
        coverLimit(async () => {
            const RETRY_DELAYS = [400, 1000, 2000];
            for (let attempt = 0; attempt <= RETRY_DELAYS.length && !cancelled; attempt++) {
                try {
                    const res = await fetch(coverUrl);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const buffer = await res.arrayBuffer();
                    const filename = coverUrl.split('/').pop() ?? '';
                    const slices = getSliceCount(scrambleId, parseInt(albumId), filename);
                    const { data } = slices > 0
                        ? await reverseImageBySlice(buffer, slices)
                        : { data: buffer };
                    const blob = new Blob([data], { type: 'image/jpeg' });
                    created = URL.createObjectURL(blob);
                    if (!cancelled) {
                        setObjectUrl(created);
                        setFailed(false);
                    }
                    return;
                } catch {
                    if (cancelled) return;
                    if (attempt === RETRY_DELAYS.length) {
                        setFailed(true);
                        return;
                    }
                    await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
                }
            }
        });
        return () => {
            cancelled = true;
            if (created) URL.revokeObjectURL(created);
        };
    }, [coverUrl, scrambleId, albumId]);

    if (!objectUrl || failed) return (
        <div className={`bg-gray-100 dark:bg-gray-800 animate-pulse ${className ?? ''}`} />
    );
    return (
        <img
            src={objectUrl}
            alt=""
            className={`object-cover ${className ?? ''}`}
            onError={() => setFailed(true)}
        />
    );
}

// ─── Download task types & context ──────────────────────────────────────────

type DownloadTask = {
    id: string;
    albumId: string;
    name: string;
    format: 'pdf' | 'zip' | 'cbz';
    stage: 'processing' | 'finalizing' | 'completed' | 'error';
    progress: number;
    total: number;
    error?: string;
};

type DownloadFormat = DownloadTask['format'];

type DownloadTarget = {
    id: string;
    name: string;
    order: number;
};

type BatchMode = 'individual' | 'combined';

type DownloadTaskHandle = { id: string; signal: AbortSignal };

function sanitizeFilename(name: string) {
    return name.replace(/[<>:"/\\|?*]/g, '_');
}

function parseSeriesOrder(value: string | number | undefined) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function formatBatchError(error: BatchError) {
    const details = [
        error.stage !== 'unknown' ? `阶段: ${error.stage}` : null,
        error.domain ? `域名: ${error.domain}` : null,
        error.reference ? `引用: ${error.reference}` : null,
    ].filter(Boolean).join(' | ');

    return details ? `${error.message} (${details})` : error.message;
}

function throwIfDownloadAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function waitForRetry(delay: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        throwIfDownloadAborted(signal);
        const timer = window.setTimeout(resolve, delay);
        signal?.addEventListener('abort', () => {
            window.clearTimeout(timer);
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });
}

async function getPhotosInChunks(
    targets: DownloadTarget[],
    chunkSize: number = BATCH_PHOTO_CHUNK_SIZE,
    signal?: AbortSignal,
) {
    const photoMap = new Map<string, PhotoWithScrambleId>();
    let pendingTargets = [...targets];

    for (let attempt = 0; attempt <= BATCH_PHOTO_RETRY_DELAYS_MS.length && pendingTargets.length > 0; attempt++) {
        throwIfDownloadAborted(signal);
        const chunks: DownloadTarget[][] = [];
        for (let i = 0; i < pendingTargets.length; i += chunkSize) {
            chunks.push(pendingTargets.slice(i, i + chunkSize));
        }

        const failedIds = new Set<string>();
        for (const chunk of chunks) {
            throwIfDownloadAborted(signal);
            const batch = await getBatchPhoto(chunk.map((target) => target.id), signal);
            throwIfDownloadAborted(signal);
            for (const item of batch) {
                if (item.photo) photoMap.set(item.photoId, item.photo);
                else failedIds.add(item.photoId);
            }
        }

        pendingTargets = pendingTargets.filter((target) => !photoMap.has(target.id));
        if (pendingTargets.length === 0) break;
        if (attempt === BATCH_PHOTO_RETRY_DELAYS_MS.length) break;

        // Only retry chapters that still failed in this round.
        pendingTargets = pendingTargets.filter((target) => failedIds.has(target.id));
        await waitForRetry(BATCH_PHOTO_RETRY_DELAYS_MS[attempt], signal);
    }

    return targets.map((target) => {
        const photo = photoMap.get(target.id);
        if (!photo) {
            throw new Error(`无法获取章节 ${target.name} 的图片数据`);
        }
        return {
            name: target.name,
            photo,
        };
    });
}

async function buildSingleDownload(
    target: DownloadTarget,
    format: DownloadFormat,
    updateTask: (updates: Partial<DownloadTask>) => void,
    signal: AbortSignal,
) {
    const photo = await getPhoto(target.id, signal);
    throwIfDownloadAborted(signal);
    if (!photo) throw new Error('无法获取图片数据');

    const safeName = sanitizeFilename(target.name);
    const totalImages = photo.images.length;
    const filename = `${safeName}.${format}`;
    updateTask({ total: totalImages, progress: 0, stage: 'processing' });
    const temporary = await exportPhotosToTemporaryFile({
        filename,
        format,
        photos: [{ name: target.name, photo }],
    }, (progress: ExportProgress) => updateTask({
        progress: progress.completed,
        total: progress.total,
        stage: progress.stage,
    }), signal);
    throwIfDownloadAborted(signal);
    startTemporaryDownload(filename, temporary);
}

async function buildCombinedDownload(
    targets: DownloadTarget[],
    format: DownloadFormat,
    archiveName: string,
    updateTask: (updates: Partial<DownloadTask>) => void,
    signal: AbortSignal,
) {
    const photos = await getPhotosInChunks(targets, BATCH_PHOTO_CHUNK_SIZE, signal);
    throwIfDownloadAborted(signal);

    const totalImages = photos.reduce((sum, item) => sum + item.photo.images.length, 0);
    const safeName = sanitizeFilename(archiveName);
    const filename = `${safeName}.${format}`;
    updateTask({ total: totalImages, progress: 0, stage: 'processing' });
    const temporary = await exportPhotosToTemporaryFile({
        filename,
        format,
        photos,
        archiveLayout: format === 'cbz' ? 'flat' : 'folders',
    }, (progress: ExportProgress) => updateTask({
        progress: progress.completed,
        total: progress.total,
        stage: progress.stage,
    }), signal);
    throwIfDownloadAborted(signal);
    startTemporaryDownload(filename, temporary);
}

type TaskContextType = {
    tasks: DownloadTask[];
    addTask: (task: Omit<DownloadTask, 'id'>) => DownloadTaskHandle;
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
        ({ processing: '处理图片', finalizing: '写入文件', completed: '完成', error: '错误' })[s];
    const stageColor = (s: DownloadTask['stage']) =>
        ({ processing: 'bg-brand-500', finalizing: 'bg-yellow-500', completed: 'bg-green-500', error: 'bg-red-500' })[s];

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
                                    {task.error && (
                                        <div className="mt-1 line-clamp-2 text-xs text-red-600 dark:text-red-400" title={task.error}>
                                            {task.error}
                                        </div>
                                    )}
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

const previewActionButtonClass = "text-xs flex-1 border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 data-[hovered=true]:bg-brand-100 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-300 dark:hover:bg-brand-900/40 dark:data-[hovered=true]:bg-brand-900/40";
const previewFullActionButtonClass = "text-xs w-full mt-2 border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 data-[hovered=true]:bg-brand-100 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-300 dark:hover:bg-brand-900/40 dark:data-[hovered=true]:bg-brand-900/40";

function DownloadButtons({ items, label }: {
    items: DownloadTarget[];
    label?: string;
}) {
    const { tasks, addTask, updateTask } = useTasks();
    const isBatch = items.length > 1;
    const orderedItems = [...items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

    const queueDownload = (target: DownloadTarget, format: DownloadFormat) => {
        const existingTask = tasks.find((t) =>
            t.albumId === target.id && t.format === format && t.stage !== 'completed' && t.stage !== 'error'
        );
        if (existingTask) return;

        const { id: taskId, signal } = addTask({
            albumId: target.id,
            name: target.name,
            format,
            stage: 'processing',
            progress: 0,
            total: 1,
        });

        downloadLimit(async () => {
            try {
                throwIfDownloadAborted(signal);
                await buildSingleDownload(target, format, (updates) => updateTask(taskId, updates), signal);
            } catch (error) {
                if (!signal.aborted) {
                    console.error('下载失败:', error);
                    updateTask(taskId, { stage: 'error', error: (error as Error).message, progress: 0, total: 1 });
                }
            }
        });
    };

    const handleDownload = (format: DownloadFormat) => {
        for (const item of orderedItems) {
            queueDownload(item, format);
        }
    };

    return (
        <div className="mt-3 space-y-2">
            <div className="text-gray-500 dark:text-gray-400 text-xs">{label ?? '下载格式:'}</div>
            <div className="flex gap-2">
                <Button size="sm" variant="secondary" className={previewActionButtonClass} onPress={() => handleDownload('pdf')}>
                    <FileText size={14} className="mr-1" />{isBatch ? '全部 PDF' : 'PDF'}
                </Button>
                <Button size="sm" variant="secondary" className={previewActionButtonClass} onPress={() => handleDownload('zip')}>
                    <FileArchive size={14} className="mr-1" />{isBatch ? '全部 ZIP' : 'ZIP'}
                </Button>
                <Button size="sm" variant="secondary" className={previewActionButtonClass} onPress={() => handleDownload('cbz')}>
                    <Download size={14} className="mr-1" />{isBatch ? '全部 CBZ' : 'CBZ'}
                </Button>
            </div>
        </div>
    );
}

function SeriesDownloadManager({ albumName, items }: {
    albumName: string;
    items: DownloadTarget[];
}) {
    const { tasks, addTask, updateTask } = useTasks();
    const [rangeStart, setRangeStart] = useState('1');
    const [rangeEnd, setRangeEnd] = useState(String(items.length));
    const [batchMode, setBatchMode] = useState<BatchMode>('individual');
    const [rangeError, setRangeError] = useState<string | null>(null);
    const orderedItems = [...items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

    const quickSelectRange = useCallback((start: number, end: number) => {
        setRangeStart(String(start));
        setRangeEnd(String(end));
        setRangeError(null);
    }, []);

    const selectedItems = (() => {
        const start = parseInt(rangeStart, 10);
        const end = parseInt(rangeEnd, 10);
        if (!Number.isInteger(start) || !Number.isInteger(end)) return [];
        if (start < 1 || end < 1 || start > end || end > orderedItems.length) return [];
        return orderedItems.slice(start - 1, end);
    })();

    const handleBatchDownload = (format: DownloadFormat) => {
        const start = parseInt(rangeStart, 10);
        const end = parseInt(rangeEnd, 10);

        if (!Number.isInteger(start) || !Number.isInteger(end)) {
            setRangeError('请输入有效的数字范围');
            return;
        }
        if (start < 1 || end < 1 || start > end || end > orderedItems.length) {
            setRangeError(`范围需在 1-${orderedItems.length} 之间，且起始不能大于结束`);
            return;
        }

        setRangeError(null);

        if (batchMode === 'individual') {
            const queuedItems = selectedItems.filter((item) => !tasks.find((t) =>
                t.albumId === item.id && t.format === format && t.stage !== 'completed' && t.stage !== 'error'
            ));
            if (queuedItems.length === 0) return;

            for (const item of queuedItems) {
                const existingTask = tasks.find((t) =>
                    t.albumId === item.id && t.format === format && t.stage !== 'completed' && t.stage !== 'error'
                );
                if (existingTask) continue;

                const { id: taskId, signal } = addTask({
                    albumId: item.id,
                    name: item.name,
                    format,
                    stage: 'processing',
                    progress: 0,
                    total: 1,
                });

                downloadLimit(async () => {
                    try {
                        throwIfDownloadAborted(signal);
                        await buildSingleDownload(item, format, (updates) => updateTask(taskId, updates), signal);
                    } catch (error) {
                        if (!signal.aborted) {
                            console.error('下载失败:', error);
                            updateTask(taskId, { stage: 'error', error: (error as Error).message, progress: 0, total: 1 });
                        }
                    }
                });
            }
            return;
        }

        const combinedTaskName = `${albumName} [${start}-${end}]`;
        const combinedTaskId = `combined:${selectedItems.map((item) => item.id).join(',')}`;
        const existingCombinedTask = tasks.find((t) =>
            t.albumId === combinedTaskId && t.format === format && t.stage !== 'completed' && t.stage !== 'error'
        );
        if (existingCombinedTask) return;

        const { id: taskId, signal } = addTask({
            albumId: combinedTaskId,
            name: combinedTaskName,
            format,
            stage: 'processing',
            progress: 0,
            total: 1,
        });

        downloadLimit(async () => {
            try {
                throwIfDownloadAborted(signal);
                await buildCombinedDownload(
                    selectedItems,
                    format,
                    combinedTaskName,
                    (updates) => updateTask(taskId, updates),
                    signal,
                );
            } catch (error) {
                if (!signal.aborted) {
                    console.error('合集下载失败:', error);
                    updateTask(taskId, { stage: 'error', error: (error as Error).message, progress: 0, total: 1 });
                }
            }
        });
    };

    return (
        <div className="space-y-3 rounded-lg border border-brand-200 dark:border-brand-900/60 bg-brand-50/70 dark:bg-brand-950/20 p-3">
            <div className="text-xs text-brand-700 dark:text-brand-200">
                可选范围下载。支持逐话分别导出，也支持把所选章节整合为一个文件。
            </div>
            <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400">
                    起始话数
                    <input
                        type="number"
                        min={1}
                        max={orderedItems.length}
                        value={rangeStart}
                        onChange={(e) => setRangeStart(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                    />
                </label>
                <label className="text-xs text-gray-500 dark:text-gray-400">
                    结束话数
                    <input
                        type="number"
                        min={1}
                        max={orderedItems.length}
                        value={rangeEnd}
                        onChange={(e) => setRangeEnd(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                    />
                </label>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" className="text-xs" onPress={() => quickSelectRange(1, orderedItems.length)}>
                    全部
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    className="text-xs"
                    onPress={() => quickSelectRange(1, Math.min(10, orderedItems.length))}
                >
                    前 10 话
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    className="text-xs"
                    onPress={() => quickSelectRange(Math.max(1, orderedItems.length - 9), orderedItems.length)}
                >
                    后 10 话
                </Button>
            </div>
            <div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">下载方式</div>
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        variant={batchMode === 'individual' ? 'primary' : 'secondary'}
                        className="text-xs flex-1"
                        onPress={() => setBatchMode('individual')}
                    >
                        多个文件
                    </Button>
                    <Button
                        size="sm"
                        variant={batchMode === 'combined' ? 'primary' : 'secondary'}
                        className="text-xs flex-1"
                        onPress={() => setBatchMode('combined')}
                    >
                        合并为一个
                    </Button>
                </div>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
                共 {orderedItems.length} 话，当前选择 {selectedItems.length} 话
            </div>
            {rangeError && (
                <div className="text-xs text-red-500">{rangeError}</div>
            )}
            <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="text-xs flex-1" isDisabled={selectedItems.length === 0} onPress={() => { void handleBatchDownload('pdf'); }}>
                    <FileText size={14} className="mr-1" />PDF
                </Button>
                <Button size="sm" variant="secondary" className="text-xs flex-1" isDisabled={selectedItems.length === 0} onPress={() => { void handleBatchDownload('zip'); }}>
                    <FileArchive size={14} className="mr-1" />ZIP
                </Button>
                <Button size="sm" variant="secondary" className="text-xs flex-1" isDisabled={selectedItems.length === 0} onPress={() => { void handleBatchDownload('cbz'); }}>
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
    const navigate = useNavigate();
    const detailQuery = useQuery<BatchAlbumItem>({
        queryKey: ['album-detail', albumId],
        queryFn: async () => {
            const persisted = await getCachedAlbum(albumId);
            if (persisted) {
                return { albumId, album: persisted.album, photo: persisted.photo };
            }

            const detail = (await getBatchAlbum([albumId])).find((item) => item.albumId === albumId);
            if (!detail) throw new Error('详情接口未返回该本子');
            if (!detail.error) {
                await setCachedAlbum(detail.albumId, detail.album, detail.photo);
            }
            return detail;
        },
        initialData: cachedData && !cachedData.error ? cachedData : undefined,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
    const detailData = detailQuery.data;
    const album = detailData?.album ?? null;
    const photo = detailData?.photo ?? null;
    const isSeriesAlbum = !!album?.series?.length;
    const sortedSeries = useMemo(
        () => isSeriesAlbum
            ? [...album!.series].sort((a, b) => parseSeriesOrder(a.sort) - parseSeriesOrder(b.sort))
            : [],
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [album],
    );
    const statsLabel = isSeriesAlbum
        ? `${sortedSeries.length} 话`
        : photo
            ? `${photo.images.length} 页`
            : '章节数据待加载';

    // Last-read chapter for the "继续阅读" entry button on series albums.
    const rootKey = album?.seriesID || albumId;
    const latest = useMemo(
        () => isSeriesAlbum ? getLatestChapterProgress(rootKey, sortedSeries.map((s) => s.id)) : null,
        [rootKey, sortedSeries, isSeriesAlbum],
    );
    const lastChapter = latest ? sortedSeries.find((s) => s.id === latest.chapterId) : null;
    const lastChapterIndex = lastChapter ? sortedSeries.indexOf(lastChapter) : -1;

    useEffect(() => {
        if (album) saveAlbumMeta(albumId, album);
    }, [album, albumId]);

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
                    {!detailData && detailQuery.isPending ? (
                        <div className="text-gray-400 text-center py-8">加载中...</div>
                    ) : detailData?.error || detailQuery.isError ? (
                        <div className="flex flex-col items-center gap-3 py-8 text-center text-red-500">
                            <span>
                                {detailData?.error
                                    ? formatBatchError(detailData.error)
                                    : detailQuery.error instanceof Error
                                        ? detailQuery.error.message
                                        : '详情加载失败'}
                            </span>
                            <Button
                                size="sm"
                                variant="secondary"
                                onPress={() => { void detailQuery.refetch(); }}
                            >
                                <RefreshCw size={14} className="mr-1" />重试
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                                <span>浏览 {album!.totalViews}</span>
                                <span>点赞 {album!.likes}</span>
                                <span>{statsLabel}</span>
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

                            {isSeriesAlbum ? (
                                <div className="space-y-3">
                                    {latest && lastChapter && (
                                        <Button
                                            size="sm"
                                            className="w-full justify-start bg-brand-500 text-brand-foreground hover:bg-brand-600"
                                            onPress={() => navigate(`/reader/${latest.chapterId}`, { state: { isSeries: true, album, seriesItems: sortedSeries.map((s, i) => ({ id: s.id, name: s.name || `第${i + 1}章`, order: parseSeriesOrder(s.sort) })) } })}
                                        >
                                            <BookOpen size={14} className="mr-1 shrink-0" />
                                            <span className="truncate">继续阅读：{lastChapterIndex >= 0 && !lastChapter.name ? `第${lastChapterIndex + 1}章` : lastChapter.name} · 第 {latest.page + 1} 页</span>
                                        </Button>
                                    )}
                                    <SeriesDownloadManager
                                        key={`${albumId}:${sortedSeries.length}`}
                                        albumName={album!.name}
                                        items={sortedSeries
                                            .map((seriesItem) => ({
                                                id: seriesItem.id,
                                                name: `${album!.name} - ${seriesItem.name}`,
                                                order: parseSeriesOrder(seriesItem.sort),
                                            }))}
                                    />
                                    <div>
                                        <div className="text-xs text-gray-400 mb-2">章节</div>
                                        <div className="space-y-3">
                                            {sortedSeries.map((seriesItem) => (
                                                <div
                                                    key={seriesItem.id}
                                                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-sm font-medium leading-snug break-words">
                                                                {seriesItem.name}
                                                            </div>
                                                            <div className="text-xs text-gray-400 mt-1">#{seriesItem.id}</div>
                                                        </div>
                                                        <div className="text-xs text-gray-400 shrink-0">
                                                            {seriesItem.sort ? `第 ${seriesItem.sort} 话` : '章节'}
                                                        </div>
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        className={previewFullActionButtonClass}
                                                        onPress={() => navigate(`/reader/${seriesItem.id}`, { state: { isSeries: true, album, seriesItems: sortedSeries.map((s) => ({ id: s.id, name: `${album!.name} - ${s.name}`, order: parseSeriesOrder(s.sort) })) } })}
                                                    >
                                                        <BookOpen size={14} className="mr-1" />在线观看
                                                    </Button>
                                                    <DownloadButtons
                                                        items={[{
                                                            id: seriesItem.id,
                                                            name: `${album!.name} - ${seriesItem.name}`,
                                                            order: parseSeriesOrder(seriesItem.sort),
                                                        }]}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <Button
                                        size="sm"
                                        variant="secondary"
                                        className={previewFullActionButtonClass}
                                        onPress={() => navigate(`/reader/${albumId}`, { state: { album, photo } })}
                                    >
                                        <BookOpen size={14} className="mr-1" />在线观看
                                    </Button>
                                    <DownloadButtons items={[{ id: albumId, name: album!.name, order: 1 }]} />
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Search result card ──────────────────────────────────────────────────────

function AlbumCard({ item, cachedData, onClick, cardRef }: {
    item: { id: string; name: string; author: string };
    cachedData: BatchAlbumItem | undefined;
    onClick: () => void;
    cardRef?: (el: HTMLDivElement | null) => void;
}) {
    const photo = cachedData?.photo ?? null;

    return (
        <div
            ref={cardRef}
            data-album-id={item.id}
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
    const taskControllersRef = useRef(new Map<string, AbortController>());
    const listRef = useRef<HTMLDivElement>(null);
    const lastSettledSearchRef = useRef<SettledSearch | null>(null);
    const displayedResultKeyRef = useRef<string | null>(null);

    // ── task management ──────────────────────────────────────────────────────
    const addTask = useCallback((task: Omit<DownloadTask, 'id'>) => {
        const newTask: DownloadTask = { ...task, id: `${Date.now()}_${Math.random()}` };
        const controller = new AbortController();
        taskControllersRef.current.set(newTask.id, controller);
        setTasks(prev => [...prev, newTask]);
        setShowTaskPanel(true);
        return { id: newTask.id, signal: controller.signal };
    }, []);
    const updateTask = useCallback((id: string, updates: Partial<DownloadTask>) => {
        if (updates.stage === 'completed' || updates.stage === 'error') {
            taskControllersRef.current.delete(id);
        }
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    }, []);
    const removeTask = useCallback((id: string) => {
        taskControllersRef.current.get(id)?.abort();
        taskControllersRef.current.delete(id);
        setTasks(prev => prev.filter(t => t.id !== id));
    }, []);
    const clearCompleted = useCallback(() =>
        setTasks(prev => prev.filter(t => t.stage !== 'completed' && t.stage !== 'error')), []);

    useEffect(() => () => {
        for (const controller of taskControllersRef.current.values()) controller.abort();
        taskControllersRef.current.clear();
    }, []);

    const taskContextValue = { tasks, addTask, updateTask, removeTask, clearCompleted };

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
    const fallbackSearch = lastSettledSearchRef.current?.sessionKey === searchSessionKey
        ? lastSettledSearchRef.current
        : null;
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

    // ── in-memory album cache (survives page changes within same session) ────
    const [albumCache, setAlbumCache] = useState<Map<string, BatchAlbumItem>>(new Map());
    // Keep a ref so the batch effect always reads the latest cache without re-running
    const albumCacheRef = useRef<Map<string, BatchAlbumItem>>(albumCache);
    useEffect(() => { albumCacheRef.current = albumCache; }, [albumCache]);

    // Track which album IDs are currently visible in the viewport
    const visibleIdsRef = useRef<Set<string>>(new Set());
    // Ref to the card elements for IntersectionObserver
    const cardRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());

    // Register / unregister a card element
    const getCardRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
        if (el) cardRefsMap.current.set(id, el);
        else cardRefsMap.current.delete(id);
    }, []);

    // Observe card visibility whenever `data` changes (new search results)
    useEffect(() => {
        if (!data || !('content' in data) || data.content.length === 0) return;
        const visibleIds = visibleIdsRef.current;

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    const id = (entry.target as HTMLElement).dataset.albumId;
                    if (!id) continue;
                    if (entry.isIntersecting) visibleIds.add(id);
                    else visibleIds.delete(id);
                }
            },
            { threshold: 0.1 },
        );

        // Observe all current cards (give DOM a tick to render)
        const tid = setTimeout(() => {
            for (const el of cardRefsMap.current.values()) observer.observe(el);
        }, 0);

        return () => {
            clearTimeout(tid);
            observer.disconnect();
            visibleIds.clear();
        };
    }, [data]);

    // Stable key: content IDs + redirect_aid for the current result set.
    // Using this instead of `data` avoids re-running when TanStack Query
    // returns a new object reference for an identical result (e.g. background refetch).
    const resultIdsKey = data && 'content' in data
        ? [
            ...data.content.map(i => i.id),
            ...('redirect_aid' in data && data.redirect_aid ? [data.redirect_aid] : []),
          ].join(',')
        : '';

    // Evict stale entries when the result set changes (page nav, new search)
    // to prevent unbounded memory growth across many page turns.
    useEffect(() => {
        if (!resultIdsKey) return;
        const currentIds = new Set(resultIdsKey.split(',').filter(Boolean));
        setAlbumCache(prev => {
            let changed = false;
            const next = new Map(prev);
            for (const id of prev.keys()) {
                if (!currentIds.has(id)) { next.delete(id); changed = true; }
            }
            return changed ? next : prev;
        });
    }, [resultIdsKey]);

    // Fetch batch album data — visible cards first, then the rest.
    // Keeps retrying any IDs that returned an error until all succeed or cancelled.
    useEffect(() => {
        if (!resultIdsKey) return;
        if (!data || !('content' in data)) return;

        let cancelled = false;
        const CHUNK = 15;    // Leave headroom: 2 fixed + 3 per ID, avoid sitting on the 50-request ceiling
        const CONCURRENCY = 2; // max simultaneous chunk requests
        const RETRY_DELAY = 1500; // ms before re-queuing failed IDs

        // Send one chunk; returns IDs that came back with an error field
        const fetchChunk = async (ids: string[]): Promise<string[]> => {
            try {
                const results = await getBatchAlbum(ids);
                if (cancelled) return [];
                setAlbumCache(prev => {
                    const next = new Map(prev);
                    for (const item of results) next.set(item.albumId, item);
                    return next;
                });
                const cachedItems = results.filter(
                    (result): result is SuccessfulBatchAlbumItem => result.album !== null,
                );
                if (cachedItems.length > 0) setCachedAlbums(cachedItems).catch(() => {});
                // IDs whose worker-side fetch failed get re-queued
                return results.filter(r => r.error).map(r => r.albumId);
            } catch {
                // Network / CF 520 — treat whole chunk as failed
                return ids;
            }
        };

        const run = async () => {
            // Give IntersectionObserver time to fire before we decide priority order
            await new Promise(r => setTimeout(r, 50));
            if (cancelled) return;

            // All IDs for this result: content + direct-match redirect
            const redirectAid = 'redirect_aid' in data && data.redirect_aid ? data.redirect_aid : null;
            const allIds = [
                ...data.content.map(item => item.id),
                ...(redirectAid ? [redirectAid] : []),
            ];

            // IDs still needing a successful fetch (not yet in cache, or errored)
            const pending = new Set(
                allIds.filter(id => {
                    const cached = albumCacheRef.current.get(id);
                    return !cached || !!cached.error;
                })
            );
            if (pending.size === 0) return;

            // Check IndexedDB cache for pending IDs (L2 cache)
            const cachedMap = await getCachedAlbums([...pending]);
            if (cachedMap.size > 0) {
                setAlbumCache(prev => {
                    const next = new Map(prev);
                    for (const [id, { album, photo }] of cachedMap) {
                        next.set(id, { albumId: id, album, photo: photo ?? null });
                    }
                    return next;
                });
                for (const id of cachedMap.keys()) pending.delete(id);
            }
            if (pending.size === 0) return;

            while (pending.size > 0 && !cancelled) {
                // Priority: visible first, then the rest
                const visible: string[] = [];
                const rest: string[] = [];
                for (const id of pending) {
                    if (visibleIdsRef.current.has(id)) visible.push(id);
                    else rest.push(id);
                }
                const ordered = [...visible, ...rest];

                // Split into chunks and dispatch up to CONCURRENCY at a time
                const chunks: string[][] = [];
                for (let i = 0; i < ordered.length; i += CHUNK) {
                    chunks.push(ordered.slice(i, i + CHUNK));
                }

                // Process chunks with limited concurrency
                const failed: string[] = [];
                for (let i = 0; i < chunks.length; i += CONCURRENCY) {
                    if (cancelled) break;
                    const batch = chunks.slice(i, i + CONCURRENCY);
                    const results = await Promise.all(batch.map(fetchChunk));
                    for (const ids of results) failed.push(...ids);
                }

                if (cancelled) break;

                // Update pending: remove successes, keep failures
                for (const id of ordered) pending.delete(id);
                for (const id of failed) pending.add(id);

                if (pending.size > 0) {
                    // Wait before retrying to avoid hammering CF on 520s
                    await new Promise(r => setTimeout(r, RETRY_DELAY));
                }
            }
        };

        run();
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resultIdsKey]);

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
                        <div className="flex h-12 w-full">
                            <InputGroup
                                className="relative z-0 h-12 min-w-0 flex-1 rounded-r-none focus-within:z-10 focus-within:ring-1 focus-within:ring-inset focus-within:ring-brand-500"
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
                                    className="flex-1 min-w-0 [&:-webkit-autofill]:h-full [&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_white] dark:[&:-webkit-autofill]:shadow-[inset_0_0_0_1000px_#030712]"
                                />
                            </InputGroup>
                            <Button
                                type="submit"
                                className="relative z-0 -ml-px h-12 min-w-12 flex-shrink-0 rounded-l-none px-4 bg-brand-500 text-brand-foreground hover:bg-brand-600 data-[hovered=true]:bg-brand-600 data-[pressed=true]:bg-brand-700 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
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
