import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const album = { id: '1', name: 'Tagged fixture', images: [], description: null, totalViews: '1', likes: '1', series: [], seriesID: '',
    author: ['Fixture Author'], tags: ['巨乳', 'NTR'], works: [], actors: [] };

test('tag chips build upstream queries and album tags refine the search', async ({ page }) => {
    const queries: string[] = [];
    await page.route('http://backend.test/**', async (route) => {
        const url = new URL(route.request().url());
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (url.pathname === '/search') {
            queries.push(url.searchParams.get('query')!);
            return route.fulfill({ headers, json: { search_query: url.searchParams.get('query'), total: '1', content: [{ id: '1', name: album.name, author: 'Fixture Author' }] } });
        }
        if (url.pathname === '/batch-album') return route.fulfill({ headers, json: [{ albumId: '1', album, photo: null }] });
        return route.fulfill({ status: 404, headers, json: null });
    });
    await page.goto('/');
    const input = page.locator('input[name="query"]');
    await input.click();
    await input.pressSequentially('巨乳 -NTR');
    await input.press('Enter');
    await expect.poll(() => queries.at(-1)).toBe('巨乳 -NTR');
    const chips = page.getByRole('list', { name: '搜索标签' });
    await expect(chips.getByRole('listitem')).toHaveText(['巨乳', '−NTR']);

    await input.pressSequentially('全彩');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect.poll(() => queries.at(-1)).toBe('+巨乳 -NTR +全彩');
    await page.getByRole('button', { name: '匹配方式：全部包含' }).click();
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect.poll(() => queries.at(-1)).toBe('巨乳 -NTR 全彩');

    await page.locator('[data-album-id="1"]').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Fixture Author：搜索选项' }).click();
    await page.getByRole('menuitem', { name: '只搜这个' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Upstream has no phrase search, so a two-word author becomes two required words.
    await expect.poll(() => queries.at(-1)).toBe('+Fixture +Author');
    await expect(page).toHaveURL(/cat=2/);

    // The opened album's terms are now suggestions.
    await input.click();
    await input.pressSequentially('巨');
    await expect(page.getByRole('option', { name: /巨乳/ })).toBeVisible();
});

test('chips wrap instead of scrolling out of view on narrow screens', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.route('http://backend.test/**', (route) => route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, json: null }));
    await page.goto('/');
    const input = page.locator('input[name="query"]');
    await input.click();
    for (const term of ['巨乳', 'NTR', '全彩', '中文']) {
        await input.pressSequentially(term);
        await input.press('Tab');
    }
    const chips = page.getByRole('list', { name: '搜索标签' }).getByRole('listitem');
    await expect(chips).toHaveText(['巨乳', 'NTR', '全彩', '中文']);
    for (const chip of await chips.all()) await expect(chip).toBeInViewport({ ratio: 1 });
    await expect(input).toBeInViewport({ ratio: 1 });
    const box = await page.locator('.search-input-group').boundingBox();
    expect(box!.height).toBeGreaterThan(48);
});
