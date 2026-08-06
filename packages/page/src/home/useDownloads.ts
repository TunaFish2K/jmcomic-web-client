import { useCallback, useEffect, useRef, useState } from "react";
import type { DownloadTask } from "./types";

export function useDownloads() {
    const [tasks, setTasks] = useState<DownloadTask[]>([]);
    const [showTaskPanel, setShowTaskPanel] = useState(false);
    const taskControllersRef = useRef(new Map<string, AbortController>());

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

    return { tasks, showTaskPanel, setShowTaskPanel, taskContextValue, clearCompleted };
}
