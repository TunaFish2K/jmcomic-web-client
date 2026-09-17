import { expect, test } from '@playwright/test';

const preferences = (mode: string, version = 1) => JSON.stringify({
  version, mode, accent: { kind: 'preset', id: 'jade' },
});

const scenarios = [
  { name: 'explicit dark overrides a light system', system: 'light', raw: preferences('dark'), legacy: 'light', expected: 'dark' },
  { name: 'explicit light overrides a dark system', system: 'dark', raw: preferences('light'), legacy: 'dark', expected: 'light' },
  { name: 'system mode follows dark appearance', system: 'dark', raw: preferences('system'), legacy: 'light', expected: 'dark' },
  { name: 'system mode follows light appearance', system: 'light', raw: preferences('system'), legacy: 'dark', expected: 'light' },
  { name: 'new users follow the system', system: 'dark', raw: null, legacy: null, expected: 'dark' },
  { name: 'legacy dark preferences are respected', system: 'light', raw: null, legacy: 'dark', expected: 'dark' },
  { name: 'malformed preferences fall back to legacy', system: 'light', raw: '{broken', legacy: 'dark', expected: 'dark' },
  { name: 'null preferences fall back to legacy', system: 'light', raw: 'null', legacy: 'dark', expected: 'dark' },
  { name: 'unknown versions fall back to legacy', system: 'light', raw: preferences('light', 2), legacy: 'dark', expected: 'dark' },
  { name: 'invalid modes fall back to the system', system: 'dark', raw: preferences('invalid'), legacy: 'invalid', expected: 'dark' },
] as const;

for (const scenario of scenarios) {
  test(`startup: ${scenario.name} before external assets load`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scenario.system });
    await page.addInitScript(({ raw, legacy }) => {
      if (raw !== null) localStorage.setItem('theme-preferences:v1', raw);
      if (legacy !== null) localStorage.setItem('theme', legacy);
    }, scenario);

    let releaseAssets!: () => void;
    const assetsReady = new Promise<void>((resolve) => { releaseAssets = resolve; });
    await page.route('**/assets-v3/**', async (route) => {
      await assetsReady;
      await route.continue();
    });

    try {
      await page.goto('/', { waitUntil: 'commit' });
      await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', scenario.expected);
      await expect(page.locator('#root')).toBeEmpty();
      const background = scenario.expected === 'dark' ? 'rgb(12, 10, 9)' : 'rgb(245, 245, 244)';
      const themeColor = scenario.expected === 'dark' ? '#0c0a09' : '#f5f5f4';
      for (const selector of ['html', 'body']) {
        await expect(page.locator(selector)).toHaveCSS('background-color', background);
      }
      await expect(page.locator('html')).toHaveCSS('color-scheme', scenario.expected);
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', themeColor);

      releaseAssets();
      // Only the application initializer sets the accent attribute.
      await expect(page.locator('html')).toHaveAttribute('data-accent', 'jade');
      await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', scenario.expected);
      for (const selector of ['html', 'body']) {
        await expect(page.locator(selector)).toHaveCSS('background-color', background);
      }
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', themeColor);
    } finally {
      releaseAssets();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}

for (const failure of ['getter', 'methods'] as const) {
  test(`startup follows a dark system when storage ${failure} throw`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript((failureMode) => {
      const denyStorage = () => { throw new DOMException('Storage denied', 'SecurityError'); };
      if (failureMode === 'getter') {
        Object.defineProperty(window, 'localStorage', { get: denyStorage });
      } else {
        Storage.prototype.getItem = denyStorage;
      }
    }, failure);
    // Isolate the document bootstrap from application code and external styles.
    await page.route('**/assets-v3/**', (route) => route.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-resolved-theme', 'dark');
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(12, 10, 9)');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(12, 10, 9)');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0c0a09');
  });
}
