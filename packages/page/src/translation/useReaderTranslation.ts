import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    buildPageKey,
    clearTranslationCache,
    getProviderKey,
    getPromptKey,
    getTranslationRequestKey,
    stableHash,
} from "./cache";
import {
    cancelPendingPageJobs,
    countActiveTranslationJobs,
    getTranslationWindow,
    isTranslationJobRelevant,
    partitionTranslationJobs,
    pauseAutoJobs,
    prioritizeManualJob,
    reconcileAutoJobs,
    type TranslationJobContext,
} from "./scheduler";
import {
    isTranslationConfigured,
    loadTranslationSettings,
    saveTranslationSettings,
} from "./settings";
import {
    getCachedPageTranslation,
    translatePage,
    type LoadTranslationImageBlob,
} from "./service";
import {
    getOcrInitializationProgress,
    subscribeOcrInitializationProgress,
} from "./ocr-models";
import {
    TRANSLATION_PROMPT_VERSION,
    type OcrInitializationProgress,
    type PageTranslationRecord,
    type TranslationSettingsV5,
    type TranslationStage,
} from "./types";

export type ReaderTranslationPage = {
    imageName: string;
    imageUrl?: string;
    loadImageBlob?: LoadTranslationImageBlob;
};

type TranslationJob = {
    id: string;
    completionKey: string;
    pageKey: string;
    chapterId: string;
    imageName: string;
    imageUrl?: string;
    loadImageBlob?: LoadTranslationImageBlob;
    settings: TranslationSettingsV5;
    forceTranslation: boolean;
    source: "manual" | "auto";
    windowKey: string;
    requestKey: string;
};

export type TranslationTask = {
    pageKey: string;
    stage: TranslationStage;
    ocrInitialization?: OcrInitializationProgress;
};

export type TranslationNotice = {
    kind: "error" | "info";
    message: string;
};

function getCompletionKey(
    chapterId: string,
    imageName: string,
    settings: TranslationSettingsV5,
) {
    return `${buildPageKey(chapterId, imageName)}:${getProviderKey(settings)}:${getPromptKey(settings)}:${TRANSLATION_PROMPT_VERSION}`;
}

function getWindowKey({
    chapterId,
    currentPage,
    settings,
}: {
    chapterId: string;
    currentPage: number;
    settings: TranslationSettingsV5;
}) {
    return stableHash(
        JSON.stringify({
            chapterId,
            currentPage,
            range: settings.pretranslateRange,
            requestKey: getTranslationRequestKey(settings),
        }),
    );
}

function buildTranslationJobContext({
    chapterId,
    pages,
    currentPage,
    settings,
}: {
    chapterId?: string;
    pages: ReaderTranslationPage[];
    currentPage: number;
    settings: TranslationSettingsV5;
}) {
    const configured = isTranslationConfigured(settings);
    const currentImageName = pages[currentPage]?.imageName;
    const currentPageKey =
        chapterId && currentImageName
            ? buildPageKey(chapterId, currentImageName)
            : "";
    const autoEnabled =
        Boolean(chapterId) &&
        configured &&
        settings.autoTranslate &&
        pages.length > 0;
    const indices = autoEnabled
        ? getTranslationWindow(
              currentPage,
              pages.length,
              settings.pretranslateRange,
          )
        : [];
    const autoPageKeys = new Set(
        indices.flatMap((pageIndex) => {
            const page = pages[pageIndex];
            return chapterId && page
                ? [buildPageKey(chapterId, page.imageName)]
                : [];
        }),
    );
    const context: TranslationJobContext = {
        chapterId: chapterId ?? null,
        requestKey: configured ? getTranslationRequestKey(settings) : null,
        currentPageKey,
        autoEnabled,
        autoPageKeys,
    };
    return { context, indices };
}

export function useReaderTranslation({
    chapterId,
    pages,
    currentPage,
}: {
    chapterId?: string;
    pages: ReaderTranslationPage[];
    currentPage: number;
}) {
    const [settings, setSettings] = useState(loadTranslationSettings);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [currentRecord, setCurrentRecord] =
        useState<PageTranslationRecord | null>(null);
    const [visible, setVisible] = useState(true);
    const [task, setTask] = useState<TranslationTask | null>(null);
    const [activePageKeys, setActivePageKeys] = useState<string[]>([]);
    const [activeJobCount, setActiveJobCount] = useState(0);
    const [notice, setNotice] = useState<TranslationNotice | null>(null);

    const queueRef = useRef<TranslationJob[]>([]);
    const activeJobsRef = useRef(new Map<string, TranslationJob>());
    const jobStagesRef = useRef(new Map<string, TranslationStage>());
    const jobControllersRef = useRef(new Map<string, AbortController>());
    const cancelledJobIdsRef = useRef(new Set<string>());
    const jobSequenceRef = useRef(0);
    const pumpQueueRef = useRef<() => void>(() => {});
    const mountedRef = useRef(true);
    const autoCompletedRef = useRef(new Set<string>());
    const suppressedAutoCompletionsRef = useRef(new Set<string>());
    const pausedWindowRef = useRef<string | null>(null);
    const currentAutoWindowRef = useRef<string | null>(null);
    const pageContextRef = useRef<string | null>(null);
    const chapterIdRef = useRef(chapterId);
    const pagesRef = useRef(pages);
    const currentPageRef = useRef(currentPage);
    const settingsRef = useRef(settings);
    const ocrInitializationRef = useRef(getOcrInitializationProgress());

    chapterIdRef.current = chapterId;
    pagesRef.current = pages;
    currentPageRef.current = currentPage;
    settingsRef.current = settings;

    const getCurrentJobContext = useCallback(
        () =>
            buildTranslationJobContext({
                chapterId: chapterIdRef.current,
                pages: pagesRef.current,
                currentPage: currentPageRef.current,
                settings: settingsRef.current,
            }),
        [],
    );

    const configured = isTranslationConfigured(settings);
    const currentImage = pages[currentPage];
    const currentImageName = currentImage?.imageName;
    const currentPageKey = useMemo(
        () =>
            chapterId && currentImageName
                ? buildPageKey(chapterId, currentImageName)
                : "",
        [chapterId, currentImageName],
    );
    const activePageKeyRef = useRef(currentPageKey);
    activePageKeyRef.current = currentPageKey;

    useEffect(() => {
        mountedRef.current = true;
        const jobControllers = jobControllersRef.current;
        return () => {
            mountedRef.current = false;
            queueRef.current = [];
            for (const controller of jobControllers.values()) {
                controller.abort("unmount");
            }
        };
    }, []);

    const publishActiveState = useCallback(() => {
        if (!mountedRef.current) return;
        const allJobs = [...activeJobsRef.current.values()];
        const visibleJobs = allJobs.filter(
            (job) => !cancelledJobIdsRef.current.has(job.id),
        );
        setActiveJobCount(visibleJobs.length);
        setActivePageKeys(visibleJobs.map((job) => job.pageKey));
        const selected = visibleJobs.find(
            (job) => job.pageKey === activePageKeyRef.current,
        );
        if (!selected) {
            setTask(null);
            return;
        }
        const stage = jobStagesRef.current.get(selected.id) ?? "loading-model";
        setTask({
            pageKey: selected.pageKey,
            stage,
            ocrInitialization:
                stage === "loading-model"
                    ? ocrInitializationRef.current
                    : undefined,
        });
    }, []);

    const stopAutoTranslationForChinesePage = useCallback(
        (completedJobId?: string) => {
            const activeSettings = settingsRef.current;
            if (!activeSettings.autoTranslate) return;

            const saved = saveTranslationSettings(window.localStorage, {
                ...activeSettings,
                autoTranslate: false,
            });
            settingsRef.current = saved;
            queueRef.current = pauseAutoJobs(queueRef.current);
            currentAutoWindowRef.current = null;
            pausedWindowRef.current = null;
            for (const job of activeJobsRef.current.values()) {
                if (
                    job.source !== "auto" ||
                    job.id === completedJobId ||
                    cancelledJobIdsRef.current.has(job.id)
                ) {
                    continue;
                }
                cancelledJobIdsRef.current.add(job.id);
                suppressedAutoCompletionsRef.current.add(job.completionKey);
                jobControllersRef.current.get(job.id)?.abort("already-chinese");
            }
            setSettings(saved);
            if (mountedRef.current) {
                setNotice({
                    kind: "info",
                    message: "检测到页面主要为中文，已关闭自动翻译",
                });
            }
            publishActiveState();
            pumpQueueRef.current();
        },
        [publishActiveState],
    );

    useEffect(() => {
        let cancelled = false;
        setCurrentRecord(null);
        if (!configured || !chapterId || !currentImageName) return;
        getCachedPageTranslation({
            chapterId,
            imageName: currentImageName,
            settings,
        })
            .then((record) => {
                if (cancelled) return;
                setCurrentRecord(record);
                if (!record) return;
                autoCompletedRef.current.add(
                    getCompletionKey(chapterId, currentImageName, settings),
                );
                if (
                    record.pageStatus === "already_chinese" &&
                    settings.autoTranslate
                ) {
                    stopAutoTranslationForChinesePage();
                }
            })
            .catch(() => {
                if (!cancelled) setCurrentRecord(null);
            });
        return () => {
            cancelled = true;
        };
    }, [
        chapterId,
        configured,
        currentImageName,
        settings,
        stopAutoTranslationForChinesePage,
    ]);

    useEffect(
        () =>
            subscribeOcrInitializationProgress((progress) => {
                ocrInitializationRef.current = progress;
                if (!mountedRef.current) return;
                setTask((current) =>
                    current?.stage === "loading-model"
                        ? { ...current, ocrInitialization: progress }
                        : current,
                );
            }),
        [],
    );

    useEffect(() => {
        publishActiveState();
    }, [currentPageKey, publishActiveState]);

    const pumpQueue = useCallback(() => {
        const concurrency = settingsRef.current.translationConcurrency;
        let activeJobCount = countActiveTranslationJobs(
            activeJobsRef.current.values(),
            cancelledJobIdsRef.current,
        );
        while (activeJobCount < concurrency && queueRef.current.length > 0) {
            const job = queueRef.current.shift();
            if (!job) continue;
            if (
                !isTranslationJobRelevant(job, getCurrentJobContext().context)
            ) {
                continue;
            }
            activeJobsRef.current.set(job.id, job);
            activeJobCount += 1;
            jobStagesRef.current.set(job.id, "loading-model");
            const controller = new AbortController();
            jobControllersRef.current.set(job.id, controller);
            if (mountedRef.current) setNotice(null);
            publishActiveState();

            void (async () => {
                try {
                    const record = await translatePage({
                        chapterId: job.chapterId,
                        imageName: job.imageName,
                        imageUrl: job.imageUrl,
                        loadImageBlob: job.loadImageBlob,
                        settings: job.settings,
                        forceTranslation: job.forceTranslation,
                        signal: controller.signal,
                        onStage: (stage) => {
                            if (
                                mountedRef.current &&
                                activeJobsRef.current.has(job.id) &&
                                !cancelledJobIdsRef.current.has(job.id)
                            ) {
                                jobStagesRef.current.set(job.id, stage);
                                publishActiveState();
                            }
                        },
                    });

                    if (
                        cancelledJobIdsRef.current.has(job.id) ||
                        !isTranslationJobRelevant(
                            job,
                            getCurrentJobContext().context,
                        )
                    ) {
                        return;
                    }
                    autoCompletedRef.current.add(job.completionKey);
                    const isCurrentPage =
                        mountedRef.current &&
                        activePageKeyRef.current === job.pageKey &&
                        job.completionKey ===
                            getCompletionKey(
                                job.chapterId,
                                job.imageName,
                                settingsRef.current,
                            );
                    if (isCurrentPage) {
                        setCurrentRecord(record);
                        setVisible(true);
                    }
                    if (record.pageStatus === "already_chinese") {
                        if (job.source === "auto") {
                            stopAutoTranslationForChinesePage(job.id);
                        } else if (isCurrentPage) {
                            setNotice({
                                kind: "info",
                                message: "本页主要为中文，已跳过",
                            });
                        }
                    } else if (
                        isCurrentPage &&
                        record.regions.length === 0 &&
                        (job.source === "manual" ||
                            record.skippedRegionCount > 0)
                    ) {
                        setNotice({
                            kind: "info",
                            message:
                                record.skippedRegionCount > 0
                                    ? "本页没有需要覆盖的文本"
                                    : "本页未识别到日文文本",
                        });
                    }
                } catch (error) {
                    if (
                        cancelledJobIdsRef.current.has(job.id) ||
                        !isTranslationJobRelevant(
                            job,
                            getCurrentJobContext().context,
                        )
                    ) {
                        return;
                    }
                    const activeWindow =
                        job.source === "auto" &&
                        currentAutoWindowRef.current === job.windowKey
                            ? job.windowKey
                            : null;
                    const alreadyPaused =
                        activeWindow !== null &&
                        pausedWindowRef.current === activeWindow;
                    if (activeWindow) {
                        pausedWindowRef.current = activeWindow;
                        queueRef.current = pauseAutoJobs(queueRef.current);
                    }
                    if (mountedRef.current && !alreadyPaused) {
                        setNotice({
                            kind: "error",
                            message:
                                error instanceof Error
                                    ? error.message
                                    : "翻译失败，请重试",
                        });
                    }
                } finally {
                    activeJobsRef.current.delete(job.id);
                    jobStagesRef.current.delete(job.id);
                    jobControllersRef.current.delete(job.id);
                    cancelledJobIdsRef.current.delete(job.id);
                    publishActiveState();
                    pumpQueueRef.current();
                }
            })();
        }
    }, [
        getCurrentJobContext,
        publishActiveState,
        stopAutoTranslationForChinesePage,
    ]);
    pumpQueueRef.current = pumpQueue;

    const syncAutoQueue = useCallback(() => {
        const activeSettings = settingsRef.current;
        const activeChapterId = chapterIdRef.current;
        const activePages = pagesRef.current;
        const activeCurrentPage = currentPageRef.current;
        const { context, indices } = getCurrentJobContext();
        const pageContext = activeChapterId
            ? `${activeChapterId}:${activeCurrentPage}`
            : null;
        if (pageContextRef.current !== pageContext) {
            pageContextRef.current = pageContext;
            pausedWindowRef.current = null;
            suppressedAutoCompletionsRef.current.clear();
            if (mountedRef.current) setNotice(null);
        }

        const pendingJobs = partitionTranslationJobs(queueRef.current, context);
        queueRef.current = pendingJobs.kept;
        const activeJobs = partitionTranslationJobs(
            [...activeJobsRef.current.values()],
            context,
        );
        for (const job of activeJobs.stale) {
            if (cancelledJobIdsRef.current.has(job.id)) continue;
            cancelledJobIdsRef.current.add(job.id);
            jobControllersRef.current.get(job.id)?.abort("stale-context");
        }
        if (activeJobs.stale.length > 0) publishActiveState();

        if (!context.autoEnabled || !activeChapterId) {
            currentAutoWindowRef.current = null;
            void pumpQueue();
            return;
        }

        const windowKey = getWindowKey({
            chapterId: activeChapterId,
            currentPage: activeCurrentPage,
            settings: activeSettings,
        });
        currentAutoWindowRef.current = windowKey;
        for (const job of activeJobs.kept) {
            if (job.source === "auto") job.windowKey = windowKey;
        }
        if (pausedWindowRef.current === windowKey) {
            void pumpQueue();
            return;
        }

        const activeCompletionKeys = new Set(
            [...activeJobsRef.current.values()]
                .filter((job) => !cancelledJobIdsRef.current.has(job.id))
                .map((job) => job.completionKey),
        );
        const jobs: TranslationJob[] = [];
        for (const pageIndex of indices) {
            const page = activePages[pageIndex];
            if (!page || (!page.imageUrl && !page.loadImageBlob)) continue;
            const pageKey = buildPageKey(activeChapterId, page.imageName);
            const completionKey = getCompletionKey(
                activeChapterId,
                page.imageName,
                activeSettings,
            );
            if (
                autoCompletedRef.current.has(completionKey) ||
                activeCompletionKeys.has(completionKey) ||
                suppressedAutoCompletionsRef.current.has(completionKey)
            ) {
                continue;
            }
            jobs.push({
                id: `auto:${++jobSequenceRef.current}:${pageKey}`,
                completionKey,
                pageKey,
                chapterId: activeChapterId,
                imageName: page.imageName,
                imageUrl: page.imageUrl,
                loadImageBlob: page.loadImageBlob,
                settings: activeSettings,
                forceTranslation: false,
                source: "auto",
                windowKey,
                requestKey: context.requestKey!,
            });
        }
        queueRef.current = reconcileAutoJobs(
            queueRef.current,
            jobs,
            activeCompletionKeys,
        );
        void pumpQueue();
    }, [getCurrentJobContext, publishActiveState, pumpQueue]);

    useEffect(() => {
        syncAutoQueue();
    }, [chapterId, currentPage, pages, settings, syncAutoQueue]);

    const commitSettings = useCallback((next: TranslationSettingsV5) => {
        const saved = saveTranslationSettings(window.localStorage, next);
        pausedWindowRef.current = null;
        suppressedAutoCompletionsRef.current.clear();
        setSettings(saved);
        setNotice(null);
        setDialogOpen(false);
    }, []);

    const makeRoomForManualTranslation = useCallback(() => {
        const activeJobCount = countActiveTranslationJobs(
            activeJobsRef.current.values(),
            cancelledJobIdsRef.current,
        );
        if (activeJobCount < settingsRef.current.translationConcurrency) {
            return;
        }
        const autoJob = [...activeJobsRef.current.values()].find(
            (job) =>
                job.source === "auto" &&
                !cancelledJobIdsRef.current.has(job.id),
        );
        if (!autoJob) return;

        cancelledJobIdsRef.current.add(autoJob.id);
        suppressedAutoCompletionsRef.current.add(autoJob.completionKey);
        jobControllersRef.current.get(autoJob.id)?.abort("manual-priority");
        publishActiveState();
    }, [publishActiveState]);

    const runCurrentTranslation = useCallback(
        (forceTranslation = false) => {
            const activeSettings = settingsRef.current;
            const activeChapterId = chapterIdRef.current;
            const pageIndex = currentPageRef.current;
            const page = pagesRef.current[pageIndex];
            if (!isTranslationConfigured(activeSettings)) {
                setDialogOpen(true);
                return;
            }
            if (
                !activeChapterId ||
                !page ||
                (!page.imageUrl && !page.loadImageBlob)
            ) {
                setNotice({
                    kind: "info",
                    message: "当前页图片仍在加载，请稍后重试",
                });
                return;
            }

            pausedWindowRef.current = null;
            suppressedAutoCompletionsRef.current.clear();
            const pageKey = buildPageKey(activeChapterId, page.imageName);
            const completionKey = getCompletionKey(
                activeChapterId,
                page.imageName,
                activeSettings,
            );
            if (
                !forceTranslation &&
                [...activeJobsRef.current.values()].some(
                    (job) =>
                        job.completionKey === completionKey &&
                        !cancelledJobIdsRef.current.has(job.id),
                )
            ) {
                syncAutoQueue();
                return;
            }

            const manualJob: TranslationJob = {
                id: `manual:${++jobSequenceRef.current}:${pageKey}`,
                completionKey,
                pageKey,
                chapterId: activeChapterId,
                imageName: page.imageName,
                imageUrl: page.imageUrl,
                loadImageBlob: page.loadImageBlob,
                settings: activeSettings,
                forceTranslation,
                source: "manual",
                windowKey: currentAutoWindowRef.current ?? "manual",
                requestKey: getTranslationRequestKey(activeSettings),
            };
            queueRef.current = prioritizeManualJob(queueRef.current, manualJob);
            makeRoomForManualTranslation();
            setNotice(null);
            syncAutoQueue();
            void pumpQueue();
        },
        [makeRoomForManualTranslation, pumpQueue, syncAutoQueue],
    );

    const clearCache = useCallback(async () => {
        await clearTranslationCache();
        autoCompletedRef.current.clear();
        suppressedAutoCompletionsRef.current.clear();
        queueRef.current = pauseAutoJobs(queueRef.current);
        pausedWindowRef.current = currentAutoWindowRef.current;
        setCurrentRecord(null);
        setNotice({ kind: "info", message: "翻译缓存已清除" });
    }, []);

    const cancelCurrentTranslation = useCallback(() => {
        const currentPageKey = activePageKeyRef.current;
        if (!currentPageKey) return;

        const pending = cancelPendingPageJobs(queueRef.current, currentPageKey);
        queueRef.current = pending.remaining;
        for (const job of pending.cancelled) {
            if (job.source === "auto") {
                suppressedAutoCompletionsRef.current.add(job.completionKey);
            }
        }
        for (const job of activeJobsRef.current.values()) {
            if (job.pageKey !== currentPageKey) continue;
            cancelledJobIdsRef.current.add(job.id);
            if (job.source === "auto") {
                suppressedAutoCompletionsRef.current.add(job.completionKey);
            }
            jobControllersRef.current.get(job.id)?.abort("user-cancel");
        }
        setNotice(null);
        publishActiveState();
        pumpQueueRef.current();
    }, [publishActiveState]);

    return {
        settings,
        configured,
        dialogOpen,
        currentRecord,
        visible,
        task,
        busy: activeJobCount > 0,
        currentPageBusy: activePageKeys.includes(currentPageKey),
        notice,
        openDialog: () => setDialogOpen(true),
        closeDialog: () => setDialogOpen(false),
        saveSettings: commitSettings,
        clearCache,
        translateCurrent: () => runCurrentTranslation(false),
        retranslateCurrent: () => runCurrentTranslation(true),
        cancelCurrentTranslation,
        toggleVisible: () => setVisible((value) => !value),
        dismissNotice: () => setNotice(null),
    };
}
