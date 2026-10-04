import { JmError, asError, checkSignal, id, integer } from './errors.js';
import { Upstream } from './upstream.js';
import type { AccountCredentials, AppRequest, NetworkOptions } from './upstream.js';
import type { CallOptions } from './types.js';

export type { AccountCredentials } from './upstream.js';

/** A comic card as returned by list endpoints such as /promote, /latest and /favorite. */
export interface MobileComic {
  id: string; name: string; author: string; image: string;
  category: { id: string; title: string } | null;
  liked: boolean | null; favorite: boolean | null; updatedAt: number | null;
}
export interface MobileSection { id: string; title: string; type: string; filterValue: string; items: MobileComic[] }
export interface MobileComicPage { total: number; items: MobileComic[] }
export interface MobileCategories {
  categories: { id: string; name: string; slug: string; total: number }[];
  blocks: { title: string; tags: string[] }[];
}
export interface MobileWeek { periods: { id: string; title: string; time: string }[]; types: { id: string; title: string }[] }
/** Comments arrive as a flat list; a reply points at its parent through `parentId`. */
export interface MobileComment {
  id: string; parentId: string | null; albumId: string; userId: string; username: string; content: string;
  likes: number; createdAt: string; spoiler: boolean;
}
/** Profile fields shown to the user. The raw record is kept so updates can resend unchanged fields. */
export interface MobileMember { uid: string; username: string; email: string; level: string; coin: number; raw: Record<string, unknown> }
export interface LoginResult { account: AccountCredentials; member: MobileMember }
/** Result of a write call. `message` is the upstream text, already limited in length. */
export interface MobileWriteResult { ok: boolean; message: string; data: Record<string, unknown> }
export type FavoriteFolderEdit =
  | { type: 'add'; name: string }
  | { type: 'edit'; folderId: string; name: string }
  | { type: 'del'; folderId: string }
  | { type: 'move'; folderId: string; albumId: string };

export interface MobileClientOptions extends NetworkOptions { account?: AccountCredentials }
export interface MobileClient {
  readonly account: AccountCredentials | undefined;
  promote(options?: CallOptions): Promise<MobileSection[]>;
  latest(page: number, options?: CallOptions): Promise<MobileComic[]>;
  promoteList(sectionId: string, page: number, options?: CallOptions): Promise<MobileComicPage>;
  serialization(params: { type: string; date: string; page: number }, options?: CallOptions): Promise<MobileComicPage>;
  categories(options?: CallOptions): Promise<MobileCategories>;
  categoryFilter(params: { category: string; order: string; page: number }, options?: CallOptions): Promise<MobileComicPage>;
  week(options?: CallOptions): Promise<MobileWeek>;
  weekFilter(params: { id: string; type: string; page?: number }, options?: CallOptions): Promise<MobileComicPage>;
  hotTags(options?: CallOptions): Promise<string[]>;
  randomRecommend(options?: CallOptions): Promise<MobileComic[]>;
  login(username: string, password: string, options?: CallOptions): Promise<LoginResult>;
  register(params: { username: string; password: string; passwordConfirm: string; email: string; gender: string }, options?: CallOptions): Promise<MobileWriteResult>;
  forgot(email: string, options?: CallOptions): Promise<MobileWriteResult>;
  logout(options?: CallOptions): Promise<MobileWriteResult>;
  favorites(params: { page: number; folderId?: string; order?: string }, options?: CallOptions): Promise<Record<string, unknown>>;
  toggleFavorite(albumId: string, options?: CallOptions): Promise<MobileWriteResult>;
  editFavoriteFolder(edit: FavoriteFolderEdit, options?: CallOptions): Promise<MobileWriteResult>;
  like(albumId: string, options?: CallOptions): Promise<MobileWriteResult>;
  comments(params: { albumId: string; page: number }, options?: CallOptions): Promise<{ total: number; items: MobileComment[] }>;
  comment(params: { albumId: string; content: string; replyTo?: string }, options?: CallOptions): Promise<MobileWriteResult>;
  deleteComment(params: { commentId: string; albumId: string }, options?: CallOptions): Promise<MobileWriteResult>;
  profile(options?: CallOptions): Promise<Record<string, unknown>>;
  updateProfile(fields: Record<string, string>, options?: CallOptions): Promise<MobileWriteResult>;
  daily(options?: CallOptions): Promise<Record<string, unknown>>;
  dailyCheck(dailyId: string, options?: CallOptions): Promise<MobileWriteResult>;
  dailyList(options?: CallOptions): Promise<unknown>;
  dailyFilter(month: string, options?: CallOptions): Promise<unknown>;
  history(page: number, options?: CallOptions): Promise<Record<string, unknown>>;
  removeHistory(albumId: string, options?: CallOptions): Promise<MobileWriteResult>;
  dispose(): void;
}

const text = (value: unknown): string => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const bool = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;

export function comic(value: unknown): MobileComic {
  const item = record(value), category = record(item.category);
  return {
    id: text(item.id), name: text(item.name), author: text(item.author), image: text(item.image),
    category: category.id === undefined ? null : { id: text(category.id), title: text(category.title) },
    liked: bool(item.liked), favorite: bool(item.is_favorite ?? item.favorite),
    updatedAt: item.update_at === undefined || item.update_at === null || item.update_at === '' ? null : num(item.update_at),
  };
}
const comics = (value: unknown): MobileComic[] => list(value).map(comic).filter(item => item.id);
const page = (value: unknown): MobileComicPage => {
  const data = record(value);
  return { total: num(data.total), items: comics(data.content ?? data.list ?? value) };
};
function comment(value: unknown): MobileComment {
  const item = record(value);
  const parent = text(item.parent_CID);
  return {
    id: text(item.CID), parentId: parent && parent !== '0' ? parent : null, albumId: text(item.AID),
    userId: text(item.UID), username: text(item.nickname || item.username), content: text(item.content),
    likes: num(item.likes), createdAt: text(item.addtime), spoiler: text(item.spoiler) === '1',
  };
}
function member(value: unknown): MobileMember {
  const data = record(value);
  return { uid: text(data.uid), username: text(data.username), email: text(data.email), level: text(data.level_name ?? data.level), coin: num(data.coin), raw: data };
}
/** Writes report `status: 'ok'` (favorites, comments) or `status: 1` (history); anything else is a refusal. */
function written(value: unknown): MobileWriteResult {
  const data = record(value);
  const ok = data.status === 'ok' || data.status === 1 || data.status === '1' || data.status === true || data.status === undefined;
  return { ok, message: text(data.msg ?? data.message).slice(0, 200), data };
}
function required(value: string, label: string): string {
  if (!value.trim() || value.length > 4000) throw new JmError('INVALID_ARGUMENT', `Invalid ${label}`);
  return value;
}

/** Client for the official app's discovery and account endpoints. Account state lives in this instance only. */
export function createMobileClient(options: MobileClientOptions = {}): MobileClient {
  const network = new Upstream(options), lifetime = new AbortController();
  let account = options.account;
  async function run(operation: string, path: string, request: AppRequest, call: CallOptions = {}): Promise<unknown> {
    if (lifetime.signal.aborted) throw new JmError('DISPOSED', 'Client is disposed');
    const signal = call.signal ? AbortSignal.any([call.signal, lifetime.signal]) : lifetime.signal;
    try { checkSignal(signal); return await network.call(path, request, signal); }
    catch (cause) { const error = asError(cause); error.operation ??= operation; throw error; }
  }
  function signedIn(): AccountCredentials {
    if (!account) throw new JmError('UNAUTHORIZED', 'Login required');
    return account;
  }
  const read = (operation: string, path: string, query: Record<string, string>, call?: CallOptions, auth = false) =>
    run(operation, path, { query, account: auth ? signedIn() : account }, call);
  const write = async (operation: string, path: string, form: Record<string, string>, call?: CallOptions) =>
    written(await run(operation, path, { method: 'POST', form, account: signedIn(), write: true }, call));
  return {
    get account() { return account; },
    promote: async call => list(await read('promote', '/promote', {}, call)).map(value => {
      const section = record(value);
      return { id: text(section.id), title: text(section.title), type: text(section.type), filterValue: text(section.filter_val), items: comics(section.content) };
    }),
    latest: async (pageNumber, call) => comics(await read('latest', '/latest', { page: String(integer(pageNumber, 0, 10000, 'page')) }, call)),
    promoteList: async (sectionId, pageNumber, call) =>
      page(await read('promote-list', '/promote_list', { id: id(sectionId), page: String(integer(pageNumber, 0, 10000, 'page')) }, call)),
    serialization: async ({ type, date, page: pageNumber }, call) => page(await read('serialization', '/serialization',
      { type: required(type, 'type'), date: required(date, 'date'), page: String(integer(pageNumber, 1, 10000, 'page')) }, call)),
    categories: async call => {
      const data = record(await read('categories', '/categories', {}, call));
      return {
        categories: list(data.categories).map(value => { const item = record(value); return { id: text(item.id), name: text(item.name), slug: text(item.slug), total: num(item.total_albums) }; }),
        blocks: list(data.blocks).map(value => { const item = record(value); return { title: text(item.title), tags: list(item.content).map(text).filter(Boolean) }; }),
      };
    },
    categoryFilter: async ({ category, order, page: pageNumber }, call) =>
      page(await read('category-filter', '/categories/filter', { c: category, o: order, page: String(integer(pageNumber, 1, 10000, 'page')) }, call)),
    week: async call => {
      const data = record(await read('week', '/week', {}, call));
      return {
        periods: list(data.categories).map(value => { const item = record(value); return { id: text(item.id), title: text(item.title), time: text(item.time) }; }),
        types: list(data.type).map(value => { const item = record(value); return { id: text(item.id), title: text(item.title) }; }),
      };
    },
    weekFilter: async ({ id: weekId, type, page: pageNumber }, call) => page(await read('week-filter', '/week/filter',
      { id: required(weekId, 'week'), type: required(type, 'type'), ...(pageNumber ? { page: String(integer(pageNumber, 1, 10000, 'page')) } : {}) }, call)),
    hotTags: async call => list(await read('hot-tags', '/hot_tags', {}, call)).map(text).filter(Boolean),
    randomRecommend: async call => comics(await read('random-recommend', '/random_recommend', {}, call)),
    async login(username, password, call) {
      const data = record(await run('login', '/login', { method: 'POST', form: { username: required(username, 'username'), password: required(password, 'password') }, write: true }, call));
      const credentials = { uid: text(data.uid), jwt: text(data.jwttoken), avs: text(data.s) };
      if (!credentials.uid || !credentials.jwt) throw new JmError('INVALID_RESPONSE', 'Login response lacks account credentials');
      account = credentials;
      return { account: credentials, member: member(data) };
    },
    register: async (params, call) => written(await run('register', '/register', { method: 'POST', write: true, form: {
      username: required(params.username, 'username'), password: required(params.password, 'password'),
      password_confirm: required(params.passwordConfirm, 'password confirmation'), email: required(params.email, 'email'), gender: params.gender,
    } }, call)),
    forgot: async (email, call) => written(await run('forgot', '/forgot', { method: 'POST', write: true, form: { email: required(email, 'email') } }, call)),
    async logout(call) {
      const result = await write('logout', '/logout', {}, call);
      account = undefined;
      return result;
    },
    favorites: async ({ page: pageNumber, folderId = '0', order = 'mr' }, call) => record(await read('favorites', '/favorite',
      { page: String(integer(pageNumber, 1, 10000, 'page')), folder_id: folderId, o: order }, call, true)),
    toggleFavorite: async (albumId, call) => write('toggle-favorite', '/favorite', { aid: id(albumId) }, call),
    async editFavoriteFolder(edit, call) {
      const form: Record<string, string> = { type: edit.type };
      if (edit.type === 'add' || edit.type === 'edit') form.folder_name = required(edit.name, 'folder name');
      if (edit.type !== 'add') form.folder_id = id(edit.folderId);
      if (edit.type === 'move') form.aid = id(edit.albumId);
      return write('edit-favorite-folder', '/favorite_folder', form, call);
    },
    like: async (albumId, call) => write('like', '/like', { id: id(albumId) }, call),
    async comments({ albumId, page: pageNumber }, call) {
      const data = record(await read('comments', '/forum', { mode: 'all', aid: id(albumId), page: String(integer(pageNumber, 1, 10000, 'page')) }, call));
      return { total: num(data.total), items: list(data.list).map(comment) };
    },
    comment: async ({ albumId, content, replyTo }, call) => write('comment', '/comment',
      { aid: id(albumId), comment: required(content, 'comment'), ...(replyTo ? { comment_id: id(replyTo) } : {}) }, call),
    deleteComment: async ({ commentId, albumId }, call) => write('delete-comment', '/comment_delete', { comment_id: id(commentId), aid: id(albumId) }, call),
    profile: async call => record(await read('profile', `/useredit/${id(signedIn().uid)}`, {}, call, true)),
    updateProfile: async (fields, call) => write('update-profile', `/useredit/${id(signedIn().uid)}`, fields, call),
    daily: async call => record(await read('daily', '/daily', { user_id: id(signedIn().uid) }, call, true)),
    dailyCheck: async (dailyId, call) => write('daily-check', '/daily_chk', { user_id: id(signedIn().uid), daily_id: id(dailyId) }, call),
    dailyList: async call => read('daily-list', '/daily_list', { user_id: id(signedIn().uid) }, call, true),
    dailyFilter: async (month, call) => run('daily-filter', '/daily_list/filter', { method: 'POST', form: { data: required(month, 'month') }, account: signedIn() }, call),
    history: async (pageNumber, call) => record(await read('history', '/watch_list', { page: String(integer(pageNumber, 1, 10000, 'page')) }, call, true)),
    removeHistory: async (albumId, call) => write('remove-history', '/watch_list', { id: id(albumId) }, call),
    dispose() { lifetime.abort(); network.dispose(); },
  };
}
