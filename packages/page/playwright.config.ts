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
        serviceWorkers: "allow",
        trace: "retain-on-failure",
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
            name: "mobile-chromium",
            use: { ...devices["Pixel 7"] },
        },
    ],
});
