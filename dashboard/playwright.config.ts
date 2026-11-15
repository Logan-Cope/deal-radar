import { defineConfig, devices } from "@playwright/test";

/** E2E against a production build. Set BASE_URL to run the same specs against a deployment. */
const external = process.env.BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: external ?? "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: external
    ? undefined
    : { command: "npm run start -- -p 3100 -H 127.0.0.1", url: "http://127.0.0.1:3100", reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
