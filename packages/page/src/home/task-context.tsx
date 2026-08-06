import { createContext, useContext } from "react";
import type { DownloadTask, DownloadTaskHandle } from "./types";

export type TaskContextType = {
    tasks: DownloadTask[];
    addTask: (task: Omit<DownloadTask, 'id'>) => DownloadTaskHandle;
    updateTask: (id: string, updates: Partial<DownloadTask>) => void;
    removeTask: (id: string) => void;
    clearCompleted: () => void;
};

export const TaskContext = createContext<TaskContextType | null>(null);

export function useTasks() {
    const ctx = useContext(TaskContext);
    if (!ctx) throw new Error('useTasks must be used within TaskProvider');
    return ctx;
}
