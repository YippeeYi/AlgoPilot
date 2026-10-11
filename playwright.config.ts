import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop-chromium",
      testMatch: "shell.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile-chromium",
      testMatch: "shell.spec.ts",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "m1-desktop",
      testMatch: "m1.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:3101",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "m1-mobile",
      testMatch: "m1.spec.ts",
      use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3101" },
    },
  ],
  webServer: [
    {
      command: "node tests/fixtures/supabase-http.mjs",
      url: "http://127.0.0.1:54001/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run start -- --hostname 127.0.0.1 --port 3100",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
        APP_URL: "",
      },
      timeout: 60_000,
    },
    {
      command: "npm run start -- --hostname 127.0.0.1 --port 3101",
      url: "http://127.0.0.1:3101/login",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54001",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
        APP_URL: "http://127.0.0.1:3101",
      },
    },
  ],
});
