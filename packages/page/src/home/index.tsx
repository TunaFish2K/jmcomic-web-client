import { useState, useRef, createContext, useContext, useCallback, useEffect } from "react";
import { Button, InputGroup, Select, ListBox, FieldError } from "@heroui/react";
import { SearchIcon, ChevronDown, ChevronUp, X, Download, FileArchive, FileText, Sun, Moon, Monitor } from "lucide-react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { search, getAlbum, getPhoto } from "../api";
import type { SearchResult, Album, PhotoWithScrambleId } from "@tiny-client/shared";
import {
    startDownload,
    downloadAllImages,
    downloadAndDecryptImagesOfPhotoThenWriteIntoZipFile,
} from "@tiny-client/shared";
import { PDFDocument } from "pdf-lib";

// 下载任务类型
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

// 任务上下文
type TaskContextType = {
    tasks: DownloadTask[];
    addTask: (task: Omit<DownloadTask, 'id'>) => string;
    updateTask: (id: string, updates: Partial<DownloadTask>) => void;
    removeTask: (id: string) => void;
    clearCompleted: () => void;
};

const TaskContext = createContext<TaskContextType | null>(null);

function useTasks() {
    const context = useContext(TaskContext);
    if (!context) throw new Error('useTasks must be used within TaskProvider');
    return context;
}

// 任务管理面板 - 右下角浮动
function TaskPanel({ onClose }: { onClose: () => void }) {
    const { tasks, removeTask, clearCompleted } = useTasks();
    const [expanded, setExpanded] = useState(true);

    const activeTasks = tasks.filter(t => t.stage !== 'completed' && t.stage !== 'error');
    const completedTasks = tasks.filter(t => t.stage === 'completed');

    const getStageText = (stage: DownloadTask['stage']) => {
        switch (stage) {
            case 'downloading': return '下载图片';
            case 'packaging': return '打包中';
            case 'completed': return '完成';
            case 'error': return '错误';
        }
    };

    const getStageColor = (stage: DownloadTask['stage']) => {
        switch (stage) {
            case 'downloading': return 'bg-blue-500';
            case 'packaging': return 'bg-yellow-500';
            case 'completed': return 'bg-green-500';
            case 'error': return 'bg-red-500';
        }
    };

    if (tasks.length === 0) return null;

    return (
        <div className="fixed bottom-20 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
            {/* 标题栏 */}
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50/80 dark:hover:bg-white/5 rounded-t-2xl"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">
                        下载 ({activeTasks.length}进行中)
                    </span>
                    {expanded ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronUp size={16} className="text-gray-400" />}
                </div>
                <div className="flex items-center gap-2">
                    {completedTasks.length > 0 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                clearCompleted();
                            }}
                            className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                            清除
                        </button>
                    )}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose();
                        }}
                        className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* 任务列表 */}
            {expanded && (
                <div className="max-h-48 overflow-y-auto border-t border-gray-100 dark:border-gray-800">
                    {tasks.map((task) => (
                        <div key={task.id} className="px-4 py-3 border-b border-gray-50 dark:border-gray-800/50 last:border-b-0">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex-1 min-w-0 mr-2">
                                    <div className="text-sm font-medium truncate" title={task.name}>
                                        {task.name}
                                    </div>
                                    <div className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5 mt-0.5">
                                        <span className="font-mono">{task.format.toUpperCase()}</span>
                                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${getStageColor(task.stage)}`} />
                                        <span>{getStageText(task.stage)}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => removeTask(task.id)}
                                    className="text-gray-300 dark:text-gray-600 hover:text-red-500 shrink-0"
                                >
                                    <X size={14} />
                                </button>
                            </div>

                            {/* 进度条 */}
                            <div className="relative h-1 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                <div
                                    className={`absolute top-0 left-0 h-full rounded-full ${getStageColor(task.stage)}`}
                                    style={{ width: `${task.total > 0 ? (task.progress / task.total) * 100 : 0}%` }}
                                />
                            </div>
                            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 text-right tabular-nums">
                                {task.progress}/{task.total}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// 下载按钮组件
function DownloadButtons({ id, name }: { id: string; name: string }) {
    const { tasks, addTask, updateTask } = useTasks();

    const handleDownload = async (format: 'pdf' | 'zip' | 'cbz') => {
        // 检查是否已有相同任务在进行中
        const existingTask = tasks.find(t =>
            t.albumId === id &&
            t.format === format &&
            t.stage !== 'completed' &&
            t.stage !== 'error'
        );
        if (existingTask) {
            return; // 已有相同任务在进行中
        }

        let taskId = '';

        try {
            // 先添加任务（获取 photo 前）
            taskId = addTask({
                albumId: id,
                name,
                format,
                stage: 'downloading',
                progress: 0,
                total: 1, // 临时，获取 photo 后更新
            });

            // 获取 photo 数据
            const photo = await getPhoto(id);
            if (!photo) {
                throw new Error('无法获取图片数据');
            }

            const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
            const totalImages = photo.images.length;
            // ZIP 流式处理：获取photo(1) + 图片处理(每张1进度)
            // PDF：获取photo(1) + 下载(每张1) + 打包(每张1) = 1 + totalImages * 2
            const totalProgress = format === 'pdf'
                ? 1 + totalImages * 2  // PDF 分下载和打包两个阶段
                : 1 + totalImages;      // ZIP 流式处理，一气呵成

            // 更新任务总进度
            updateTask(taskId, {
                total: totalProgress,
                progress: 1, // 获取 photo 完成
            });

            if (format === 'pdf') {
                // PDF：手动处理以分离进度
                const buffer = await (async () => {
                    const pdfDocument = await PDFDocument.create();
                    let processedCount = 0;
                    const totalImages = photo.images.length;

                    // 下载图片 - 带进度回调（已在 downloadAllImages 中解密和转换）
                    const downloadedImages = await downloadAllImages(
                        photo.images,
                        20,
                        (done) => {
                            // 下载阶段：进度从 1 到 1+totalImages
                            updateTask(taskId, {
                                progress: 1 + done,
                                stage: 'downloading'
                            });
                        },
                        photo.id,
                        (photo as PhotoWithScrambleId).scrambleId
                    );

                    // 打包阶段（嵌入 PDF）
                    updateTask(taskId, { stage: 'packaging' });

                    for (let i = 0; i < downloadedImages.length; i++) {
                        const image = downloadedImages[i];
                        if (image.data === null) {
                            processedCount++;
                            // 打包阶段进度：从 1+totalImages+1 到 totalProgress
                            updateTask(taskId, {
                                progress: 1 + totalImages + processedCount,
                                stage: 'packaging'
                            });
                            continue;
                        }

                        // 获取尺寸
                        const bitmap = await createImageBitmap(new Blob([image.data]));
                        const width = bitmap.width;
                        const height = bitmap.height;
                        bitmap.close();

                        // 添加到 PDF
                        const page = pdfDocument.addPage([width, height]);
                        const pdfImage = await pdfDocument.embedJpg(image.data);
                        page.drawImage(pdfImage, {
                            x: 0,
                            y: 0,
                            width: width,
                            height: height,
                        });

                        processedCount++;
                        // 打包阶段进度
                        updateTask(taskId, {
                            progress: 1 + totalImages + processedCount,
                            stage: 'packaging'
                        });
                    }

                    const pdfBytes = await pdfDocument.save();

                    // 完成
                    updateTask(taskId, {
                        progress: totalProgress,
                        stage: 'completed'
                    });

                    return pdfBytes.buffer;
                })();

                startDownload(`${safeName}.pdf`, new Uint8Array(buffer), 'application/pdf');
            } else {
                // ZIP/CBZ：使用流式处理函数
                const buffer = await downloadAndDecryptImagesOfPhotoThenWriteIntoZipFile(
                    photo as PhotoWithScrambleId,
                    (done, total) => {
                        // 流式处理：进度直接反映已完成的图片数
                        // 总进度 = 1(获取photo) + 图片数
                        updateTask(taskId, {
                            progress: 1 + done,
                            stage: done < total ? 'packaging' : 'completed'
                        });
                    }
                );

                const mimeType = format === 'cbz' ? 'application/octet-stream' : 'application/zip';
                startDownload(`${safeName}.${format}`, new Uint8Array(buffer), mimeType);

                // 确保最终状态为 completed
                updateTask(taskId, {
                    progress: totalProgress,
                    stage: 'completed'
                });
            }
        } catch (error) {
            console.error('下载失败:', error);
            updateTask(taskId, {
                stage: 'error',
                error: (error as Error).message,
                progress: 0,
                total: 1
            });
        }
    };

    return (
        <div className="mt-4 space-y-2">
            <div className="text-xs text-gray-400 dark:text-gray-500 font-medium">下载格式</div>
            <div className="flex gap-2">
                <Button
                    size="sm"
                    variant="secondary"
                    className="text-xs flex-1"
                    onPress={() => handleDownload('pdf')}
                >
                    <FileText size={14} className="mr-1" />
                    PDF
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    className="text-xs flex-1"
                    onPress={() => handleDownload('zip')}
                >
                    <FileArchive size={14} className="mr-1" />
                    ZIP
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    className="text-xs flex-1"
                    onPress={() => handleDownload('cbz')}
                >
                    <Download size={14} className="mr-1" />
                    CBZ
                </Button>
            </div>
        </div>
    );
}

// Album 详情组件
function AlbumDetail({ id }: { id: string }) {
    const { data, isFetching } = useQuery<Album | null>({
        queryKey: ["album", id],
        queryFn: () => getAlbum(id),
        enabled: true,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000,
    });

    if (isFetching) {
        return <div className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">加载中...</div>;
    }

    if (!data) {
        return <div className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500">无法加载详情</div>;
    }

    return (
        <div className="px-4 py-3 text-sm space-y-3 border-t border-gray-100 dark:border-gray-800">
            {/* 名称 */}
            <div className="font-medium break-words leading-snug">{data.name}</div>

            {/* 统计信息 */}
            <div className="flex gap-4 text-xs text-gray-400 dark:text-gray-500">
                <span>ID {data.id}</span>
                <span>浏览 {data.totalViews}</span>
                <span>点赞 {data.likes}</span>
            </div>

            {data.tags.length > 0 && (
                <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">标签</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {data.tags.map((tag) => (
                            <span
                                key={tag}
                                className="px-2.5 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full text-xs"
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>
            )}
            {data.works.length > 0 && (
                <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">作品</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {data.works.map((work) => (
                            <span
                                key={work}
                                className="px-2.5 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 rounded-full text-xs"
                            >
                                {work}
                            </span>
                        ))}
                    </div>
                </div>
            )}
            {data.actors.length > 0 && (
                <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">角色</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {data.actors.map((actor) => (
                            <span
                                key={actor}
                                className="px-2.5 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full text-xs"
                            >
                                {actor}
                            </span>
                        ))}
                    </div>
                </div>
            )}
            {data.author.length > 0 && (
                <div>
                    <span className="text-xs text-gray-400 dark:text-gray-500">作者</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {data.author.map((a) => (
                            <span
                                key={a}
                                className="px-2.5 py-0.5 bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 rounded-full text-xs"
                            >
                                {a}
                            </span>
                        ))}
                    </div>
                </div>
            )}
            {data.series && data.series.length > 0 ? (
                <div className="space-y-2">
                    <div className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-3 py-2 rounded-lg">
                        此为合集，暂不支持批量下载全部章节
                    </div>
                    {(() => {
                        const firstChapter = data.series[0];
                        return firstChapter ? (
                            <DownloadButtons
                                id={firstChapter.id}
                                name={`${data.name} - ${firstChapter.name}`}
                            />
                        ) : null;
                    })()}
                </div>
            ) : (
                <DownloadButtons id={data.id} name={data.name} />
            )}
        </div>
    );
}

// 主组件
export default function Home() {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<"0" | "1" | "2" | "3" | "4">("0");
    const [orderBy, setOrderBy] = useState<"mr" | "mv" | "mp" | "tf">("mr");
    const [timeFilter, setTimeFilter] = useState<"a" | "t" | "w" | "m">("a");
    const [queryError, setQueryError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [searchParams, setSearchParams] = useState<{ query: string; page: number; category: string; orderBy: string; time: string } | null>(null);
    const [tasks, setTasks] = useState<DownloadTask[]>([]);
    const [showTaskPanel, setShowTaskPanel] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
        const stored = localStorage.getItem("theme");
        if (stored === "light" || stored === "dark") return stored;
        return "system";
    });
    const listRef = useRef<HTMLDivElement>(null);

    // 深色模式切换
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

    // 监听系统主题变化
    useEffect(() => {
        if (theme !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => applyTheme('system');
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [theme, applyTheme]);

    // 任务管理函数
    const addTask = useCallback((task: Omit<DownloadTask, 'id'>) => {
        const newTask: DownloadTask = { ...task, id: `${Date.now()}_${Math.random()}` };
        setTasks(prev => [...prev, newTask]);
        setShowTaskPanel(true);
        return newTask.id;
    }, []);

    const updateTask = useCallback((id: string, updates: Partial<DownloadTask>) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    }, []);

    const removeTask = useCallback((id: string) => {
        setTasks(prev => prev.filter(t => t.id !== id));
    }, []);

    const clearCompleted = useCallback(() => {
        setTasks(prev => prev.filter(t => t.stage !== 'completed' && t.stage !== 'error'));
    }, []);

    const taskContextValue = {
        tasks,
        addTask,
        updateTask,
        removeTask,
        clearCompleted,
    };

    const { data, isFetching } = useQuery<SearchResult>({
        queryKey: ["search", searchParams?.query, searchParams?.page, searchParams?.category, searchParams?.orderBy, searchParams?.time],
        queryFn: () =>
            search(searchParams!.query, {
                mainTag: parseInt(searchParams!.category) as 1 | 2 | 3 | 4,
                page: searchParams!.page,
                orderBy: searchParams!.orderBy as "mr" | "mv" | "mp" | "tf",
                time: searchParams!.time as "a" | "t" | "w" | "m",
            }),
        enabled: !!searchParams,
        staleTime: 0,
        gcTime: 0,
        placeholderData: keepPreviousData,
    });

    const totalCount = data?.total ? parseInt(data.total) : 0;
    const itemsPerPage = 20;
    const totalPages = Math.ceil(totalCount / itemsPerPage);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    const redirectAid = data && "redirect_aid" in data && data.redirect_aid ? data.redirect_aid : null;
    const hasResults = data && "content" in data && data.content.length > 0;

    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        if (queryError) {
            setQueryError(null);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) {
            setQueryError("请填写搜索内容");
            return;
        }
        performSearch();
    };

    const performSearch = () => {
        if (!query.trim()) return;
        setPage(1);
        setExpandedId(null);
        setSearchParams({ query, page: 1, category, orderBy, time: timeFilter });
    };

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
        setExpandedId(null);
        setSearchParams({ query, page: newPage, category, orderBy, time: timeFilter });
        if (listRef.current) {
            listRef.current.scrollTop = 0;
        }
    };

    return (
        <TaskContext.Provider value={taskContextValue}>
            <div className="fixed inset-0 flex flex-col items-center px-4 pt-6 pb-4">
                {/* 任务面板 */}
                {showTaskPanel && <TaskPanel onClose={() => { setShowTaskPanel(false); clearCompleted(); }} />}

                <div className="w-full max-w-xl flex flex-col h-full">
                    {/* Search Bar */}
                    <form onSubmit={handleSubmit} className="shrink-0 mb-4">
                        <InputGroup className="h-12 w-full" isInvalid={!!queryError}>
                            <InputGroup.Prefix className="p-0 flex-shrink-0">
                                <Select
                                    aria-label="搜索类别"
                                    className="w-24 min-w-[96px] h-full"
                                    variant="secondary"
                                    value={category}
                                    onChange={(value) => {
                                        const newCategory = (value as "0" | "1" | "2" | "3" | "4") ?? "0";
                                        setCategory(newCategory);
                                        if (query.trim()) {
                                            setPage(1);
                                            setExpandedId(null);
                                            setSearchParams({ query, page: 1, category: newCategory, orderBy, time: timeFilter });
                                        }
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
                                            <ListBox.Item id="0" textValue="全部">
                                                全部
                                            </ListBox.Item>
                                            <ListBox.Item id="1" textValue="作品名称">
                                                作品名称
                                            </ListBox.Item>
                                            <ListBox.Item id="2" textValue="作者">
                                                作者
                                            </ListBox.Item>
                                            <ListBox.Item id="3" textValue="标签">
                                                标签
                                            </ListBox.Item>
                                            <ListBox.Item id="4" textValue="角色">
                                                角色
                                            </ListBox.Item>
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
                        {queryError && (
                            <FieldError className="mt-1.5 ml-1">
                                {queryError}
                            </FieldError>
                        )}

                        {/* 排序和时间筛选 */}
                        <div className="flex gap-2 mt-3 items-center">
                            <Select
                                aria-label="排序方式"
                                className="flex-1"
                                variant="secondary"
                                value={orderBy}
                                onChange={(value) => {
                                    const newOrderBy = (value as "mr" | "mv" | "mp" | "tf") ?? "mr";
                                    setOrderBy(newOrderBy);
                                    if (query.trim()) {
                                        setPage(1);
                                        setExpandedId(null);
                                        setSearchParams({ query, page: 1, category, orderBy: newOrderBy, time: timeFilter });
                                    }
                                }}
                                isDisabled={isFetching}
                            >
                                <Select.Trigger className="h-10 text-sm">
                                    <Select.Value />
                                    <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        <ListBox.Item id="mr" textValue="最新发布">
                                            最新发布
                                        </ListBox.Item>
                                        <ListBox.Item id="mv" textValue="最多浏览">
                                            最多浏览
                                        </ListBox.Item>
                                        <ListBox.Item id="mp" textValue="最多图片">
                                            最多图片
                                        </ListBox.Item>
                                        <ListBox.Item id="tf" textValue="最多喜欢">
                                            最多喜欢
                                        </ListBox.Item>
                                    </ListBox>
                                </Select.Popover>
                            </Select>

                            <Select
                                aria-label="时间范围"
                                className="flex-1"
                                variant="secondary"
                                value={timeFilter}
                                onChange={(value) => {
                                    const newTime = (value as "a" | "t" | "w" | "m") ?? "a";
                                    setTimeFilter(newTime);
                                    if (query.trim()) {
                                        setPage(1);
                                        setExpandedId(null);
                                        setSearchParams({ query, page: 1, category, orderBy, time: newTime });
                                    }
                                }}
                                isDisabled={isFetching}
                            >
                                <Select.Trigger className="h-10 text-sm">
                                    <Select.Value />
                                    <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                    <ListBox>
                                        <ListBox.Item id="a" textValue="全部时间">
                                            全部时间
                                        </ListBox.Item>
                                        <ListBox.Item id="t" textValue="今天">
                                            今天
                                        </ListBox.Item>
                                        <ListBox.Item id="w" textValue="本周">
                                            本周
                                        </ListBox.Item>
                                        <ListBox.Item id="m" textValue="本月">
                                            本月
                                        </ListBox.Item>
                                    </ListBox>
                                </Select.Popover>
                            </Select>

                            {/* 深色模式切换 */}
                            <button
                                type="button"
                                onClick={cycleTheme}
                                className="h-10 w-10 shrink-0 flex items-center justify-center rounded-xl border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5"
                                title={theme === 'light' ? '浅色模式' : theme === 'dark' ? '深色模式' : '跟随系统'}
                            >
                                {theme === 'light' && <Sun size={16} />}
                                {theme === 'dark' && <Moon size={16} />}
                                {theme === 'system' && <Monitor size={16} />}
                            </button>
                        </div>
                    </form>

                    {/* 直接匹配的本子 */}
                    {redirectAid && (
                        <div className="shrink-0 mb-4 rounded-xl bg-white dark:bg-gray-900 shadow-sm ring-1 ring-black/5 dark:ring-white/10 overflow-hidden">
                            <div className="px-4 py-2.5 bg-blue-50 dark:bg-blue-900/30 text-sm font-medium text-blue-700 dark:text-blue-300">
                                搜索到直接匹配的本子
                            </div>
                            <AlbumDetail id={redirectAid} />
                        </div>
                    )}

                    {/* 搜索结果列表 - 占据剩余空间 */}
                    {hasResults && (
                        <div
                            ref={listRef}
                            className={`flex-1 overflow-y-auto min-h-0 mb-4 relative ${isFetching ? 'pointer-events-none overflow-hidden' : ''}`}
                        >
                            {isFetching && (
                                <div className="absolute inset-0 bg-gray-100/60 dark:bg-gray-950/60 flex items-start justify-center pt-20 z-10">
                                    <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
                                        <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-blue-500 rounded-full animate-spin" />
                                        <span className="text-sm">加载中...</span>
                                    </div>
                                </div>
                            )}
                            <div className="space-y-2">
                                {data.content.map((item) => {
                                    const isExpanded = expandedId === item.id;
                                    return (
                                        <div key={item.id} className="bg-white dark:bg-gray-900 rounded-xl shadow-sm ring-1 ring-black/5 dark:ring-white/10 overflow-hidden">
                                            <div
                                                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer text-sm"
                                                onClick={() =>
                                                    setExpandedId(
                                                        isExpanded ? null : item.id
                                                    )
                                                }
                                                title={item.name}
                                            >
                                                <span className="text-xs text-gray-400 dark:text-gray-500 tabular-nums shrink-0">
                                                    #{item.id}
                                                </span>
                                                <span className="font-medium truncate flex-1">
                                                    {item.name}
                                                </span>
                                                <span className="text-gray-400 dark:text-gray-500 text-xs shrink-0">
                                                    {item.author}
                                                </span>
                                                <ChevronDown size={14} className={`text-gray-300 dark:text-gray-600 shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                                            </div>
                                            {isExpanded && <AlbumDetail id={item.id} />}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 无结果提示 */}
                    {data && "content" in data && data.content.length === 0 && !redirectAid && (
                        <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
                            没有找到相关结果
                        </div>
                    )}

                    {/* 初始状态 */}
                    {!searchParams && (
                        <div className="flex-1 flex items-center justify-center text-gray-300 dark:text-gray-700 text-sm select-none">
                            输入关键词开始搜索
                        </div>
                    )}

                    {/* 翻页 Bar - 固定在底部 */}
                    {totalCount > 0 && (
                        <div className="shrink-0 pt-3 pb-1 border-t border-gray-200 dark:border-gray-800">
                            <div className="flex items-center justify-center gap-1.5 mb-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="px-3 text-xs"
                                    isDisabled={page === 1 || isFetching}
                                    onPress={() => handlePageChange(1)}
                                >
                                    首页
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="px-3 text-xs"
                                    isDisabled={!hasPrevPage || isFetching}
                                    onPress={() => handlePageChange(page - 1)}
                                >
                                    上页
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="px-3 text-xs"
                                    isDisabled={!hasNextPage || isFetching}
                                    onPress={() => handlePageChange(page + 1)}
                                >
                                    下页
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="px-3 text-xs"
                                    isDisabled={page === totalPages || isFetching}
                                    onPress={() => handlePageChange(totalPages)}
                                >
                                    尾页
                                </Button>
                            </div>
                            <div className="text-center text-gray-400 dark:text-gray-600 text-xs tabular-nums">
                                {totalCount}条 · {page}/{totalPages}页
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </TaskContext.Provider>
    );
}
