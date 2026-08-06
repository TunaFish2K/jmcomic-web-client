import { Button } from "@heroui/react";
import { Download, FileArchive, FileText } from "lucide-react";
import { useTasks } from "./task-context";
import { buildSingleDownload, downloadLimit, throwIfDownloadAborted } from "./download-utils";
import type { DownloadFormat, DownloadTarget } from "./types";

export const previewActionButtonClass = "text-xs flex-1 border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 data-[hovered=true]:bg-brand-100 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-300 dark:hover:bg-brand-900/40 dark:data-[hovered=true]:bg-brand-900/40";
export const previewFullActionButtonClass = "text-xs w-full mt-2 border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100 data-[hovered=true]:bg-brand-100 dark:border-brand-900/60 dark:bg-brand-950/30 dark:text-brand-300 dark:hover:bg-brand-900/40 dark:data-[hovered=true]:bg-brand-900/40";

export function DownloadButtons({ items, label }: {
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
