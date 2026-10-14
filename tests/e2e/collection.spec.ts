// Garde-fous communs à toute la collection. Chaque look ajoute ses propres tests dans
// tests/e2e/<look>/ (voir l'agent tester). Chaque test tourne une fois par projet Playwright :
// desktop (1280 px) et mobile-360 (360 px). La CSP des 4 pages est dans csp.spec.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { NBSP } from "./support/text";

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

    test("n'a aucune violation axe (WCAG 2.2 AA + bonnes pratiques)", async ({ page }) => {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
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

// CA-5 du lookbook (specs/lookbook.md, « Le CollectionTag ») : texte exact, avec des « · »
// visibles entre les blocs et une insécable avant « : ». Insécable aussi avant « → », pour que
// la flèche ne parte jamais seule à la ligne (reviewer, tour 2).
const TOUR = [
  {
    slug: "reunion-metre",
    text: `COLLECTION PAPERASSE · AH26 · LOOK 01/03 · Suivant${NBSP}: Juré Craché${NBSP}→`,
    next: "jure-crache/",
  },
  {
    slug: "jure-crache",
    text: `COLLECTION PAPERASSE · AH26 · LOOK 02/03 · Suivant${NBSP}: Le SAV de ta vie${NBSP}→`,
    next: "sav-de-ta-vie/",
  },
  {
    slug: "sav-de-ta-vie",
    text: `COLLECTION PAPERASSE · AH26 · LOOK 03/03 · Retour au lookbook${NBSP}→`,
    next: "",
  },
];

test("CA-5 · l'étiquette de collection fait le tour des looks, au texte exact", async ({
  page,
  baseURL,
}) => {
  const base = new URL(baseURL ?? "http://localhost/collection-paperasse/");
  await page.goto("");
  await page.getByRole("link", { name: /Réunion-mètre/u }).click();

  for (const stop of TOUR) {
    await expect(page).toHaveURL(new URL(`${stop.slug}/`, base).href);
    const tags = page.getByRole("navigation", { name: "Collection", exact: true });
    await expect(tags).toHaveCount(1);
    const tag = tags.first();
    expect(await tag.evaluate((element) => element.tagName)).toBe("NAV");

    // Texte rendu (majuscules CSS comprises). Seuls les blancs sécables sont normalisés :
    // les insécables avant « : » et « → » doivent être là telles quelles.
    const text = (await tag.innerText()).replace(/[ \t\r\n]+/gu, " ").trim();
    expect(text).toBe(stop.text);

    // « Collection Paperasse · AH26 » renvoie au lookbook, le dernier bloc va à la suite.
    const links = tag.getByRole("link");
    await expect(links).toHaveCount(2);
    await expect(links.first()).toHaveAccessibleName("Collection Paperasse · AH26");
    await expect(links.first()).toHaveAttribute("href", base.pathname);
    await expect(links.last()).toHaveAttribute("href", `${base.pathname}${stop.next}`);

    // Cousue en bas : le contenu principal ne passe pas sous l'étiquette.
    const tagTop = (await tag.boundingBox())?.y ?? 0;
    const below = await page
      .locator("main")
      .evaluateAll(
        (mains, top) =>
          mains.filter((main) => main.getBoundingClientRect().bottom > top + 1).length,
        tagTop,
      );
    expect(below, "le contenu principal ne doit pas passer sous l'étiquette").toBe(0);

    await links.last().click();
  }
  await expect(page).toHaveURL(base.href);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Collection Paperasse");
});
