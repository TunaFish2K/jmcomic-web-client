import assert from 'node:assert/strict';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  useQuery: vi.fn(),
  queryConfig: null as null | Record<string, unknown>,
  query: {} as Record<string, unknown>,
  getBatchAlbum: vi.fn(),
  getCachedAlbum: vi.fn(),
  setCachedAlbum: vi.fn(),
  saveAlbumMeta: vi.fn(),
  getLatestProgress: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => state.navigate }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (config: Record<string, unknown>) => {
    state.queryConfig = config;
    state.useQuery(config);
    return state.query;
  },
}));
vi.mock('@heroui/react', () => ({
  Button: ({ children, onPress, ...props }: { children: ReactNode; onPress?: () => void }) => <button type="button" onClick={onPress} {...props}>{children}</button>,
}));
vi.mock('../src/api', () => ({ getBatchAlbum: state.getBatchAlbum }));
vi.mock('../src/album-cache', () => ({ getCachedAlbum: state.getCachedAlbum, setCachedAlbum: state.setCachedAlbum }));
vi.mock('../src/reader/reader-store', () => ({ saveAlbumMeta: state.saveAlbumMeta, getLatestChapterProgress: state.getLatestProgress }));
vi.mock('../src/home/CoverImage', () => ({ CoverImage: ({ albumId }: { albumId: string }) => <img alt={`cover-${albumId}`} /> }));
vi.mock('../src/home/SeriesDownloadManager', () => ({ SeriesDownloadManager: ({ albumName }: { albumName: string }) => <div data-testid="series-download">{albumName}</div> }));
vi.mock('../src/home/DownloadButtons', () => ({
  previewFullActionButtonClass: 'preview-action',
  DownloadButtons: ({ items }: { items: Array<{ id: string }> }) => <div data-testid="downloads">{items.map((item) => item.id).join(',')}</div>,
}));

import { AlbumCard } from '../src/home/AlbumCard';
import { AlbumModal } from '../src/home/AlbumModal';

const singleAlbum = {
  id: '10', name: 'Single album', totalViews: '100', likes: '20',
  author: ['Author'], tags: ['Tag'], works: ['Work'], actors: ['Actor'],
  series: [], seriesID: '',
};
const singlePhoto = { id: '10', name: 'Single', scrambleId: 0, images: [{ name: '0.jpg', url: 'cover.jpg' }, { name: '1.jpg', url: 'page.jpg' }] };
const seriesAlbum = {
  ...singleAlbum,
  id: 'root', name: 'Series album', seriesID: 'root',
  series: [
    { id: '2', name: '', sort: '2' },
    { id: '1', name: 'Opening', sort: '1' },
  ],
};

function setQuery(overrides: Record<string, unknown> = {}) {
  state.query = {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('AlbumModal', () => {
  beforeEach(() => {
    state.navigate.mockReset();
    state.useQuery.mockReset();
    state.queryConfig = null;
    state.getBatchAlbum.mockReset();
    state.getCachedAlbum.mockReset().mockResolvedValue(null);
    state.setCachedAlbum.mockReset().mockResolvedValue(undefined);
    state.saveAlbumMeta.mockReset();
    state.getLatestProgress.mockReset().mockReturnValue(null);
    setQuery();
  });

  test('loads persisted and remote details through the query function', async () => {
    setQuery({ data: { albumId: '10', album: singleAlbum, photo: singlePhoto } });
    render(<AlbumModal albumId="10" cachedData={undefined} onClose={vi.fn()} />);
    const config = state.queryConfig as { queryKey: unknown[]; queryFn: (context: { signal: AbortSignal }) => Promise<unknown>; initialData?: unknown };
    assert.deepEqual(config.queryKey, ['album-detail', '10']);
    const signal = new AbortController().signal;

    state.getCachedAlbum.mockResolvedValueOnce({ album: singleAlbum, photo: singlePhoto });
    assert.deepEqual(await config.queryFn({ signal }), { albumId: '10', album: singleAlbum, photo: singlePhoto });
    assert.equal(state.getBatchAlbum.mock.calls.length, 0);

    state.getCachedAlbum.mockResolvedValueOnce(null);
    state.getBatchAlbum.mockResolvedValueOnce([{ albumId: '10', album: singleAlbum, photo: singlePhoto }]);
    await config.queryFn({ signal });
    assert.deepEqual(state.getBatchAlbum.mock.calls[0], [['10'], signal]);
    assert.equal(state.setCachedAlbum.mock.calls.length, 1);

    state.getCachedAlbum.mockResolvedValueOnce(null);
    state.getBatchAlbum.mockResolvedValueOnce([]);
    await assert.rejects(config.queryFn({ signal }), /未返回该本子/);
  });

  test('renders single metadata, closes correctly, and opens online reading', () => {
    const onClose = vi.fn();
    setQuery({ data: { albumId: '10', album: singleAlbum, photo: singlePhoto } });
    render(<AlbumModal albumId="10" cachedData={undefined} onClose={onClose} />);
    assert.ok(screen.getByText('Single album'));
    assert.ok(screen.getByText('2 页'));
    for (const text of ['Author', 'Tag', 'Work', 'Actor']) assert.ok(screen.getByText(text));
    assert.ok(screen.getByAltText('cover-10'));
    fireEvent.click(screen.getByRole('button', { name: '在线观看' }));
    assert.deepEqual(state.navigate.mock.calls[0], ['/reader/10', { state: { album: singleAlbum, photo: singlePhoto } }]);
    assert.equal(state.saveAlbumMeta.mock.calls.length, 1);

    const backdrop = screen.getByText('Single album').closest('.fixed')!;
    fireEvent.click(screen.getByText('Single album'));
    assert.equal(onClose.mock.calls.length, 0);
    fireEvent.click(backdrop);
    assert.equal(onClose.mock.calls.length, 1);
  });

  test('sorts series, restores progress, and builds chapter navigation state', () => {
    state.getLatestProgress.mockReturnValue({ chapterId: '2', page: 4 });
    setQuery({ data: { albumId: 'root', album: seriesAlbum, photo: singlePhoto } });
    render(<AlbumModal albumId="root" cachedData={undefined} onClose={vi.fn()} />);
    assert.ok(screen.getByText('2 话'));
    assert.ok(screen.getByText('继续阅读：第2章 · 第 5 页'));
    assert.ok(screen.getByTestId('series-download'));
    fireEvent.click(screen.getByRole('button', { name: /继续阅读/ }));
    assert.equal(state.navigate.mock.calls[0][0], '/reader/2');
    const chapterButtons = screen.getAllByRole('button', { name: '在线观看' });
    fireEvent.click(chapterButtons[0]);
    assert.equal(state.navigate.mock.calls[1][0], '/reader/1');
    assert.deepEqual(state.navigate.mock.calls[1][1].state.seriesItems.map((item: { id: string }) => item.id), ['1', '2']);
  });

  test('renders pending, item errors, query errors, and retries', async () => {
    setQuery({ isPending: true });
    const view = render(<AlbumModal albumId="10" cachedData={undefined} onClose={vi.fn()} />);
    assert.ok(screen.getByText('加载中...'));

    const refetch = vi.fn();
    setQuery({ data: { albumId: '10', album: null, photo: null, error: { message: 'bad', stage: 'get_photo', domain: 'cdn', reference: 'x' } }, refetch });
    view.rerender(<AlbumModal albumId="10" cachedData={undefined} onClose={vi.fn()} />);
    assert.ok(screen.getByText(/bad \(阶段: get_photo/));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    assert.equal(refetch.mock.calls.length, 1);

    setQuery({ isError: true, error: new Error('network failed'), refetch });
    view.rerender(<AlbumModal albumId="10" cachedData={undefined} onClose={vi.fn()} />);
    assert.ok(screen.getByText('network failed'));
    setQuery({ isError: true, error: 'unknown', refetch });
    view.rerender(<AlbumModal albumId="10" cachedData={undefined} onClose={vi.fn()} />);
    assert.ok(screen.getByText('详情加载失败'));
    await waitFor(() => assert.ok(state.useQuery.mock.calls.length >= 4));
  });
});

describe('AlbumCard', () => {
  test('renders a cover or placeholder, forwards refs, and opens the album', () => {
    const onClick = vi.fn();
    const cardRef = vi.fn();
    const view = render(<AlbumCard item={{ id: '10', name: 'Card', author: 'Writer' }} cachedData={undefined} onClick={onClick} cardRef={cardRef} />);
    assert.ok(screen.getByText('Card'));
    assert.equal(screen.queryByAltText('cover-10'), null);
    fireEvent.click(screen.getByText('Card'));
    assert.equal(onClick.mock.calls.length, 1);
    assert.ok(cardRef.mock.calls.some((call) => call[0] instanceof HTMLDivElement));

    view.rerender(<AlbumCard item={{ id: '10', name: 'Card', author: 'Writer' }} cachedData={{ albumId: '10', album: singleAlbum, photo: singlePhoto }} onClick={onClick} cardRef={cardRef} />);
    assert.ok(screen.getByAltText('cover-10'));
  });
});
