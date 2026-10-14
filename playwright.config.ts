import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 4321);
// Même hôte que scripts/serve.mjs (boucle locale) et que la CSP de `pnpm build:e2e`.
const origin = `http://127.0.0.1:${port}`;
// Permet d'utiliser un Chromium déjà installé (ex. environnement sans téléchargement).
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: "tests/e2e",
  // Vérifie que site/ a été construit par `pnpm build:e2e` avant de lancer quoi que ce soit.
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `${origin}/collection-paperasse/`,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile-360",
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 } },
    },
  ],
  webServer: {
    command: "node scripts/serve.mjs",
    url: `${origin}/collection-paperasse/`,
    reuseExistingServer: !process.env.CI,
  },
});
