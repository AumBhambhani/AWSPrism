import { defineConfig, devices } from "@playwright/test";

// When running against the Docker stack, set BASE_URL to the exposed web port,
// e.g. BASE_URL=http://localhost:3000 npx playwright test
// When not set, the config starts a local dev server on 5173 instead.
const BASE_URL = process.env.BASE_URL || "http://localhost:5173";
const useExistingServer = !!process.env.BASE_URL || !process.env.CI;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  globalSetup: "./tests/global-setup.js",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Skip launching a dev server when pointing at Docker (BASE_URL is set).
  ...(process.env.BASE_URL ? {} : {
    webServer: {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: useExistingServer,
      timeout: 60_000,
      env: { PLAYWRIGHT: "1" },
    },
  }),
});
