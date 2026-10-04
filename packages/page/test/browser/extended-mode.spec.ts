import { expect, test, type Page } from '@playwright/test';

// Service-worker-owned fetches bypass Playwright's route interception in WebKit.
test.use({ serviceWorkers: 'block' });

const member = { uid: '42', username: 'reader', email: 'r@example.test', level: 'Lv1', coin: 3 };
const comic = (id: string, name: string) => ({ id, name, author: 'Fixture', image: '', category: null, liked: null, favorite: null, updatedAt: null });

/** Mocks the Worker. Returns the request log so tests can check what the page sent. */
async function mockBackend(page: Page, options: { favoriteStatus?: number } = {}) {
    const requests: { path: string; method: string; auth: string | null; body: unknown }[] = [];
    await page.route('http://backend.test/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        requests.push({ path, method: request.method(), auth: request.headers().authorization ?? null, body: request.postDataJSON?.() ?? null });
        const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        const routes: Record<string, unknown> = {
            '/api/mobile/config': { accountEnabled: true },
            '/api/mobile/promote': [{ id: '26', title: '热门推荐', type: 'promote', filterValue: '26', items: [comic('1', 'Promoted fixture')] }],
            '/api/mobile/latest': [],
            '/api/mobile/categories': { categories: [{ id: '0', name: '最新A漫', slug: '', total: 0 }], blocks: [] },
            '/api/mobile/categories/filter': { total: 1, items: [comic('2', 'Ranked fixture')] },
            '/api/mobile/account/login': { session: 'v1.sealed', expiresAt: Date.now() + 3_600_000, member },
            '/api/mobile/account/favorites': { total: 0, folders: [], items: [] },
            '/api/mobile/account/favorite': { ok: true, message: '已加入收藏', type: 'add' },
            '/batch-album': [{ albumId: '1', album: { id: '1', name: 'Promoted fixture', images: [], description: null, totalViews: '1', likes: '1', series: [], seriesID: '', author: ['Fixture'], tags: [], works: [], actors: [] }, photo: null }],
        };
        if (path === '/api/mobile/account/favorite' && options.favoriteStatus) {
            return route.fulfill({ status: options.favoriteStatus, headers, json: { error: { code: 'SESSION_EXPIRED', message: 'Session expired' } } });
        }
        if (path in routes) return route.fulfill({ headers, json: routes[path] });
        return route.fulfill({ status: 404, headers, json: { error: { code: 'NOT_FOUND', message: path } } });
    });
    return requests;
}

async function enableExtendedMode(page: Page) {
    await page.getByRole('button', { name: '外观设置' }).click();
    await page.getByRole('switch', { name: '扩展模式' }).click();
    await expect(page.getByRole('alertdialog', { name: '开启扩展模式' })).toBeVisible();
    await page.getByRole('button', { name: '我已了解，开启' }).click();
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

test('extended mode is off by default and keeps the search page unchanged', async ({ page }) => {
    const requests = await mockBackend(page);
    await page.goto('/favorites');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByPlaceholder('搜索内容...')).toBeVisible();
    await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0);
    expect(requests.some((request) => request.path.startsWith('/api/mobile'))).toBe(false);
});

test.describe('mobile viewport', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('enables extended mode, browses, logs in when needed and resumes the favorite', async ({ page }) => {
        const requests = await mockBackend(page);
        await page.goto('/');
        await enableExtendedMode(page);
        await expect(page.getByText('Promoted fixture')).toBeVisible();

        await page.getByRole('link', { name: '发现' }).click();
        await expect(page.getByText('Ranked fixture')).toBeVisible();

        await page.getByRole('link', { name: '首页' }).click();
        await page.getByText('Promoted fixture').click();
        await page.getByRole('button', { name: /收藏/ }).click();
        const login = page.getByRole('dialog', { name: '登录账号' });
        await expect(login).toBeVisible();
        await login.getByLabel('用户名').fill('reader');
        await login.getByLabel('密码').fill('secret');
        await login.getByRole('button', { name: '登录' }).click();
        await expect(login).toHaveCount(0);
        await expect(page.getByText('已加入收藏')).toBeVisible();

        const favorite = requests.find((request) => request.path === '/api/mobile/account/favorite');
        expect(favorite?.auth).toBe('Bearer v1.sealed');
        expect(favorite?.body).toEqual({ aid: '1' });
        expect(await page.evaluate(() => localStorage.getItem('jm-account-session:v1'))).toBeNull();
        expect(await page.evaluate(() => sessionStorage.getItem('jm-account-session:v1'))).toContain('v1.sealed');

        await page.reload();
        await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    });

    test('an expired session sends the user back to the login form', async ({ page }) => {
        await mockBackend(page, { favoriteStatus: 401 });
        await page.goto('/');
        await enableExtendedMode(page);
        await page.evaluate((account) => sessionStorage.setItem('jm-account-session:v1', JSON.stringify(account)),
            { session: 'v1.sealed', expiresAt: Date.now() + 3_600_000, member });
        await page.reload();
        await page.getByText('Promoted fixture').click();
        await page.getByRole('button', { name: /收藏/ }).click();
        await expect(page.getByText('登录已过期，请重新登录')).toBeVisible();
        // Close the album dialog by clicking its backdrop.
        await page.mouse.click(5, 5);
        await page.getByRole('link', { name: '收藏' }).click();
        await expect(page.getByText(/登录已过期，请重新登录。/)).toBeVisible();
        await expect(page.getByRole('form', { name: '登录' })).toBeVisible();
    });
});
