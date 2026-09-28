import type { ImageOptions, ImageResult } from 'jmcomic-sdk';
import { JmError } from 'jmcomic-sdk';

export type ImageProcessing = (data: ArrayBuffer, slices: number, options?: ImageOptions) => Promise<ImageResult>;
type Job = { id: number; data: ArrayBuffer; slices: number; options: ImageOptions;
    resolve: (result: ImageResult) => void; reject: (reason: unknown) => void; cancel: () => void; cancelled: boolean };
type Reply = { id: number; result?: ImageResult; error?: { code: string; message: string } };

/** Serial dispatch bounds codec memory and leaves the UI thread free. */
export class ImageWorkerClient {
    private worker?: Worker;
    private active?: Job;
    private queue: Job[] = [];
    private sequence = 0;
    private readonly factory: () => Worker;
    constructor(factory: () => Worker) { this.factory = factory; }
    process: ImageProcessing = (data, slices, options = {}) => {
        if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        if (this.queue.length >= 16) return Promise.reject(new JmError('BUSY', 'Image processing queue is full', true));
        return new Promise((resolve, reject) => {
            const job: Job = { id: this.sequence++, data, slices, options, resolve, reject, cancelled: false, cancel: () => {} };
            job.cancel = () => {
                job.cancelled = true;
                this.queue = this.queue.filter(item => item !== job);
                reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
                options.signal?.removeEventListener('abort', job.cancel);
            };
            options.signal?.addEventListener('abort', job.cancel, { once: true });
            this.queue.push(job); this.pump();
        });
    };
    private pump() {
        if (this.active || !this.queue.length) return;
        try {
            if (!this.worker) {
                this.worker = this.factory();
                this.worker.onmessage = (event: MessageEvent<Reply>) => {
                    const job = this.active;
                    if (!job || event.data.id !== job.id) return;
                    job.options.signal?.removeEventListener('abort', job.cancel);
                    if (!job.cancelled) {
                        if (event.data.error) job.reject(new Error(event.data.error.message));
                        else if (event.data.result) job.resolve(event.data.result);
                        else job.reject(new Error('Image worker returned an invalid result'));
                    }
                    this.active = undefined; this.pump();
                };
                this.worker.onerror = () => this.dispose(new Error('Image worker failed to start or process an image'));
                this.worker.onmessageerror = () => this.dispose(new Error('Image worker returned an unreadable message'));
            }
            const job = this.queue.shift()!;
            this.active = job;
            const { signal: _signal, ...options } = job.options;
            this.worker.postMessage({ id: job.id, data: job.data, slices: job.slices, options }, [job.data]);
        } catch (error) { this.dispose(error); }
    }
    dispose(reason: unknown = new DOMException('Image processor closed', 'AbortError')) {
        this.worker?.terminate(); this.worker = undefined;
        for (const job of [...this.queue, ...(this.active ? [this.active] : [])]) {
            job.options.signal?.removeEventListener('abort', job.cancel); job.reject(reason);
        }
        this.queue = []; this.active = undefined;
    }
}

const worker = new ImageWorkerClient(() => new Worker(new URL('./image-worker.ts', import.meta.url), { type: 'module' }));
let implementation: ImageProcessing = worker.process;
/** Allows non-browser application hosts to provide their SDK image processor. */
export function configureImageProcessing(process: ImageProcessing) { implementation = process; }
export const processImage: ImageProcessing = (data, slices, options) => implementation(data, slices, options);
