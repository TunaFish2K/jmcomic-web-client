export type DownloadTask = {
    id: string;
    albumId: string;
    name: string;
    format: 'pdf' | 'zip' | 'cbz';
    stage: 'processing' | 'finalizing' | 'completed' | 'error';
    progress: number;
    total: number;
    error?: string;
};

export type DownloadFormat = DownloadTask['format'];

export type DownloadTarget = {
    id: string;
    name: string;
    order: number;
};

export type BatchMode = 'individual' | 'combined';

export type DownloadTaskHandle = { id: string; signal: AbortSignal };
