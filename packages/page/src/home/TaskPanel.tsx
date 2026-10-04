import { useState } from "react";
import { Button } from "@heroui/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTasks } from "./task-context";
import type { DownloadTask } from "./types";

const STAGE_TEXT: Record<DownloadTask['stage'], string> = { processing: '处理图片', finalizing: '写入文件', completed: '完成', error: '错误' };
const STAGE_COLOR: Record<DownloadTask['stage'], string> = { processing: 'bg-brand-500', finalizing: 'bg-warning', completed: 'bg-success', error: 'bg-danger' };

export function TaskPanel({ onClose }: { onClose: () => void }) {
    const { tasks, removeTask, clearCompleted } = useTasks();
    const [expanded, setExpanded] = useState(true);

    const activeTasks = tasks.filter(t => t.stage !== 'completed' && t.stage !== 'error');
    const completedTasks = tasks.filter(t => t.stage === 'completed');

    if (tasks.length === 0) return null;

    return (
        <section aria-label="下载任务"
            className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-(--z-panel) w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-surface shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center justify-between gap-2 py-1 pl-1 pr-2">
                <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
                    className="flex min-h-10 flex-1 items-center gap-2 rounded-lg px-3 text-left transition-colors hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-brand-500">
                    <span className="text-sm font-semibold">下载 ({activeTasks.length}进行中)</span>
                    {expanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronUp size={16} className="text-muted" />}
                </button>
                {completedTasks.length > 0 && (
                    <Button size="sm" variant="ghost" onPress={clearCompleted}>清除</Button>
                )}
                <Button size="sm" variant="ghost" isIconOnly aria-label="关闭下载面板" onPress={onClose}>
                    <X size={16} />
                </Button>
            </div>
            {expanded && (
                <ul className="max-h-48 overflow-y-auto border-t border-border">
                    {tasks.map(task => (
                        <li key={task.id} className="border-b border-border px-4 py-3 last:border-b-0">
                            <div className="mb-2 flex items-center justify-between">
                                <div className="mr-2 min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium" title={task.name}>{task.name}</div>
                                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                                        <span className="font-mono">{task.format.toUpperCase()}</span>
                                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${STAGE_COLOR[task.stage]}`} />
                                        <span>{STAGE_TEXT[task.stage]}</span>
                                    </div>
                                    {task.error && (
                                        <div className="mt-1 line-clamp-2 text-xs text-danger" title={task.error}>
                                            {task.error}
                                        </div>
                                    )}
                                </div>
                                <Button size="sm" variant="ghost" isIconOnly aria-label={`移除任务 ${task.name}`} className="shrink-0 hover:text-danger" onPress={() => removeTask(task.id)}>
                                    <X size={14} />
                                </Button>
                            </div>
                            <div className="relative h-1 overflow-hidden rounded-full bg-surface-secondary">
                                <div
                                    className={`absolute left-0 top-0 h-full rounded-full ${STAGE_COLOR[task.stage]}`}
                                    style={{ width: `${task.total > 0 ? (task.progress / task.total) * 100 : 0}%` }}
                                />
                            </div>
                            <div className="mt-1 text-right text-xs tabular-nums text-muted">{task.progress}/{task.total}</div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
