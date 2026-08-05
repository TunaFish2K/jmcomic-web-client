import { expect, test } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ServerMode = "legacy" | "candidate";

const distDirectory = path.resolve(
    fileURLToPath(new URL("../../dist/", import.meta.url)),
);

const legacyHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="/assets/index-legacy.css" />
    <title>Legacy J Client</title>
  </head>
  <body>
    <main id="legacy-shell">legacy shell</main>
    <script type="module" src="/assets/index-legacy.js"></script>
  </body>
</html>`;

const legacyCss = `body { background: rgb(16, 96, 64); color: white; }`;

const legacyJs = `
window.__legacyLoaded = true;
const reloadOnControllerChange = navigator.serviceWorker.controller !== null;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (reloadOnControllerChange) window.location.reload();
});
navigator.serviceWorker.register('/sw.js', { scope: '/' });
`;

const legacyServiceWorker = `
const CACHE_NAME = 'workbox-precache-v2-' + self.registration.scope;
const SHELL_URLS = ['/index.html', '/assets/index-legacy.css', '/assets/index-legacy.js'];
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match('/index.html').then((response) => response || fetch(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then((response) => response || fetch(event.request)));
});
`;

const contentTypes: Record<string, string> = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
};

function send(
    response: ServerResponse,
    statusCode: number,
    body: string | Buffer,
    contentType: string,
    cacheControl: string,
) {
    response.writeHead(statusCode, {
        "Cache-Control": cacheControl,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
}

function serveLegacy(pathname: string, response: ServerResponse) {
    const cacheControl =
        pathname === "/sw.js"
            ? "public, max-age=14400, must-revalidate"
            : "public, max-age=0, must-revalidate";

    if (pathname === "/" || pathname === "/index.html") {
        send(response, 200, legacyHtml, contentTypes[".html"], cacheControl);
        return;
    }
    if (pathname === "/assets/index-legacy.css") {
        send(response, 200, legacyCss, contentTypes[".css"], cacheControl);
        return;
    }
    if (pathname === "/assets/index-legacy.js") {
        send(response, 200, legacyJs, contentTypes[".js"], cacheControl);
        return;
    }
    if (pathname === "/sw.js") {
        send(
            response,
            200,
            legacyServiceWorker,
            contentTypes[".js"],
            cacheControl,
        );
        return;
    }
    send(response, 404, "Not found", contentTypes[".txt"], "no-store");
}

async function serveCandidate(
    pathname: string,
    response: ServerResponse,
    serviceWorkerRevision: string,
) {
    const filePathname =
        pathname === "/" ||
        pathname === "/index.html" ||
        pathname.startsWith("/reader/")
            ? "index.html"
            : decodeURIComponent(pathname).replace(/^\/+/, "");
    const filePath = path.resolve(distDirectory, filePathname);

    if (!filePath.startsWith(`${distDirectory}${path.sep}`)) {
        send(response, 404, "Not found", contentTypes[".txt"], "no-store");
        return;
    }

    try {
        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) throw new Error("Not a file");
        const body =
            filePathname === "sw.js"
                ? `${await readFile(filePath, "utf8")}\n// test revision: ${serviceWorkerRevision}\n`
                : await readFile(filePath);
        const extension = path.extname(filePath);
        const noStore =
            filePathname === "index.html" ||
            filePathname === "sw.js" ||
            filePathname === "manifest.webmanifest" ||
            filePathname === "release.json";
        send(
            response,
            200,
            body,
            contentTypes[extension] ?? "application/octet-stream",
            noStore
                ? "no-cache, no-store, must-revalidate"
                : "public, max-age=0, must-revalidate",
        );
    } catch {
        send(response, 404, "Not found", contentTypes[".txt"], "no-store");
    }
}

async function startRecoveryServer(initialMode: ServerMode = "legacy") {
    let mode = initialMode;
    let serviceWorkerRevision = "current";
    let candidateDocumentRequests = 0;
    const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://127.0.0.1")
            .pathname;
        if (mode === "legacy") serveLegacy(pathname, response);
        else {
            if (
                pathname === "/" ||
                pathname === "/index.html" ||
                pathname.startsWith("/reader/")
            ) {
                candidateDocumentRequests += 1;
            }
            void serveCandidate(pathname, response, serviceWorkerRevision);
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Recovery server has no TCP address");

    return {
        origin: `http://127.0.0.1:${address.port}`,
        setMode(nextMode: ServerMode) {
            mode = nextMode;
        },
        getCandidateDocumentRequests() {
            return candidateDocumentRequests;
        },
        setServiceWorkerRevision(nextRevision: string) {
            serviceWorkerRevision = nextRevision;
        },
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            }),
    };
}

test("recovers a controlled client with a broken legacy stylesheet", async ({
    page,
}) => {
    const recoveryServer = await startRecoveryServer();

    try {
        await page.goto(recoveryServer.origin);
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.reload();
        await expect(page.locator("#legacy-shell")).toBeVisible();

        await page.evaluate(async () => {
            const cacheNames = await caches.keys();
            const precacheName = cacheNames.find((name) =>
                name.includes("-precache-"),
            );
            if (!precacheName)
                throw new Error("Legacy precache was not installed");

            const precache = await caches.open(precacheName);
            await precache.put(
                "/assets/index-legacy.css",
                new Response("", {
                    headers: { "Content-Type": "text/css" },
                }),
            );
            const coverCache = await caches.open("cover-images");
            await coverCache.put(
                "/legacy-cover.jpg",
                new Response("legacy cover"),
            );
        });
        await page.reload();

        expect(
            await page.evaluate(
                () => getComputedStyle(document.body).backgroundColor,
            ),
        ).toBe("rgba(0, 0, 0, 0)");

        recoveryServer.setMode("candidate");

        await page.evaluate(() => {
            void navigator.serviceWorker
                .getRegistration("/")
                .then((registration) => {
                    if (!registration)
                        throw new Error("Legacy registration is missing");
                    return registration.update();
                });
        });

        await expect(page).toHaveTitle("J Client");
        await expect(page.locator('input[name="query"]')).toBeVisible();
        expect(recoveryServer.getCandidateDocumentRequests()).toBe(1);

        const stylesheetUrl = await page
            .locator('link[rel="stylesheet"]')
            .getAttribute("href");
        expect(stylesheetUrl).toMatch(/^\/assets-v3\/.*\.css$/);

        await expect
            .poll(async () =>
                page.evaluate(async () => {
                    const cacheNames = await caches.keys();
                    return cacheNames.includes("cover-images");
                }),
            )
            .toBe(false);

        const precacheEntries = await page.evaluate(async () => {
            const result: string[] = [];
            for (const cacheName of await caches.keys()) {
                if (!cacheName.includes("-precache-")) continue;
                const cache = await caches.open(cacheName);
                result.push(
                    ...(await cache.keys()).map((request) => request.url),
                );
            }
            return result;
        });
        expect(precacheEntries).toHaveLength(1);
        expect(precacheEntries[0]).toContain("/pwa-cache-cleanup-v3.txt");

        const releaseResponse = await page.request.get(
            `${recoveryServer.origin}/release.json`,
        );
        expect(releaseResponse.headers()["cache-control"]).toBe(
            "no-cache, no-store, must-revalidate",
        );
        expect(await releaseResponse.json()).toEqual({
            commit: "local",
            branch: "local",
        });
    } finally {
        await recoveryServer.close();
    }
});

test("keeps search status borders inset and limits preload recovery to one reload", async ({
    page,
}, testInfo) => {
    const recoveryServer = await startRecoveryServer("candidate");

    try {
        await page.goto(recoveryServer.origin);
        await expect
            .poll(() => recoveryServer.getCandidateDocumentRequests())
            .toBe(2);
        await expect(page.locator('input[name="query"]')).toBeVisible();
        const input = page.locator('input[name="query"]');
        const inputGroup = page.locator(".search-input-group");

        await input.focus();
        await expect
            .poll(async () =>
                inputGroup.evaluate((element) => {
                    const style = getComputedStyle(element, "::after");
                    return {
                        top: style.top,
                        left: style.left,
                        shadow: style.boxShadow,
                    };
                }),
            )
            .toEqual(expect.objectContaining({ top: "2px", left: "2px" }));
        expect(
            await inputGroup.evaluate(
                (element) => getComputedStyle(element, "::after").boxShadow,
            ),
        ).not.toBe("none");
        await page.screenshot({
            path: testInfo.outputPath("search-focus.png"),
            fullPage: true,
        });

        await input.fill(" ");
        await input.press("Enter");
        await expect(page.getByText("请填写搜索内容")).toBeVisible();
        expect(
            await inputGroup.evaluate(
                (element) => getComputedStyle(element, "::after").top,
            ),
        ).toBe("2px");
        await page.screenshot({
            path: testInfo.outputPath("search-invalid.png"),
            fullPage: true,
        });

        const documentRequestsBeforeRecovery =
            recoveryServer.getCandidateDocumentRequests();
        await page.evaluate(() =>
            window.dispatchEvent(
                new Event("vite:preloadError", { cancelable: true }),
            ),
        );
        await expect
            .poll(() => recoveryServer.getCandidateDocumentRequests())
            .toBe(documentRequestsBeforeRecovery + 1);
        await expect(page.locator('input[name="query"]')).toBeVisible();

        await page.evaluate(() =>
            window.dispatchEvent(
                new Event("vite:preloadError", { cancelable: true }),
            ),
        );
        await page.waitForTimeout(250);
        expect(recoveryServer.getCandidateDocumentRequests()).toBe(
            documentRequestsBeforeRecovery + 1,
        );
    } finally {
        await recoveryServer.close();
    }
});

test("reloads once on first install and once when the worker changes", async ({
    page,
}) => {
    const recoveryServer = await startRecoveryServer("candidate");

    try {
        await page.goto(recoveryServer.origin);
        await expect
            .poll(() => recoveryServer.getCandidateDocumentRequests())
            .toBe(2);
        await expect(page.locator('input[name="query"]')).toBeVisible();
        await page.waitForTimeout(500);
        expect(recoveryServer.getCandidateDocumentRequests()).toBe(2);

        const documentRequestsBeforeUpdate =
            recoveryServer.getCandidateDocumentRequests();
        recoveryServer.setServiceWorkerRevision("next");
        await page.evaluate(() => {
            void navigator.serviceWorker
                .getRegistration("/")
                .then((registration) => {
                    if (!registration)
                        throw new Error("Candidate registration is missing");
                    return registration.update();
                });
        });

        await expect
            .poll(() => recoveryServer.getCandidateDocumentRequests())
            .toBe(documentRequestsBeforeUpdate + 1);
        await expect(page.locator('input[name="query"]')).toBeVisible();
        await page.waitForTimeout(250);
        expect(recoveryServer.getCandidateDocumentRequests()).toBe(
            documentRequestsBeforeUpdate + 1,
        );
    } finally {
        await recoveryServer.close();
    }
});
