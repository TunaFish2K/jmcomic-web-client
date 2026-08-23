import { defineConfig, devices } from "@playwright/test";

const firefoxExecutablePath = process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE;

export default defineConfig({
    testDir: "./test/browser",
    timeout: 45_000,
    expect: {
        timeout: 10_000,
    },
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL: "http://127.0.0.1:43917",
        serviceWorkers: "allow",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "pnpm exec vite preview --host 127.0.0.1 --port 43917",
        url: "http://127.0.0.1:43917",
        reuseExistingServer: false,
    },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
        {
            name: "firefox",
            use: {
                ...devices["Desktop Firefox"],
                launchOptions: firefoxExecutablePath
                    ? { executablePath: firefoxExecutablePath }
                    : undefined,
            },
        },
        {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
        },
        {
            name: "mobile-chromium",
            use: { ...devices["Pixel 7"] },
        },
    ],
});
