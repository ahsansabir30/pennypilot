import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  outputDir: "./node_modules/.tmp/playwright-results",
  use: {
    baseURL: "http://127.0.0.1:1422",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 1422 --strictPort",
    url: "http://127.0.0.1:1422",
    reuseExistingServer: false,
  },
});
