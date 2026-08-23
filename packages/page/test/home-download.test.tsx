import assert from 'node:assert/strict';
import type { ReactNode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getPhoto: vi.fn(),
  getBatchPhoto: vi.fn(),
  exportFile: vi.fn(),
  startDownload: vi.fn(),
}));

vi.mock('../src/api', () => ({
  getPhoto: state.getPhoto,
  getBatchPhoto: state.getBatchPhoto,
}));

vi.mock('@tiny-client/shared', () => ({
  exportPhotosToTemporaryFile: state.exportFile,
  startTemporaryDownload: state.startDownload,
}));

vi.mock('@heroui/react', () => ({
  Button: ({ children, onPress, isDisabled, ...props }: { children: ReactNode; onPress?: () => void; isDisabled?: boolean }) => (
    <button type="button" disabled={isDisabled} onClick={onPress} {...props}>{children}</button>
  ),
}));

import {
  buildCombinedDownload,
  buildSingleDownload,
  formatBatchError,
  getPhotosInChunks,
  parseSeriesOrder,
  sanitizeFilename,
  throwIfDownloadAborted,
  waitForRetry,
} from '../src/home/download-utils';
import { DownloadButtons } from '../src/home/DownloadButtons';
import { SeriesDownloadManager } from '../src/home/SeriesDownloadManager';
import { TaskPanel } from '../src/home/TaskPanel';
import { TaskContext, useTasks, type TaskContextType } from '../src/home/task-context';
import { useDownloads } from '../src/home/useDownloads';
import type { DownloadTask } from '../src/home/types';

const targets = [
  { id: '2', name: 'Second', order: 2 },
  { id: '1', name: 'First', order: 1 },
  { id: '3', name: 'Third', order: 3 },
];

function photo(id: string, count = 2) {
  return {
    id,
    name: `Photo ${id}`,
    scrambleId: 0,
    images: Array.from({ length: count }, (_, index) => ({ name: `${index}.jpg`, url: `https://cdn/${id}/${index}` })),
  };
}

function makeContext(overrides: Partial<TaskContextType> = {}): TaskContextType {
  return {
    tasks: [],
    addTask: vi.fn(() => ({ id: 'task', signal: new AbortController().signal })),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
    clearCompleted: vi.fn(),
    ...overrides,
  };
}

function Provider({ value, children }: { value: TaskContextType; children: ReactNode }) {
  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

async function flush() {
  await act(async () => {
    for (let index = 0; index < 8; index++) await Promise.resolve();
  });
}

describe('download utilities', () => {
  beforeEach(() => {
    state.getPhoto.mockReset().mockResolvedValue(photo('1'));
    state.getBatchPhoto.mockReset();
    state.exportFile.mockReset().mockImplementation(async (_options: unknown, onProgress: (progress: object) => void) => {
      onProgress({ completed: 1, total: 2, stage: 'processing' });
      return { kind: 'blob', blob: new Blob(['file']) };
    });
    state.startDownload.mockReset();
  });

  test('normalizes filenames, series ordering, and batch error details', () => {
    assert.equal(sanitizeFilename('a<b>:c/d\\e|f?g*'), 'a_b__c_d_e_f_g_');
    assert.equal(parseSeriesOrder(2.5), 2.5);
    assert.equal(parseSeriesOrder('08 extra'), 8);
    assert.equal(parseSeriesOrder(undefined), Number.MAX_SAFE_INTEGER);
    assert.equal(formatBatchError({ message: 'failed', stage: 'photo', domain: 'cdn', reference: 'r1' }), 'failed (阶段: photo | 域名: cdn | 引用: r1)');
    assert.equal(formatBatchError({ message: 'failed', stage: 'unknown' }), 'failed');
  });

  test('supports retry waits and aborts before and during a wait', async () => {
    vi.useFakeTimers();
    const resolved = waitForRetry(10);
    await vi.advanceTimersByTimeAsync(10);
    await resolved;

    const before = new AbortController();
    before.abort(new Error('before'));
    assert.throws(() => throwIfDownloadAborted(before.signal), /before/);
    await assert.rejects(waitForRetry(10, before.signal), /before/);

    const during = new AbortController();
    const pending = waitForRetry(100, during.signal);
    during.abort();
    await assert.rejects(pending, (error: unknown) => (error as { name?: string }).name === 'AbortError');
  });

  test('loads photos in chunks, retries only failures, and reports exhausted chapters', async () => {
    vi.useFakeTimers();
    state.getBatchPhoto
      .mockResolvedValueOnce([
        { photoId: '1', photo: photo('1') },
        { photoId: '2', error: { message: 'temporary', stage: 'photo' } },
      ])
      .mockResolvedValueOnce([{ photoId: '3', photo: photo('3') }])
      .mockResolvedValueOnce([{ photoId: '2', photo: photo('2') }]);
    const pending = getPhotosInChunks(targets, 2);
    await vi.advanceTimersByTimeAsync(1000);
    const loaded = await pending;
    assert.deepEqual(loaded.map((item) => item.photo.id), ['2', '1', '3']);
    assert.deepEqual(state.getBatchPhoto.mock.calls.map((call) => call[0]), [['2', '1'], ['3'], ['2']]);

    state.getBatchPhoto.mockReset().mockResolvedValue([{ photoId: '1', error: { message: 'no', stage: 'unknown' } }]);
    const failed = assert.rejects(
      getPhotosInChunks([{ id: '1', name: 'Missing', order: 1 }], 20),
      /无法获取章节 Missing/,
    );
    await vi.runAllTimersAsync();
    await failed;
  });

  test('builds single and combined exports with progress and output layouts', async () => {
    const update = vi.fn();
    const signal = new AbortController().signal;
    await buildSingleDownload({ id: '1', name: 'A/B', order: 1 }, 'pdf', update, signal);
    assert.equal(state.exportFile.mock.calls[0][0].filename, 'A_B.pdf');
    assert.equal(state.startDownload.mock.calls[0][0], 'A_B.pdf');
    assert.ok(update.mock.calls.length >= 2);

    state.getBatchPhoto.mockResolvedValue([
      { photoId: '1', photo: photo('1', 2) },
      { photoId: '2', photo: photo('2', 3) },
    ]);
    await buildCombinedDownload(targets.slice(0, 2), 'cbz', 'Combined:*', update, signal);
    assert.equal(state.exportFile.mock.calls[1][0].archiveLayout, 'flat');
    assert.equal(state.exportFile.mock.calls[1][0].filename, 'Combined__.cbz');
    await buildCombinedDownload(targets.slice(0, 2), 'zip', 'Combined', update, signal);
    assert.equal(state.exportFile.mock.calls[2][0].archiveLayout, 'folders');

    state.getPhoto.mockResolvedValueOnce(null);
    await assert.rejects(buildSingleDownload(targets[0], 'zip', update, signal), /无法获取图片数据/);
  });
});

describe('download state and controls', () => {
  beforeEach(() => {
    state.getPhoto.mockReset().mockImplementation(async (id: string) => photo(id));
    state.getBatchPhoto.mockReset().mockImplementation(async (ids: string[]) => ids.map((id) => ({ photoId: id, photo: photo(id) })));
    state.exportFile.mockReset().mockImplementation(async (_options: unknown, onProgress: (progress: object) => void) => {
      onProgress({ completed: 1, total: 2, stage: 'processing' });
      return { kind: 'blob', blob: new Blob(['file']) };
    });
    state.startDownload.mockReset();
  });

  test('manages task lifecycle and aborts removed and unmounted tasks', () => {
    const hook = renderHook(() => useDownloads());
    let handle!: { id: string; signal: AbortSignal };
    act(() => { handle = hook.result.current.taskContextValue.addTask({ albumId: '1', name: 'One', format: 'pdf', stage: 'processing', progress: 0, total: 2 }); });
    assert.equal(hook.result.current.showTaskPanel, true);
    act(() => hook.result.current.taskContextValue.updateTask(handle.id, { progress: 1 }));
    assert.equal(hook.result.current.tasks[0].progress, 1);
    act(() => hook.result.current.taskContextValue.removeTask(handle.id));
    assert.equal(handle.signal.aborted, true);

    let second!: { id: string; signal: AbortSignal };
    act(() => { second = hook.result.current.taskContextValue.addTask({ albumId: '2', name: 'Two', format: 'zip', stage: 'processing', progress: 0, total: 1 }); });
    act(() => hook.result.current.taskContextValue.updateTask(second.id, { stage: 'completed' }));
    act(() => hook.result.current.clearCompleted());
    assert.equal(hook.result.current.tasks.length, 0);
    let third!: { id: string; signal: AbortSignal };
    act(() => { third = hook.result.current.taskContextValue.addTask({ albumId: '3', name: 'Three', format: 'cbz', stage: 'processing', progress: 0, total: 1 }); });
    hook.unmount();
    assert.equal(third.signal.aborted, true);
  });

  test('requires task context', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    assert.throws(() => renderHook(() => useTasks()), /TaskProvider/);
    error.mockRestore();
  });

  test('queues ordered downloads, suppresses duplicates, and records failures', async () => {
    const addTask = vi.fn((task: { albumId: string }) => ({ id: `task-${task.albumId}`, signal: new AbortController().signal }));
    const updateTask = vi.fn();
    const context = makeContext({ addTask, updateTask });
    const view = render(<Provider value={context}><DownloadButtons items={targets.slice(0, 2)} label="Export" /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: '全部 PDF' }));
    await flush();
    assert.deepEqual(state.getPhoto.mock.calls.map((call) => call[0]), ['1', '2']);

    view.rerender(<Provider value={{ ...context, tasks: [{ id: 'active', albumId: '1', name: 'First', format: 'zip', stage: 'processing', progress: 0, total: 1 }] }}><DownloadButtons items={[targets[1]]} /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: 'ZIP' }));
    await flush();
    assert.equal(addTask.mock.calls.filter((call) => call[0].format === 'zip').length, 0);

    state.getPhoto.mockRejectedValueOnce(new Error('export failed'));
    fireEvent.click(screen.getByRole('button', { name: 'CBZ' }));
    await waitFor(() => assert.ok(updateTask.mock.calls.some((call) => call[1].stage === 'error')));
  });

  test('disables invalid ranges and queues individual and combined series downloads', async () => {
    const addTask = vi.fn((task: { albumId: string }) => ({ id: `task-${task.albumId}`, signal: new AbortController().signal }));
    const updateTask = vi.fn();
    const context = makeContext({ addTask, updateTask });
    render(<Provider value={context}><SeriesDownloadManager albumName="Series" items={targets} /></Provider>);

    const start = screen.getByLabelText('起始话数');
    const end = screen.getByLabelText('结束话数');
    fireEvent.change(start, { target: { value: '3' } });
    fireEvent.change(end, { target: { value: '2' } });
    assert.equal(screen.getByRole('button', { name: 'PDF' }).hasAttribute('disabled'), true);

    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getByRole('button', { name: 'ZIP' }));
    await waitFor(() => assert.equal(state.getPhoto.mock.calls.length, 3));
    fireEvent.click(screen.getByRole('button', { name: '后 10 话' }));
    fireEvent.click(screen.getByRole('button', { name: '前 10 话' }));
    fireEvent.click(screen.getByRole('button', { name: '合并为一个' }));
    fireEvent.click(screen.getByRole('button', { name: 'CBZ' }));
    await waitFor(() => assert.equal(state.getBatchPhoto.mock.calls.length, 1));
    assert.equal(state.exportFile.mock.calls.at(-1)?.[0].filename, 'Series [1-3].cbz');
  });

  test('suppresses active series tasks and records individual and combined failures', async () => {
    const updateTask = vi.fn();
    const addTask = vi.fn((task: { albumId: string }) => ({ id: `task-${task.albumId}`, signal: new AbortController().signal }));
    const active: DownloadTask = { id: 'active', albumId: '1', name: 'First', format: 'pdf', stage: 'processing', progress: 0, total: 1 };
    const view = render(<Provider value={makeContext({ tasks: [active], addTask, updateTask })}><SeriesDownloadManager albumName="Series" items={targets} /></Provider>);
    fireEvent.change(screen.getByLabelText('结束话数'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    assert.equal(addTask.mock.calls.length, 0);

    view.rerender(<Provider value={makeContext({ addTask, updateTask })}><SeriesDownloadManager albumName="Series" items={targets} /></Provider>);
    state.getPhoto.mockRejectedValueOnce(new Error('single failed'));
    fireEvent.change(screen.getByLabelText('结束话数'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '多个文件' }));
    fireEvent.click(screen.getByRole('button', { name: 'ZIP' }));
    await waitFor(() => assert.ok(updateTask.mock.calls.some((call) => call[1].error === 'single failed')));

    state.getBatchPhoto.mockRejectedValueOnce(new Error('combined failed'));
    fireEvent.click(screen.getByRole('button', { name: '合并为一个' }));
    fireEvent.click(screen.getByRole('button', { name: 'CBZ' }));
    await waitFor(() => assert.ok(updateTask.mock.calls.some((call) => call[1].error === 'combined failed')));

    const combinedId = 'combined:1';
    view.rerender(<Provider value={makeContext({ tasks: [{ ...active, albumId: combinedId, format: 'cbz' }], addTask, updateTask })}><SeriesDownloadManager albumName="Series" items={targets} /></Provider>);
    fireEvent.change(screen.getByLabelText('结束话数'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: '合并为一个' }));
    const before = addTask.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'CBZ' }));
    assert.equal(addTask.mock.calls.length, before);
  });

  test('renders task progress, errors, collapse, removal, clear, close, and empty state', () => {
    const tasks: DownloadTask[] = [
      { id: 'a', albumId: '1', name: 'Active', format: 'pdf', stage: 'processing', progress: 1, total: 2 },
      { id: 'b', albumId: '2', name: 'Final', format: 'zip', stage: 'finalizing', progress: 0, total: 0 },
      { id: 'c', albumId: '3', name: 'Done', format: 'cbz', stage: 'completed', progress: 3, total: 3 },
      { id: 'd', albumId: '4', name: 'Failed', format: 'pdf', stage: 'error', progress: 0, total: 1, error: 'Network error' },
    ];
    const removeTask = vi.fn();
    const clearCompleted = vi.fn();
    const onClose = vi.fn();
    const view = render(<Provider value={makeContext({ tasks, removeTask, clearCompleted })}><TaskPanel onClose={onClose} /></Provider>);
    assert.ok(screen.getByText('处理图片'));
    assert.ok(screen.getByText('写入文件'));
    assert.ok(screen.getByText('完成'));
    assert.ok(screen.getByText('错误'));
    assert.ok(screen.getByText('Network error'));
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    assert.equal(clearCompleted.mock.calls.length, 1);
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    assert.equal(onClose.mock.calls.length, 1);
    fireEvent.click(screen.getByText('下载 (2进行中)').parentElement!.parentElement!);
    assert.equal(screen.queryByText('Network error'), null);
    fireEvent.click(screen.getByText('下载 (2进行中)').parentElement!.parentElement!);
    fireEvent.click(screen.getAllByRole('button').at(-1)!);
    assert.ok(removeTask.mock.calls.length > 0);

    view.rerender(<Provider value={makeContext()}><TaskPanel onClose={onClose} /></Provider>);
    assert.equal(view.container.firstChild, null);
  });
});
