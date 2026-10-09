import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de parcours (E2E). Prérequis : API (port 4000, PAYMENT_PROVIDER=mock) et
 * frontend (port 3000) démarrés, base de données migrée et initialisée (seed),
 * et un administrateur créé (E2E_ADMIN_PHONE / E2E_ADMIN_PASSWORD).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "fr-FR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
  ],
});
