import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  use: {
    baseURL: process.env.AETHER_E2E_URL || "http://localhost:3000",
    headless: true,
  },
  webServer: process.env.AETHER_E2E_URL
    ? undefined
    : {
        command: "npm run start -w aether_cli",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
