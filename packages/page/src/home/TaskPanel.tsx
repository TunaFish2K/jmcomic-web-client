import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useTasks } from "./task-context";
import type { DownloadTask } from "./types";

export function TaskPanel({ onClose }: { onClose: () => void }) {
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
