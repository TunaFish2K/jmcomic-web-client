import { expect, test, type Page } from "@playwright/test";

const album = {
    id: 9001,
    name: "阅读器交互测试",
    images: [],
    description: null,
    totalViews: "1",
    likes: "1",
    series: [],
    seriesID: "",
    author: ["Test"],
    tags: [],
    works: [],
    actors: [],
};

const photo = {
    id: "9001",
    name: "阅读器交互测试",
    scrambleId: 999999,
    images: Array.from({ length: 5 }, (_, index) => ({
        name: `page-${index + 1}.jpg`,
        url: `http://backend.test/images/page-${index + 1}.jpg`,
    })),
};

async function prepareReader(
    page: Page,
    { autoSnap = true }: { autoSnap?: boolean } = {},
) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/pwa-cache-cleanup-v3.txt");
    await page.evaluate(
        async ({ albumValue, photoValue, snap }) => {
            const imageBytes = await fetch(
                "/icons/apple-touch-icon-180-v3.png",
            ).then((response) => response.arrayBuffer());

            const albumDatabase = await new Promise<IDBDatabase>(
                (resolve, reject) => {
                    const request = indexedDB.open("jm-album-cache", 2);
                    request.onupgradeneeded = () => {
                        const database = request.result;
                        const store = database.objectStoreNames.contains(
                            "albums",
                        )
                            ? request.transaction!.objectStore("albums")
                            : database.createObjectStore("albums", {
                                  keyPath: "albumId",
                              });
                        if (!store.indexNames.contains("updatedAt")) {
                            store.createIndex("updatedAt", "updatedAt", {
                                unique: false,
                            });
                        }
                    };
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                },
            );
            const albumTransaction = albumDatabase.transaction(
                "albums",
                "readwrite",
            );
            albumTransaction.objectStore("albums").put({
                albumId: "9001",
                album: albumValue,
                photo: photoValue,
                updatedAt: Date.now(),
            });
            await new Promise<void>((resolve, reject) => {
                albumTransaction.oncomplete = () => resolve();
                albumTransaction.onerror = () => reject(albumTransaction.error);
            });
            albumDatabase.close();

            const imageDatabase = await new Promise<IDBDatabase>(
                (resolve, reject) => {
                    const request = indexedDB.open("jm-image-cache", 2);
                    request.onupgradeneeded = () => {
                        const database = request.result;
                        for (const storeName of ["images", "image-metadata"]) {
                            if (database.objectStoreNames.contains(storeName))
                                continue;
                            const store = database.createObjectStore(storeName, {
                                keyPath: "key",
                            });
                            store.createIndex("timestamp", "timestamp", {
                                unique: false,
                            });
                        }
                    };
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                },
            );
            const imageTransaction = imageDatabase.transaction(
                ["images", "image-metadata"],
                "readwrite",
            );
            for (const image of photoValue.images) {
                const key = `${photoValue.id}/${image.name}`;
                const timestamp = Date.now();
                imageTransaction.objectStore("images").put({
                    key,
                    data: imageBytes.slice(0),
                    timestamp,
                    size: imageBytes.byteLength,
                    width: 180,
                    height: 180,
                });
                imageTransaction.objectStore("image-metadata").put({
                    key,
                    width: 180,
                    height: 180,
                    byteLength: imageBytes.byteLength,
                    timestamp,
                });
            }
            await new Promise<void>((resolve, reject) => {
                imageTransaction.oncomplete = () => resolve();
                imageTransaction.onerror = () => reject(imageTransaction.error);
            });
            imageDatabase.close();

            localStorage.setItem("reading-direction", "left-right");
            localStorage.setItem("reading-auto-snap", snap ? "1" : "0");
            localStorage.setItem("reading-seamless-mode", "0");
            localStorage.setItem("reading-lazy-render-range", "12");
            history.replaceState(
                {
                    usr: {
                        album: albumValue,
                        photo: photoValue,
                        isSeries: false,
                        seriesItems: [],
                    },
                    key: "reader-browser-test",
                    idx: 0,
                },
                "",
                "/reader/9001",
            );
        },
        { albumValue: album, photoValue: photo, snap: autoSnap },
    );
    await page.reload();
    await expect(page.getByRole("region", { name: "漫画阅读区域" })).toBeVisible();
    await expect(page.locator("[data-reader-page]")).toHaveCount(5);
    await expect(page.getByRole("slider", { name: "阅读进度" })).toHaveAttribute(
        "aria-valuemax",
        "5",
    );
}

test("handles arrow keys, mouse wheels, and continuous trackpad deltas", async ({
    page,
}) => {
    await prepareReader(page);
    const progress = page.getByRole("slider", { name: "阅读进度" });
    const reader = page.getByRole("region", { name: "漫画阅读区域" });

    await page.keyboard.press("ArrowRight");
    await expect(progress).toHaveAttribute("aria-valuenow", "2");

    await page.waitForTimeout(280);
    await reader.dispatchEvent("wheel", {
        deltaX: 0,
        deltaY: 120,
        deltaMode: 1,
    });
    await expect(progress).toHaveAttribute("aria-valuenow", "3");

    await page.evaluate(() =>
        localStorage.setItem("reading-auto-snap", "0"),
    );
    await page.reload();
    await expect(reader).toBeVisible();
    const before = await reader.evaluate((element) => element.scrollLeft);
    await reader.dispatchEvent("wheel", {
        deltaX: 0,
        deltaY: 20,
        deltaMode: 0,
    });
    await expect
        .poll(() => reader.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(before);
});

test("keeps the reader UI inside the viewport with comfortable touch targets", async ({
    page,
}, testInfo) => {
    test.skip(
        !["chromium", "mobile-chromium"].includes(testInfo.project.name),
        "Visual and coarse-pointer audit runs once per form factor",
    );
    await prepareReader(page);

    expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    if (testInfo.project.name === "mobile-chromium") {
        const buttonSizes = await page.locator("[data-reader-root] button:visible").evaluateAll(
            (buttons) =>
                buttons.map((button) => {
                    const rect = button.getBoundingClientRect();
                    return { width: rect.width, height: rect.height };
                }),
        );
        expect(buttonSizes.length).toBeGreaterThan(0);
        expect(buttonSizes.every(({ width, height }) => width >= 44 && height >= 44)).toBe(
            true,
        );
    }
    await page.screenshot({
        path: testInfo.outputPath("reader-ui.png"),
        fullPage: true,
    });
});

test("auto-hides idle desktop controls without affecting touch readers", async ({
    page,
}, testInfo) => {
    test.skip(
        !["chromium", "mobile-chromium"].includes(testInfo.project.name),
        "Idle pointer behavior runs once per input form factor",
    );
    await prepareReader(page);

    const root = page.locator("[data-reader-root]");
    const topBar = page.locator('[data-reader-ui="top"]');
    await expect(topBar).toHaveCSS("opacity", "1");

    if (testInfo.project.name === "mobile-chromium") {
        await page.waitForTimeout(3300);
        await expect(topBar).toHaveCSS("opacity", "1");
        return;
    }

    await page.mouse.move(12, 12);
    await page.waitForTimeout(3300);
    await expect(topBar).toHaveCSS("opacity", "0");
    await expect(root).toHaveCSS("cursor", "none");

    await page.mouse.move(40, 40);
    await expect(topBar).toHaveCSS("opacity", "1");
    await expect(root).not.toHaveCSS("cursor", "none");

    await page.getByRole("button", { name: "打开阅读设置" }).click();
    await page.waitForTimeout(3300);
    await expect(page.getByRole("dialog", { name: "阅读设置" })).toBeVisible();
    await expect(topBar).toHaveCSS("opacity", "1");
});

test("scrolls horizontally with a real touch swipe", async ({ page, context }, testInfo) => {
    test.skip(
        testInfo.project.name !== "mobile-chromium",
        "Raw touch input is exercised by mobile Chromium",
    );
    await prepareReader(page, { autoSnap: false });
    const reader = page.getByRole("region", { name: "漫画阅读区域" });
    const box = await reader.boundingBox();
    expect(box).not.toBeNull();

    const session = await context.newCDPSession(page);
    const y = box!.y + box!.height / 2;
    const startX = box!.x + box!.width * 0.8;
    const endX = box!.x + box!.width * 0.2;
    await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: startX, y }],
    });
    for (let step = 1; step <= 6; step += 1) {
        await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
                { x: startX + ((endX - startX) * step) / 6, y },
            ],
        });
    }
    await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
    });

    await expect
        .poll(() => reader.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(20);
});
