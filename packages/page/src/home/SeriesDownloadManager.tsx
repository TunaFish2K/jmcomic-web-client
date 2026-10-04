import { useCallback, useState } from "react";
import { Button } from "@heroui/react";
import { Download, FileArchive, FileText } from "lucide-react";
import { useTasks } from "./task-context";
import {
    buildCombinedDownload,
    buildSingleDownload,
    downloadLimit,
    throwIfDownloadAborted,
} from "./download-utils";
import type { BatchMode, DownloadFormat, DownloadTarget } from "./types";
import { TextInput } from "../ui/fields";

export function SeriesDownloadManager({ albumName, items }: {
    albumName: string;
    items: DownloadTarget[];
}) {
    const { tasks, addTask, updateTask } = useTasks();
    const [rangeStart, setRangeStart] = useState('1');
    const [rangeEnd, setRangeEnd] = useState(String(items.length));
    const [batchMode, setBatchMode] = useState<BatchMode>('individual');
    const orderedItems = [...items].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

    const quickSelectRange = useCallback((start: number, end: number) => {
        setRangeStart(String(start));
        setRangeEnd(String(end));
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

        if (batchMode === 'individual') {
            const queuedItems = selectedItems.filter((item) => !tasks.find((t) =>
                t.albumId === item.id && t.format === format && t.stage !== 'completed' && t.stage !== 'error'
            ));
            if (queuedItems.length === 0) return;

            for (const item of queuedItems) {
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
                <TextInput label="起始话数" inputMode="numeric" value={rangeStart} onChange={setRangeStart} />
                <TextInput label="结束话数" inputMode="numeric" value={rangeEnd} onChange={setRangeEnd} />
            </div>
            <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary"  onPress={() => quickSelectRange(1, orderedItems.length)}>
                    全部
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    
                    onPress={() => quickSelectRange(1, Math.min(10, orderedItems.length))}
                >
                    前 10 话
                </Button>
                <Button
                    size="sm"
                    variant="secondary"
                    
                    onPress={() => quickSelectRange(Math.max(1, orderedItems.length - 9), orderedItems.length)}
                >
                    后 10 话
                </Button>
            </div>
            <div>
                <div className="mb-2 text-xs text-muted">下载方式</div>
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        variant={batchMode === 'individual' ? 'primary' : 'secondary'}
                        className="flex-1"
                        onPress={() => setBatchMode('individual')}
                    >
                        多个文件
                    </Button>
                    <Button
                        size="sm"
                        variant={batchMode === 'combined' ? 'primary' : 'secondary'}
                        className="flex-1"
                        onPress={() => setBatchMode('combined')}
                    >
                        合并为一个
                    </Button>
                </div>
            </div>
            <div className="text-xs text-muted">
                共 {orderedItems.length} 话，当前选择 {selectedItems.length} 话
            </div>
            <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" isDisabled={selectedItems.length === 0} onPress={() => { void handleBatchDownload('pdf'); }}>
                    <FileText size={14} className="mr-1" />PDF
                </Button>
                <Button size="sm" variant="secondary" className="flex-1" isDisabled={selectedItems.length === 0} onPress={() => { void handleBatchDownload('zip'); }}>
                    <FileArchive size={14} className="mr-1" />ZIP
                </Button>
                <Button size="sm" variant="secondary" className="flex-1" isDisabled={selectedItems.length === 0} onPress={() => { void handleBatchDownload('cbz'); }}>
                    <Download size={14} className="mr-1" />CBZ
                </Button>
            </div>
        </div>
    );
}
