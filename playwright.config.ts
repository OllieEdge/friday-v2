import { defineConfig } from "@playwright/test";

const baseURL = process.env.FRIDAY_E2E_BASE_URL || "http://127.0.0.1:3334";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
  },
  reporter: "list",
});
