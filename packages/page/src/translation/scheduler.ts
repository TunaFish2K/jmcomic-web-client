export function getTranslationWindow(
    currentPage: number,
    totalPages: number,
    range: number,
) {
    if (totalPages <= 0) return [];
    const current = Math.max(
        0,
        Math.min(totalPages - 1, Math.round(currentPage)),
    );
    const radius = Math.max(0, Math.round(range));
    const pages = [current];
    for (let distance = 1; distance <= radius; distance += 1) {
        const next = current + distance;
        const previous = current - distance;
        if (next < totalPages) pages.push(next);
        if (previous >= 0) pages.push(previous);
    }
    return pages;
}

export type SchedulableTranslationJob = {
    pageKey: string;
    completionKey: string;
    source: "manual" | "auto";
};

export type ContextualTranslationJob = SchedulableTranslationJob & {
    chapterId: string;
    requestKey: string;
};

export type TranslationJobContext = {
    chapterId: string | null;
    requestKey: string | null;
    currentPageKey: string;
    autoEnabled: boolean;
    autoPageKeys: ReadonlySet<string>;
};

export function isTranslationJobRelevant(
    job: ContextualTranslationJob,
    context: TranslationJobContext,
) {
    if (!context.chapterId || !context.requestKey) return false;
    if (
        job.chapterId !== context.chapterId ||
        job.requestKey !== context.requestKey
    ) {
        return false;
    }
    if (job.source === "manual") {
        return job.pageKey === context.currentPageKey;
    }
    return context.autoEnabled && context.autoPageKeys.has(job.pageKey);
}

export function partitionTranslationJobs<T extends ContextualTranslationJob>(
    jobs: T[],
    context: TranslationJobContext,
) {
    const kept: T[] = [];
    const stale: T[] = [];
    for (const job of jobs) {
        (isTranslationJobRelevant(job, context) ? kept : stale).push(job);
    }
    return { kept, stale };
}

export function reconcileAutoJobs<T extends SchedulableTranslationJob>(
    pending: T[],
    desiredAutoJobs: T[],
    activeCompletionKeys: Iterable<string> = [],
) {
    const manualJobs = pending.filter((job) => job.source === "manual");
    const seen = new Set(manualJobs.map((job) => job.completionKey));
    for (const completionKey of activeCompletionKeys) seen.add(completionKey);
    const autoJobs = desiredAutoJobs.filter((job) => {
        if (seen.has(job.completionKey)) return false;
        seen.add(job.completionKey);
        return true;
    });
    return [...manualJobs, ...autoJobs];
}

export function prioritizeManualJob<T extends SchedulableTranslationJob>(
    pending: T[],
    manualJob: T,
) {
    return [
        manualJob,
        ...pending.filter((job) => job.pageKey !== manualJob.pageKey),
    ];
}

export function pauseAutoJobs<T extends SchedulableTranslationJob>(
    pending: T[],
) {
    return pending.filter((job) => job.source === "manual");
}

export function cancelPendingPageJobs<T extends SchedulableTranslationJob>(
    pending: T[],
    pageKey: string,
) {
    return {
        remaining: pending.filter((job) => job.pageKey !== pageKey),
        cancelled: pending.filter((job) => job.pageKey === pageKey),
    };
}

export function countActiveTranslationJobs<T extends { id: string }>(
    jobs: Iterable<T>,
    cancelledJobIds: ReadonlySet<string>,
) {
    let count = 0;
    for (const job of jobs) {
        if (!cancelledJobIds.has(job.id)) count += 1;
    }
    return count;
}

let ocrQueue: Promise<void> = Promise.resolve();

export function runSerializedOcr<T>(task: () => Promise<T>) {
    const result = ocrQueue.then(task);
    ocrQueue = result.then(
        () => undefined,
        () => undefined,
    );
    return result;
}
