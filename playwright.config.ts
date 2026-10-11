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
    {
      name: "m2-desktop",
      testMatch: "m2.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:3102",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "m2-mobile",
      testMatch: "m2.spec.ts",
      use: { ...devices["Pixel 7"], baseURL: "http://127.0.0.1:3102" },
    },
  ],
  webServer: [
    {
      command: "node tests/fixtures/llm-http.mjs",
      url: "http://127.0.0.1:54002/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run start -- --hostname 127.0.0.1 --port 3102",
      url: "http://127.0.0.1:3102/login",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54001",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
        APP_URL: "http://127.0.0.1:3102",
        LLM_PROVIDER: "openai-compatible",
        LLM_API_PROFILE: "generic",
        LLM_RESPONSE_FORMAT: "none",
        LLM_REASONING_EFFORT: "low",
        LLM_TIMEOUT_MS: "45000",
        LLM_TOKEN_PARAMETER: "max_completion_tokens",
        LLM_MAX_OUTPUT_TOKENS: "1200",
        LLM_BASE_URL: "http://127.0.0.1:54002/v1",
        LLM_MODEL: "fixture-http-model",
        LLM_API_KEY: "fixture-llm-key-not-real",
        TUTOR_RPC_SIGNING_SECRET: "ab".repeat(32),
        LLM_DAILY_REQUEST_LIMIT: "100",
      },
    },
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
        LLM_API_KEY: "",
        TUTOR_RPC_SIGNING_SECRET: "",
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
        LLM_API_KEY: "",
        TUTOR_RPC_SIGNING_SECRET: "",
      },
    },
  ],
});
