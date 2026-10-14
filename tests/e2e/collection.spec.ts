// Garde-fous communs à toute la collection. Chaque look ajoute ses propres tests dans
// tests/e2e/<look>/ (voir l'agent tester). Chaque test tourne une fois par projet Playwright :
// desktop (1280 px) et mobile-360 (360 px).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NBSP = String.fromCodePoint(0xa0);

const pages = [
  { path: "", name: "lookbook" },
  { path: "reunion-metre/", name: "reunion-metre" },
  { path: "jure-crache/", name: "jure-crache" },
  { path: "sav-de-ta-vie/", name: "sav-de-ta-vie" },
];

/** Directives d'une CSP, indexées par nom : « script-src » → ["https://…", "'sha256-…'"]. */
function parseCsp(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const directive of csp.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/u);
    if (name) directives.set(name, sources);
  }
  return directives;
}

/** Collecte les violations CSP signalées par la page, dès le premier octet. */
async function collectCspViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction("reportCspViolation", (message: string) => {
    violations.push(message);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report: unknown = Reflect.get(window, "reportCspViolation");
      if (typeof report === "function") {
        report(`${event.violatedDirective} ${event.blockedURI}`);
      }
    });
  });
  return violations;
}

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

    test("a une CSP stricte, limitée au préfixe de la collection", async ({ page, baseURL }) => {
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

      // Scripts, styles, polices et images : seulement sous /collection-paperasse/, pas tout
      // l'hôte (sur g0nni.github.io, 'self' couvrirait tous les dépôts Pages du compte).
      const prefix = new URL(baseURL ?? "http://localhost/collection-paperasse/").href;
      const directives = parseCsp(csp ?? "");
      for (const directive of ["script-src", "style-src", "font-src", "img-src"]) {
        const hosts = (directives.get(directive) ?? []).filter(
          (source) => !source.startsWith("'sha"),
        );
        expect(hosts, directive).toEqual([prefix]);
      }
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

    test("aucun attribut style dans le HTML construit, aucune violation CSP", async ({
      page,
      request,
    }) => {
      const html = await (await request.get(path)).text();
      const styleAttributes = [...html.matchAll(/<[^>]*\sstyle\s*=[^>]*>/giu)].map((m) => m[0]);
      expect(styleAttributes).toEqual([]);

      const violations = await collectCspViolations(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      for (const link of await page.getByRole("link").all()) await link.hover();
      expect(violations).toEqual([]);
    });
  });
}

// CA-5 du lookbook (specs/lookbook.md, « Le CollectionTag ») : texte exact, avec des « · »
// visibles entre les blocs et une insécable avant « : ».
const TOUR = [
  {
    slug: "reunion-metre",
    text: `COLLECTION PAPERASSE · AH26 · LOOK 01/03 · Suivant${NBSP}: Juré Craché →`,
    next: "jure-crache/",
  },
  {
    slug: "jure-crache",
    text: `COLLECTION PAPERASSE · AH26 · LOOK 02/03 · Suivant${NBSP}: Le SAV de ta vie →`,
    next: "sav-de-ta-vie/",
  },
  {
    slug: "sav-de-ta-vie",
    text: "COLLECTION PAPERASSE · AH26 · LOOK 03/03 · Retour au lookbook →",
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
    // l'insécable avant « : » doit être là telle quelle.
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
