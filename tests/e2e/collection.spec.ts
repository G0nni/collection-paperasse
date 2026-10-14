// Garde-fous communs à toute la collection. Chaque look ajoute ses propres tests dans
// tests/e2e/<look>/ (voir l'agent tester).
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const pages = [
  { path: "", name: "lookbook" },
  { path: "reunion-metre/", name: "reunion-metre" },
  { path: "jure-crache/", name: "jure-crache" },
  { path: "sav-de-ta-vie/", name: "sav-de-ta-vie" },
];

for (const { path, name } of pages) {
  test.describe(name, () => {
    test("se charge sans erreur ni requête vers un tiers", async ({ page, baseURL }) => {
      const origin = new URL(baseURL ?? "http://localhost").origin;
      const foreign: string[] = [];
      const errors: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith("http") && url.origin !== origin) {
          foreign.push(request.url());
        }
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });

      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toBeVisible();
      await page.waitForLoadState("networkidle");

      expect(foreign, "requêtes vers un autre origine").toEqual([]);
      expect(errors, "erreurs console / JS").toEqual([]);
    });

    test("a une CSP stricte", async ({ page }) => {
      await page.goto(path);
      const csp = await page
        .locator('meta[http-equiv="content-security-policy"]')
        .getAttribute("content");
      expect(csp).toBeTruthy();
      expect(csp).not.toContain("unsafe-inline");
      expect(csp).not.toContain("unsafe-eval");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
    });

    test("n'a aucune violation axe", async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });

    test("ne défile pas horizontalement", async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test("l'étiquette de collection fait le tour des looks", async ({ page }) => {
  await page.goto("");
  await page.getByRole("link", { name: /Look 01/ }).click();
  await expect(page).toHaveURL(/reunion-metre\/$/);

  const tag = page.getByRole("navigation", { name: "Collection" });
  await expect(tag).toContainText("Look 01/03");
  await tag.getByRole("link", { name: /Suivant/ }).click();
  await expect(page).toHaveURL(/jure-crache\/$/);

  await expect(tag).toContainText("Look 02/03");
  await tag.getByRole("link", { name: /Suivant/ }).click();
  await expect(page).toHaveURL(/sav-de-ta-vie\/$/);

  await expect(tag).toContainText("Look 03/03");
  await tag.getByRole("link", { name: /lookbook/ }).click();
  await expect(page).toHaveURL(/collection-paperasse\/$/);
});
