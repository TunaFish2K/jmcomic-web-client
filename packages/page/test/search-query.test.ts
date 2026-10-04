import assert from 'node:assert/strict';
import { beforeEach, describe, test, vi } from 'vitest';
import { normalizeTerm, parseQuery, parseToken, serializeQuery, upsertToken } from '../src/search/query';
import { termSearchUrl } from '../src/search/term-url';
import { importCachedAlbums, recordAlbum, recordSearch, suggest, VOCABULARY_KEY, VOCABULARY_LIMIT } from '../src/search/vocabulary';

describe('search query model (upstream rules measured against /search)', () => {
  test('plain terms are OR; any + makes the whole query AND; - excludes', () => {
    assert.deepEqual(parseQuery('Blue Archive'), { mode: 'any', tokens: [{ text: 'Blue', exclude: false }, { text: 'Archive', exclude: false }] });
    assert.equal(parseQuery('MANA +無修正').mode, 'all');
    assert.equal(parseQuery('+MANA 無修正').mode, 'all');
    assert.deepEqual(parseQuery('MANA -無修正').tokens, [{ text: 'MANA', exclude: false }, { text: '無修正', exclude: true }]);
    assert.equal(parseQuery('MANA -無修正').mode, 'all');
    assert.deepEqual(parseQuery('-MANA'), { mode: 'all', tokens: [{ text: 'MANA', exclude: true }] });
  });

  test('splits on ASCII, full-width and repeated spaces and commas; drops bare operators', () => {
    assert.deepEqual(parseQuery(' a　b,c，d  + - e ').tokens.map((token) => token.text), ['a', 'b', 'c', 'd', 'e']);
    assert.equal(parseToken('+'), null);
    assert.equal(parseToken('  '), null);
    assert.deepEqual(parseToken('--x'), { text: 'x', exclude: true });
  });

  test('a term appears once; the latest include/exclude wins (+x -x would match nothing)', () => {
    assert.deepEqual(parseQuery('+巨乳 -巨乳').tokens, [{ text: '巨乳', exclude: true }]);
    assert.deepEqual(upsertToken([{ text: 'MANA', exclude: false }], { text: 'mana', exclude: true }), [{ text: 'mana', exclude: true }]);
    assert.equal(normalizeTerm('ＭＡＮＡ'), 'mana');
  });

  test('serializes AND with + only when two or more terms are included, keeping old URLs stable', () => {
    assert.equal(serializeQuery(parseQuery('MANA')), 'MANA');
    assert.equal(serializeQuery(parseQuery('MANA -無修正')), 'MANA -無修正');
    assert.equal(serializeQuery(parseQuery('+巨乳 +NTR -中文')), '+巨乳 +NTR -中文');
    assert.equal(serializeQuery(parseQuery('Blue Archive')), 'Blue Archive');
    assert.equal(serializeQuery({ mode: 'all', tokens: parseQuery('Blue Archive').tokens }), '+Blue +Archive');
    assert.equal(serializeQuery({ mode: 'any', tokens: [] }), '');
  });

  test('builds album term search URLs', () => {
    const none = new URLSearchParams();
    assert.equal(termSearchUrl('only', '巨乳', 'tag', none), '/?q=%E5%B7%A8%E4%B9%B3&cat=3&page=1');
    assert.equal(termSearchUrl('add', 'MANA', 'author', none), '/?q=MANA&cat=2&page=1');
    assert.equal(termSearchUrl('exclude', 'NTR', 'tag', none), '/?q=-NTR&cat=0&page=1');
    const current = new URLSearchParams({ q: '巨乳', cat: '0', order: 'mv', time: 'w', page: '3' });
    assert.equal(new URLSearchParams(termSearchUrl('add', 'NTR', 'tag', current).slice(2)).get('q'), '+巨乳 +NTR');
    const excluded = new URLSearchParams(termSearchUrl('exclude', 'NTR', 'actor', current).slice(2));
    assert.deepEqual(Object.fromEntries(excluded), { q: '巨乳 -NTR', cat: '0', order: 'mv', time: 'w', page: '1' });
    assert.equal(new URLSearchParams(termSearchUrl('only', '初音', 'actor', current).slice(2)).get('cat'), '4');
    assert.equal(new URLSearchParams(termSearchUrl('only', 'X', 'work', current).slice(2)).get('cat'), '0');
    const phrase = new URLSearchParams(termSearchUrl('only', 'Blue Archive', 'work', current).slice(2));
    assert.equal(phrase.get('q'), '+Blue +Archive');
    assert.equal(new URLSearchParams(termSearchUrl('add', 'Blue Archive', 'tag', new URLSearchParams({ q: 'a b' })).slice(2)).get('q'), 'a b Blue Archive');
  });
});

describe('local search vocabulary', () => {
  beforeEach(() => localStorage.clear());

  test('records album terms and searches, and suggests prefix matches first', () => {
    recordAlbum({ tags: ['巨乳', '中文', '全彩'], author: ['MANA'], actors: ['初音未來'], works: ['VOCALOID'] }, 1);
    recordSearch([{ text: '巨乳', exclude: false }, { text: 'Blue', exclude: true }], 2);
    recordSearch([{ text: '中文全彩', exclude: false }], 3);
    assert.deepEqual(suggest('巨').map((term) => [term.text, term.kind, term.count]), [['巨乳', 'tag', 2]]);
    assert.deepEqual(suggest('全彩').map((term) => term.text), ['全彩', '中文全彩']);
    assert.deepEqual(suggest('中文').map((term) => term.text), ['中文全彩', '中文']);
    assert.deepEqual(suggest('-mana').map((term) => [term.text, term.kind]), [['MANA', 'author']]);
    assert.deepEqual(suggest('初', ['初音未來']), []);
    assert.deepEqual(suggest('  '), []);
    assert.equal(suggest('voc')[0]!.kind, 'work');
    assert.equal(suggest('blue')[0]!.kind, 'history');
  });

  test('keeps the most recent entries within the limit and ignores junk', () => {
    const tags = Array.from({ length: VOCABULARY_LIMIT + 10 }, (_, index) => `t${index}`);
    recordAlbum({ tags, author: ['', 'x'.repeat(61)] }, 5);
    recordAlbum({ tags: ['newest'] }, 9);
    const stored = JSON.parse(localStorage.getItem(VOCABULARY_KEY)!) as Array<{ text: string }>;
    assert.equal(stored.length, VOCABULARY_LIMIT);
    assert.equal(stored[0]!.text, 'newest');
    localStorage.setItem(VOCABULARY_KEY, 'not json');
    assert.deepEqual(suggest('t'), []);
    localStorage.setItem(VOCABULARY_KEY, JSON.stringify({}));
    assert.deepEqual(suggest('t'), []);
  });

  test('imports albums cached by the reader once', () => {
    localStorage.setItem('reader-album-cache:1', JSON.stringify({ album: { tags: ['純愛'], author: ['A'] }, updatedAt: 7 }));
    localStorage.setItem('reader-album-cache:2', '{');
    importCachedAlbums();
    assert.deepEqual(suggest('純').map((term) => term.text), ['純愛']);
    localStorage.setItem('reader-album-cache:3', JSON.stringify({ album: { tags: ['NTR'] } }));
    importCachedAlbums();
    assert.deepEqual(suggest('ntr'), []);
  });

  test('degrades to no suggestions when storage is unavailable', () => {
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    assert.doesNotThrow(() => recordAlbum({ tags: ['x'] }));
    assert.doesNotThrow(() => importCachedAlbums());
    assert.deepEqual(suggest('x'), []);
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
