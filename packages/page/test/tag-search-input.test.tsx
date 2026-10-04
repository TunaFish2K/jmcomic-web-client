import assert from 'node:assert/strict';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, test, vi } from 'vitest';
import { useTagSearch } from '../src/search/useTagSearch';
import { TagChips, TagSuggestions } from '../src/search/TagSearchParts';
import { TermMenu } from '../src/search/TermMenu';
import { recordAlbum } from '../src/search/vocabulary';

let submitted: string[] = [];
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  const search = useTagSearch({ value, onChange: setValue });
  return (
    <form onSubmit={(event) => { event.preventDefault(); submitted.push(value); }}>
      <TagChips search={search} />
      <input name="query" aria-label="搜索内容" value={search.draft} onChange={search.onInputChange} onKeyDown={search.onKeyDown}
        onFocus={search.onFocus} onBlur={search.onBlur} />
      <TagSuggestions search={search} />
      <output data-testid="value">{value}</output>
      <button type="button" onClick={() => setValue('外部 -导航')}>navigate</button>
    </form>
  );
}
const value = () => screen.getByTestId('value').textContent;
const input = () => screen.getByLabelText('搜索内容') as HTMLInputElement;
const chips = () => screen.queryAllByRole('listitem').map((item) => item.textContent);
const type = (text: string) => fireEvent.change(input(), { target: { value: text } });

beforeEach(() => { submitted = []; localStorage.clear(); });

describe('tag search box', () => {
  test('separators turn text into chips; the draft is part of the query; - makes an exclude chip', () => {
    render(<Harness />);
    type('巨乳');
    assert.equal(value(), '巨乳');
    assert.deepEqual(chips(), []);
    type('巨乳 ');
    assert.deepEqual(chips(), ['巨乳']);
    assert.equal(input().value, '');
    type('NTR,-中文');
    assert.deepEqual(chips(), ['巨乳', 'NTR']);
    assert.equal(input().value, '-中文');
    assert.equal(value(), '+巨乳 +NTR -中文');
    fireEvent.keyDown(input(), { key: 'Enter' });
    assert.deepEqual(chips(), ['巨乳', 'NTR', '−中文']);
  });

  test('chips toggle include/exclude, can be removed, and Backspace removes the last one', () => {
    render(<Harness initial="+巨乳 +NTR" />);
    fireEvent.click(screen.getByRole('button', { name: '包含：NTR，点击改为排除' }));
    assert.equal(value(), '巨乳 -NTR');
    fireEvent.click(screen.getByRole('button', { name: '排除：NTR，点击改为包含' }));
    fireEvent.click(screen.getByRole('button', { name: '移除 巨乳' }));
    assert.equal(value(), 'NTR');
    fireEvent.keyDown(input(), { key: 'Backspace' });
    assert.equal(value(), '');
    fireEvent.keyDown(input(), { key: 'Backspace' });
    assert.equal(value(), '');
  });

  test('the all/any switch appears with two included terms and keeps legacy OR links', () => {
    render(<Harness initial="Blue Archive" />);
    const toggle = screen.getByRole('button', { name: '匹配方式：任一包含' });
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    fireEvent.click(toggle);
    assert.equal(value(), '+Blue +Archive');
    assert.equal(screen.getByRole('button', { name: '匹配方式：全部包含' }).getAttribute('aria-pressed'), 'true');
  });

  test('Tab and blur finish the draft; outside navigation replaces the chips', () => {
    render(<Harness />);
    type('a');
    fireEvent.keyDown(input(), { key: 'Tab' });
    assert.deepEqual(chips(), ['a']);
    type('b');
    fireEvent.blur(input());
    assert.deepEqual(chips(), ['a', 'b']);
    fireEvent.keyDown(input(), { key: 'Tab' });
    fireEvent.click(screen.getByRole('button', { name: 'navigate' }));
    assert.deepEqual(chips(), ['外部', '−导航']);
  });

  test('suggestions come from local vocabulary and work with keyboard and mouse', () => {
    recordAlbum({ tags: ['巨乳', '巨根'], author: ['巨匠'] });
    render(<Harness initial="巨根" />);
    fireEvent.focus(input());
    type('-巨');
    const options = () => screen.queryAllByRole('option');
    assert.deepEqual(options().map((option) => option.textContent?.slice(0, 2)), ['巨乳', '巨匠']);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    fireEvent.keyDown(input(), { key: 'ArrowUp' });
    assert.equal(options()[1]!.getAttribute('aria-selected'), 'true');
    fireEvent.keyDown(input(), { key: 'Enter' });
    assert.equal(value(), '巨根 -巨匠');
    type('巨');
    fireEvent.keyDown(input(), { key: 'Escape' });
    assert.equal(options().length, 0);
    fireEvent.focus(input());
    type('巨乳');
    fireEvent.mouseDown(options()[0]!);
    fireEvent.click(options()[0]!);
    assert.equal(value(), '+巨根 -巨匠 +巨乳');
  });
});

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

describe('album term menu', () => {
  test('offers search only, add to the current search, and exclude', async () => {
    const onSearch = vi.fn();
    render(
      <MemoryRouter initialEntries={['/?q=%E5%B7%A8%E4%B9%B3&cat=0']}>
        <Routes><Route path="/" element={<TermMenu text="NTR" kind="tag" className="tag" onSearch={onSearch} />} /></Routes>
        <Location />
      </MemoryRouter>,
    );
    const open = async (item: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'NTR：搜索选项' }));
      fireEvent.click(await within(await screen.findByRole('menu')).findByRole('menuitem', { name: item }));
    };
    await open('加入当前搜索');
    assert.equal(new URLSearchParams(screen.getByTestId('location').textContent!.slice(2)).get('q'), '+巨乳 +NTR');
    await open('排除');
    // A single included term needs no + (it matches the same).
    assert.equal(new URLSearchParams(screen.getByTestId('location').textContent!.slice(2)).get('q'), '巨乳 -NTR');
    await open('只搜这个');
    assert.equal(screen.getByTestId('location').textContent, '/?q=NTR&cat=3&page=1');
    assert.equal(onSearch.mock.calls.length, 3);
  });
});
