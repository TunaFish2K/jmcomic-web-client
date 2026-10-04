import assert from 'node:assert/strict';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, test, vi } from 'vitest';
import { Pager } from '../src/ui/Pager';
import { AppDialog } from '../src/ui/AppDialog';
import { EmptyBlock, ErrorBlock, InlineSpinner, LoadingState, Notice } from '../src/ui/feedback';
import { Segmented, SettingSwitch } from '../src/ui/controls';
import { AlbumCard } from '../src/home/AlbumCard';
import { useExtendedShell } from '../src/extended/shell';

describe('shared UI components', () => {
  test('pager shows first/last only with a known total and disables at the edges', () => {
    const onChange = vi.fn();
    const view = render(<Pager page={1} hasPrev={false} hasNext onChange={onChange} />);
    assert.ok(screen.queryByRole('button', { name: '首页' }) === null);
    assert.ok(screen.getByText('第 1 页'));
    assert.equal((screen.getByRole('button', { name: '上页' }) as HTMLButtonElement).disabled, true);
    fireEvent.click(screen.getByRole('button', { name: '下页' }));
    assert.deepEqual(onChange.mock.calls[0], [2]);

    view.rerender(<Pager page={2} hasPrev hasNext={false} totalPages={3} onChange={onChange} />);
    assert.ok(screen.getByText('第 2 / 3 页'));
    fireEvent.click(screen.getByRole('button', { name: '首页' }));
    fireEvent.click(screen.getByRole('button', { name: '上页' }));
    fireEvent.click(screen.getByRole('button', { name: '尾页' }));
    assert.deepEqual(onChange.mock.calls.slice(1), [[1], [1], [3]]);

    view.rerender(<Pager page={3} hasPrev hasNext={false} totalPages={3} label="共 9 本" isDisabled onChange={onChange} />);
    assert.ok(screen.getByText('共 9 本'));
    assert.equal((screen.getByRole('button', { name: '首页' }) as HTMLButtonElement).disabled, true);
  });

  test('dialog closes with its close button and Escape, and supports custom headers, footers and dark tone', () => {
    const onClose = vi.fn();
    const view = render(<AppDialog title="Title" onClose={onClose} footer={<span>Footer</span>}>Body</AppDialog>);
    assert.ok(screen.getByRole('dialog', { name: 'Title' }));
    assert.ok(screen.getByRole('heading', { name: 'Title' }));
    assert.ok(screen.getByText('Footer'));
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    assert.equal(onClose.mock.calls.length, 1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    assert.equal(onClose.mock.calls.length, 2);

    view.rerender(<AppDialog title="Dark" tone="dark" header={<strong>Custom</strong>} size="sm" onClose={onClose}>Body</AppDialog>);
    assert.ok(screen.getByText('Custom'));
    assert.ok(screen.queryByRole('heading', { name: 'Dark' }) === null);
    assert.ok(document.querySelector('.dark'));
  });

  test('feedback states expose the right roles', () => {
    const onRetry = vi.fn();
    render(<>
      <Notice tone="error">Broken</Notice>
      <Notice tone="success" action={<button type="button">Act</button>}>Saved</Notice>
      <Notice>Info</Notice>
      <LoadingState />
      <LoadingState label="正在搜索..." compact />
      <EmptyBlock>Nothing</EmptyBlock>
      <EmptyBlock compact>Nothing either</EmptyBlock>
      <ErrorBlock message="Failed" onRetry={onRetry} />
      <ErrorBlock message="No retry" />
      <InlineSpinner />
    </>);
    assert.ok(screen.getAllByRole('alert').some((node) => node.textContent?.includes('Broken')));
    assert.ok(screen.getAllByRole('status').some((node) => node.textContent?.includes('Saved')));
    assert.ok(screen.getByText('加载中...'));
    assert.ok(screen.getByText('正在搜索...'));
    assert.ok(screen.getByRole('button', { name: 'Act' }));
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    assert.equal(onRetry.mock.calls.length, 1);
  });

  test('segmented control and switch report changes', () => {
    const onTab = vi.fn();
    const onSwitch = vi.fn();
    render(<>
      <Segmented label="Mode" value="a" options={[['a', 'Alpha'], ['b', 'Beta']] as const} onChange={onTab} fullWidth />
      <SettingSwitch label="Feature" description="Explains it" checked={false} onChange={onSwitch} />
    </>);
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    assert.deepEqual(onTab.mock.calls.at(-1), ['b']);
    fireEvent.click(screen.getByRole('switch', { name: 'Feature' }));
    assert.deepEqual(onSwitch.mock.calls.at(-1), [true]);
    assert.ok(screen.getByText('Explains it'));
  });

  test('album cards open from the keyboard', () => {
    const onClick = vi.fn();
    render(<AlbumCard item={{ id: '7', name: 'Keyboard card', author: 'A' }} cachedData={undefined} onClick={onClick} />);
    const card = screen.getByRole('button', { name: 'Keyboard card' });
    assert.equal(card.getAttribute('tabindex'), '0');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.keyDown(card, { key: 'a' });
    assert.equal(onClick.mock.calls.length, 2);
  });

  test('extended shell hook requires its provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    assert.throws(() => renderHook(() => useExtendedShell()), /inside the extended shell/);
  });
});
