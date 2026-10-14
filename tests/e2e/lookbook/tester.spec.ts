// Tests du lookbook écrits par l'agent tester à partir de specs/lookbook.md et des règles de
// CLAUDE.md. Les garde-fous communs à toutes les pages sont dans tests/e2e/collection.spec.ts
// (axe à 1280 et 360 px, requêtes tierces, tour des étiquettes au texte exact) et
// tests/e2e/csp.spec.ts (CSP, aucun attribut style) ; les outils (contraste, états, clavier,
// typographie, CSP) dans tests/e2e/support/.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { contrastFailures, focusRing, snapshotTextNodes, worstContrast } from "../support/contrast";
import { tabTo } from "../support/keyboard";
import { colorState, effectiveRotation, nonColorState } from "../support/states";
import { EM_DASH, NBSP, normalizeSpaces, perceivedTexts, typographyIssues } from "../support/text";

const BASE_PATH = "/collection-paperasse/";
const REPO_URL = "https://github.com/G0nni/collection-paperasse";

/** Les tests qui fixent leur propre viewport ne tournent qu'une fois, dans le projet desktop. */
const FIXED_VIEWPORT_PROJECT = "desktop";

const LOOKS = [
  {
    number: "01",
    name: "Réunion-mètre",
    slug: "reunion-metre",
    sheet: {
      Matière: "papier thermique 80 mm",
      Coupe: "en temps réel",
      Prix: "0 € (mais la réunion, elle, coûte cher)",
    },
  },
  {
    number: "02",
    name: "Juré Craché",
    slug: "jure-crache",
    sheet: {
      Matière: "papier vergé, cire",
      Coupe: "notariale",
      Prix: "un kebab, selon l'issue",
    },
  },
  {
    number: "03",
    name: "Le SAV de ta vie",
    slug: "sav-de-ta-vie",
    sheet: {
      Matière: "papier listing 132 colonnes",
      Coupe: "en file d'attente",
      Prix: "0 €, SLA non garanti",
    },
  },
] as const;

async function cardsOf(page: Page) {
  const boxes = [];
  for (const look of LOOKS) {
    const card = page.getByRole("article", { name: look.name, exact: true });
    await expect(card).toHaveCount(1);
    const box = await card.boundingBox();
    if (box === null) throw new Error(`carte ${look.name} invisible`);
    boxes.push(box);
  }
  return boxes;
}

test.describe("lookbook · tester", () => {
  // -------------------------------------------------------------------------------------------
  // Contenu (section « Contenu » de la spec)
  // -------------------------------------------------------------------------------------------

  test("Contenu · l'en-tête porte le titre, la saison et la règle exacte", async ({ page }) => {
    await page.goto("");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Collection Paperasse");
    const banner = page.getByRole("banner");
    await expect(banner).toContainText("Automne-Hiver 2026");
    await expect(banner).toContainText(
      "Trois documents officiels. Aucune valeur. Zéro inscription.",
    );
    // Module signature : affiche « Avis à la population » avec un tampon ENTRÉE LIBRE.
    await expect(banner).toContainText(/Avis à la population/i);
    expect(normalizeSpaces(await banner.innerText())).toContain("ENTRÉE LIBRE");
  });

  for (const look of LOOKS) {
    test(`Contenu · la carte Look ${look.number} a nom, accroche, fiche, aperçu et lien`, async ({
      page,
    }) => {
      await page.goto("");
      const card = page.getByRole("article", { name: look.name, exact: true });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(`Look ${look.number}`, { ignoreCase: true });
      await expect(card.getByRole("heading", { name: look.name, exact: true })).toBeVisible();

      // Fiche défilé : Matière, Coupe, Prix, dans cet ordre, avec les valeurs de la spec.
      const terms = card.getByRole("term");
      const definitions = card.getByRole("definition");
      await expect(terms).toHaveText(["Matière", "Coupe", "Prix"]);
      const values = (await definitions.allInnerTexts()).map(normalizeSpaces);
      expect(values).toEqual([look.sheet.Matière, look.sheet.Coupe, look.sheet.Prix]);

      // Accroche : une phrase, distincte du nom et de la fiche.
      const text = normalizeSpaces(await card.innerText());
      expect(text.length).toBeGreaterThan(80);

      // Aperçu statique : une image (img, svg ou role=img) avec un nom accessible.
      const preview = card.getByRole("img").first();
      await expect(preview).toBeVisible();
      const previewName = await preview.evaluate(
        (element) =>
          element.getAttribute("aria-label") ??
          element.getAttribute("alt") ??
          element.querySelector("title")?.textContent ??
          "",
      );
      expect(previewName.trim().length).toBeGreaterThan(5);

      // Un lien, et un seul, vers l'app.
      const links = card.getByRole("link");
      await expect(links).toHaveCount(1);
      await expect(links).toHaveAttribute("href", `${BASE_PATH}${look.slug}/`);
    });
  }

  test("Contenu · le pied de page a le lien GitHub et les deux mentions", async ({ page }) => {
    await page.goto("");
    const footer = page.getByRole("contentinfo");
    await expect(footer).toHaveCount(1);
    const text = normalizeSpaces(await footer.innerText());
    expect(text).toContain("Aucun cookie, aucun compte, aucun serveur.");
    expect(text).toContain("Prochaine collection : bientôt.");
    const repo = footer.getByRole("link", { name: /GitHub/ });
    await expect(repo).toHaveAttribute("href", REPO_URL);
    const target = await repo.getAttribute("target");
    if (target === "_blank") {
      expect(await repo.getAttribute("rel")).toMatch(/noopener/);
    }
  });

  // -------------------------------------------------------------------------------------------
  // CA-1
  // -------------------------------------------------------------------------------------------

  test("CA-1 · chaque lien de carte ouvre la bonne app sous BASE_URL (200, bon titre)", async ({
    page,
    baseURL,
  }) => {
    const base = new URL(baseURL ?? "http://localhost/collection-paperasse/");
    expect(base.pathname).toBe(BASE_PATH);
    for (const look of LOOKS) {
      await page.goto("");
      const link = page.getByRole("article", { name: look.name, exact: true }).getByRole("link");
      const href = await link.getAttribute("href");
      // Lien relatif à la base, jamais absolu vers un autre hôte ni en dur à la racine.
      expect(href).toBe(`${BASE_PATH}${look.slug}/`);
      const [response] = await Promise.all([
        page.waitForEvent("response", (r) => r.url().endsWith(`/${look.slug}/`)),
        link.click(),
      ]);
      expect(response.status()).toBe(200);
      expect(page.url()).toBe(new URL(`${look.slug}/`, base).href);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(look.name);
      await expect(page).toHaveTitle(new RegExp(look.name));
    }
  });

  test("CA-1 · tous les liens internes de la page passent par la base", async ({ page }) => {
    await page.goto("");
    const hrefs = await page
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs.length).toBe(4);
    for (const href of hrefs) {
      if (href.startsWith("https://github.com/")) continue;
      expect(href.startsWith(BASE_PATH), href).toBe(true);
    }
  });

  // -------------------------------------------------------------------------------------------
  // CA-2
  // -------------------------------------------------------------------------------------------

  // Disposition « tout sur un écran » (specs/lookbook.md, commit 5f0cb22) : CA-2 ne dit plus
  // « trois colonnes dès 960 px » mais suit le tableau « Disposition » (≥ 1000 / 640-999 /
  // < 640 px), testé à 360, 800 et 1280 px. Les anciens tests à 360, 960 et 1440 px sont
  // remplacés par ceux du bloc « lookbook · disposition » en fin de fichier.

  // -------------------------------------------------------------------------------------------
  // CA-3
  // -------------------------------------------------------------------------------------------

  test("CA-3 · aucune ressource externe, même en survolant et en focalisant chaque lien", async ({
    page,
    context,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost").origin;
    const foreign: string[] = [];
    const seen: string[] = [];
    await context.route("**/*", async (route) => {
      const url = route.request().url();
      seen.push(url);
      if (new URL(url).origin !== origin) {
        foreign.push(url);
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    for (const link of await page.getByRole("link").all()) {
      await link.hover();
      await link.focus();
    }
    await page.waitForLoadState("networkidle");
    const resources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map((entry) => entry.name),
    );
    expect(seen.length).toBeGreaterThan(1);
    expect(foreign, "requêtes interceptées vers un tiers").toEqual([]);
    for (const url of resources) {
      expect(new URL(url).origin, url).toBe(origin);
    }
  });

  test("CA-3 · le HTML et le CSS livrés ne référencent aucune ressource externe", async ({
    page,
    request,
  }) => {
    const html = await (await request.get("")).text();
    // Le seul http(s) autorisé est le lien vers le dépôt (une navigation, pas une ressource).
    const absolute = [...html.matchAll(/(?:href|src|srcset|content)="(https?:[^"]+)"/giu)]
      .map((match) => match[1])
      .filter((url) => url !== REPO_URL);
    expect(absolute).toEqual([]);
    expect(html).not.toMatch(/rel="(?:preconnect|dns-prefetch|prefetch|preload)"[^>]*https?:/iu);

    await page.goto("");
    const stylesheets = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(stylesheets.length).toBeGreaterThan(0);
    for (const href of stylesheets) {
      const css = await (await request.get(new URL(href, page.url()).href)).text();
      expect(css, href).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//iu);
      expect(css, href).not.toMatch(/@import/iu);
    }
  });

  test("CA-3 · le lookbook ne stocke rien (ni cookie, ni storage)", async ({ page, context }) => {
    await page.goto("");
    for (const link of await page.getByRole("link").all()) await link.hover();
    const storage = await page.evaluate(() => ({
      cookie: document.cookie,
      local: localStorage.length,
      session: sessionStorage.length,
    }));
    expect(storage).toEqual({ cookie: "", local: 0, session: 0 });
    expect(await context.cookies()).toEqual([]);
  });

  // -------------------------------------------------------------------------------------------
  // CA-4
  // -------------------------------------------------------------------------------------------

  // 1280 px (desktop) et 360 px (mobile-360) : passe axe unique dans collection.spec.ts, avec
  // les mêmes règles. Ici, la disposition intermédiaire de CA-2 : « 640 à 999 px » (tableau
  // « Disposition » de specs/lookbook.md), qui remplace l'ancienne bascule à 960 px.
  test("CA-4 · axe : zéro violation à 800 px (WCAG 2.2 AA + bonnes pratiques)", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("CA-4 · axe : zéro violation en mouvement réduit et en thème sombre", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
    await page.goto("");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test("CA-4 · contraste réel de chaque texte au repos, dégradés compris", async ({ page }) => {
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    const snapshots = await page.locator("body").evaluate(snapshotTextNodes);
    expect(snapshots.length).toBeGreaterThan(20);
    expect(contrastFailures(snapshots)).toEqual([]);
  });

  test("CA-4 · contraste réel de chaque lien au survol (:hover)", async ({ page }) => {
    await page.goto("");
    const failures: string[] = [];
    for (const link of await page.getByRole("link").all()) {
      await link.hover();
      failures.push(...contrastFailures(await link.evaluate(snapshotTextNodes)));
      const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      failures.push(...results.violations.flatMap((v) => v.nodes.map((n) => n.html)));
      await page.mouse.move(0, 0);
    }
    expect(failures).toEqual([]);
  });

  test("CA-4 · contraste réel de chaque lien au focus clavier (:focus-visible)", async ({
    page,
  }) => {
    await page.goto("");
    const failures: string[] = [];
    for (const link of await page.getByRole("link").all()) {
      await tabTo(page, link);
      failures.push(...contrastFailures(await link.evaluate(snapshotTextNodes)));
      const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
      failures.push(...results.violations.flatMap((v) => v.nodes.map((n) => n.html)));
    }
    expect(failures).toEqual([]);
  });

  test("CA-4 · chaque lien a un focus visible au clavier, contrasté (≥ 3:1)", async ({ page }) => {
    await page.goto("");
    const problems: string[] = [];
    for (const link of await page.getByRole("link").all()) {
      const name = (await link.getAttribute("aria-label")) ?? (await link.innerText());
      const before = await link.evaluate(focusRing);
      await tabTo(page, link);
      const ring = await link.evaluate(focusRing);
      if (!ring.focusVisible) problems.push(`${name} : :focus-visible ne s'applique pas`);
      const hasOutline =
        ring.outlineStyle === "auto" || (ring.outlineStyle !== "none" && ring.outlineWidth >= 2);
      const hasShadow = ring.boxShadow !== "none" && ring.boxShadow !== before.boxShadow;
      if (!hasOutline && !hasShadow) {
        problems.push(`${name} : aucun indicateur (${ring.outlineStyle} ${ring.outlineWidth}px)`);
      }
      if (hasOutline && ring.outlineStyle !== "auto") {
        const { ratio } = worstContrast(ring.outlineColor, ring.chain);
        if (ratio < 3) problems.push(`${name} : contour à ${ratio.toFixed(2)}:1`);
      }
      // Le contour ne doit pas être rogné par un ancêtre (overflow) : on vérifie qu'il est
      // dans le viewport et dans la boîte visible de la page.
      const box = await link.boundingBox();
      const viewport = page.viewportSize();
      if (box !== null && viewport !== null) {
        const reach = ring.outlineWidth + Math.max(0, ring.outlineOffset);
        if (box.x - reach < 0 || box.x + box.width + reach > viewport.width) {
          problems.push(`${name} : contour hors de l'écran`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("CA-4 · le survol ne se distingue pas par la couleur seule (CLAUDE.md)", async ({
    page,
  }) => {
    await page.goto("");
    const problems: string[] = [];
    for (const link of await page.getByRole("link").all()) {
      const name = (await link.getAttribute("aria-label")) ?? (await link.innerText());
      await page.mouse.move(0, 0);
      const idleShape = await link.evaluate(nonColorState);
      const idleColor = await link.evaluate(colorState);
      await link.hover();
      const hoverShape = await link.evaluate(nonColorState);
      const hoverColor = await link.evaluate(colorState);
      if (hoverColor !== idleColor && JSON.stringify(hoverShape) === JSON.stringify(idleShape)) {
        problems.push(`${name} : seule la couleur change au survol (${idleColor} → ${hoverColor})`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("CA-4 · chaque lien est une cible tactile d'au moins 44 × 44 px", async ({ page }) => {
    await page.goto("");
    for (const link of await page.getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box, await link.innerText()).not.toBeNull();
      expect(box?.height ?? 0, await link.innerText()).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0, await link.innerText()).toBeGreaterThanOrEqual(44);
    }
  });

  test("CA-4 · tous les liens sont atteignables au clavier, dans l'ordre du document", async ({
    page,
  }) => {
    await page.goto("");
    const expected = await page
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const reached: (string | null)[] = [];
    for (let press = 0; press < expected.length; press += 1) {
      await page.keyboard.press("Tab");
      reached.push(await page.evaluate(() => document.activeElement?.getAttribute("href") ?? null));
    }
    expect(reached).toEqual(expected);
  });

  // -------------------------------------------------------------------------------------------
  // CA-5 et CollectionTag
  // -------------------------------------------------------------------------------------------

  // Le tour par les liens « suivant » (texte exact, liens, étiquette cousue en bas) est dans
  // tests/e2e/collection.spec.ts : un seul tour pour toute la collection.

  test("CA-5 · pas d'étiquette de collection sur le lookbook (c'est la racine)", async ({
    page,
  }) => {
    // specs/lookbook.md : « cousue en bas de chaque look (pas sur le lookbook, qui est la racine) ».
    await page.goto("");
    await expect(page.getByRole("navigation", { name: "Collection" })).toHaveCount(0);
  });

  for (const look of LOOKS) {
    test(`CA-5 · l'étiquette du Look ${look.number} suit --tag-bg / --tag-fg et reste lisible`, async ({
      page,
    }) => {
      await page.goto(`${look.slug}/`);
      const tag = page.getByRole("navigation", { name: "Collection", exact: true });
      await expect(tag).toHaveCount(1);

      const failures = contrastFailures(await tag.evaluate(snapshotTextNodes));
      expect(failures, "contraste de l'étiquette sur ce look").toEqual([]);

      // Les deux custom properties pilotent fond et encre (CSSOM, autorisé par la CSP).
      const applied = await tag.evaluate((element) => {
        if (!(element instanceof HTMLElement)) return null;
        element.style.setProperty("--tag-bg", "rgb(10, 20, 30)");
        element.style.setProperty("--tag-fg", "rgb(250, 240, 230)");
        const style = getComputedStyle(element);
        const link = element.querySelector("a");
        return {
          background: style.backgroundColor,
          color: style.color,
          link: link === null ? null : getComputedStyle(link).color,
        };
      });
      expect(applied).toEqual({
        background: "rgb(10, 20, 30)",
        color: "rgb(250, 240, 230)",
        link: "rgb(250, 240, 230)",
      });
    });

    test(`CA-5 · les liens de l'étiquette du Look ${look.number} ont un focus visible et 44 px`, async ({
      page,
    }) => {
      await page.goto(`${look.slug}/`);
      const tag = page.getByRole("navigation", { name: "Collection", exact: true });
      for (const link of await tag.getByRole("link").all()) {
        await tabTo(page, link);
        const ring = await link.evaluate(focusRing);
        expect(ring.focusVisible).toBe(true);
        expect(
          ring.outlineStyle === "auto" || (ring.outlineStyle !== "none" && ring.outlineWidth >= 2),
        ).toBe(true);
        const box = await link.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      }
    });

    test(`CA-5 · typographie française dans l'étiquette du Look ${look.number}`, async ({
      page,
    }) => {
      await page.goto(`${look.slug}/`);
      const tag = page.getByRole("navigation", { name: "Collection", exact: true });
      const texts = await tag.evaluate((element) => [
        element instanceof HTMLElement ? element.innerText : "",
        ...[...element.querySelectorAll("a")].map((link) => link.textContent ?? ""),
      ]);
      expect(texts.flatMap(typographyIssues)).toEqual([]);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Règles de la collection appliquées au HTML final
  // -------------------------------------------------------------------------------------------

  test("Typo · insécables avant : ; ! ? et dans « » partout dans le rendu final", async ({
    page,
  }) => {
    await page.goto("");
    const texts = await perceivedTexts(page, page.locator("body"));
    const issues = texts.flatMap(({ where, text }) =>
      typographyIssues(text).map((issue) => `${where} : ${issue}`),
    );
    expect(issues).toEqual([]);
    // L'oracle n'est pas vide : le rendu contient bien des insécables.
    expect(texts.some(({ text }) => text.includes(NBSP))).toBe(true);
  });

  test("Typo · aucun tiret cadratin dans le HTML ni dans le CSS livrés", async ({
    page,
    request,
  }) => {
    const html = await (await request.get("")).text();
    expect(html.includes(EM_DASH)).toBe(false);
    expect(html).not.toMatch(/&mdash;|&#8212;|&#x2014;/iu);
    await page.goto("");
    expect((await page.locator("body").innerText()).includes(EM_DASH)).toBe(false);
    const stylesheets = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    for (const href of stylesheets) {
      const css = await (await request.get(new URL(href, page.url()).href)).text();
      expect(css.includes(EM_DASH), href).toBe(false);
      expect(css, href).not.toMatch(/\\2014/iu);
    }
  });

  // « Aucun attribut style » et « aucune violation CSP » : vérifiés sur chaque page dans
  // tests/e2e/csp.spec.ts.

  test("Perf · moins de 50 Ko de JS (gzip) sur la page", async ({ page }) => {
    let total = 0;
    page.on("response", async (response) => {
      if (response.request().resourceType() === "script") {
        total += gzipSync(await response.body()).length;
      }
    });
    await page.goto("");
    await page.waitForLoadState("networkidle");
    const inline = await page
      .locator("script:not([src])")
      .evaluateAll((scripts) => scripts.map((script) => script.textContent ?? "").join(""));
    total += gzipSync(Buffer.from(inline)).length;
    expect(total).toBeLessThan(50 * 1024);
  });

  // -------------------------------------------------------------------------------------------
  // Design (tokens de la spec)
  // -------------------------------------------------------------------------------------------

  test("Design · liège texturé, affiche jaune, kraft, post-it bleu, encre", async ({ page }) => {
    await page.goto("");
    const body = await page.locator("body").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        background: style.backgroundColor,
        image: style.backgroundImage,
      };
    });
    expect(body.background).toBe("rgb(195, 143, 85)");
    expect(body.color).toBe("rgb(27, 27, 27)");
    expect(body.image.match(/radial-gradient/gu)?.length).toBe(2);

    const banner = page.getByRole("banner");
    expect(await banner.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      "rgb(255, 228, 92)",
    );
    // Étiquettes kraft : le parent du terme « Matière » remonte jusqu'à un fond kraft.
    for (const look of LOOKS) {
      const sheet = page.getByRole("article", { name: look.name, exact: true }).getByRole("term");
      const kraft = await sheet.first().evaluate((element) => {
        for (let node: Element | null = element; node !== null; node = node.parentElement) {
          const background = getComputedStyle(node).backgroundColor;
          if (background !== "rgba(0, 0, 0, 0)") return background;
        }
        return null;
      });
      expect(kraft).toBe("rgb(234, 211, 162)");
    }
    const footerBackgrounds = await page
      .getByRole("contentinfo")
      .evaluate((footer) =>
        [...footer.querySelectorAll("*")].map((node) => getComputedStyle(node).backgroundColor),
      );
    expect(footerBackgrounds).toContain("rgb(167, 224, 242)");
    // Rouge tampon sur l'affiche.
    const bannerColors = await banner.evaluate((header) =>
      [...header.querySelectorAll("*")].flatMap((node) => {
        const style = getComputedStyle(node);
        return [style.color, style.borderTopColor];
      }),
    );
    expect(bannerColors).toContain("rgb(179, 38, 30)");
  });

  // specs/lookbook.md (Design), commit 0c414b6 : « numéros de look #C2410C (uniquement en gros,
  // ≥ 24 px : contraste 3,54:1 sur le kraft, conforme au seuil 3:1) ». Le seuil était 34 px.
  test("Design · l'orange des numéros (#C2410C) n'apparaît qu'en ≥ 24 px", async ({ page }) => {
    await page.goto("");
    const uses = await page.locator("body").evaluate((body) =>
      [...body.querySelectorAll("*")]
        .filter((node) => {
          const style = getComputedStyle(node);
          const hasText = [...node.childNodes].some(
            (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim(),
          );
          return hasText && style.color === "rgb(194, 65, 12)";
        })
        .map((node) => ({
          text: (node.textContent ?? "").trim(),
          size: parseFloat(getComputedStyle(node).fontSize),
        })),
    );
    expect(uses.map((use) => use.text)).toEqual(["Look 01", "Look 02", "Look 03"]);
    for (const use of uses) expect(use.size, use.text).toBeGreaterThanOrEqual(24);
  });

  test("Design · polices auto-hébergées : Alfa Slab One, JetBrains Mono et celles des aperçus", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL ?? "http://localhost").origin;
    const fontFiles: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "font") {
        fontFiles.push({ url: response.url(), status: response.status() });
      }
    });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    const loaded = await page.evaluate(() =>
      [...document.fonts].filter((font) => font.status === "loaded").map((font) => font.family),
    );
    const families = new Set(loaded.map((family) => family.replaceAll('"', "")));
    for (const family of [
      "Alfa Slab One",
      "JetBrains Mono",
      "Doto",
      "Young Serif",
      "Courier Prime",
    ]) {
      expect([...families], family).toContain(family);
    }
    for (const file of fontFiles) {
      expect(new URL(file.url).origin).toBe(origin);
      expect(file.status).toBe(200);
    }
    const h1Font = await page
      .getByRole("heading", { level: 1 })
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(h1Font).toMatch(/^"?Alfa Slab One/u);
    const sheetFont = await page
      .getByRole("definition")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(sheetFont).toMatch(/^"?JetBrains Mono/u);
  });

  // specs/lookbook.md (Design) : « Les inclinaisons s'appliquent aux aperçus, à l'affiche et aux
  // post-its (comme sur la maquette). Les étiquettes kraft (fiches) et les boutons restent
  // droits ». Tour 2 : le test exigeait des post-its droits, la spec a été précisée depuis.
  test("Design · l'affiche, les aperçus et les post-its penchent ; fiches et boutons droits", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("");
    await page.mouse.move(0, 0);
    const banner = Math.abs(await page.getByRole("banner").evaluate(effectiveRotation));
    expect(banner).toBeGreaterThan(0.2);
    expect(banner).toBeLessThan(6);
    for (const look of LOOKS) {
      const card = page.getByRole("article", { name: look.name, exact: true });
      const preview = Math.abs(await card.getByRole("img").first().evaluate(effectiveRotation));
      expect(preview, `aperçu ${look.name}`).toBeGreaterThan(0.2);
      for (const locator of [
        card.getByRole("term").first(),
        card.getByRole("definition").first(),
        card.getByRole("heading"),
        card.getByRole("link"),
      ]) {
        expect(Math.abs(await locator.evaluate(effectiveRotation))).toBeLessThan(0.01);
      }
    }
    // Post-its : chaque note du pied de page (texte en Courier Prime) penche, légèrement.
    const footer = page.getByRole("contentinfo");
    const notes = footer.getByText(/Prochaine collection|Aucun cookie/u);
    await expect(notes).toHaveCount(2);
    for (const note of await notes.all()) {
      const tilt = Math.abs(await note.evaluate(effectiveRotation));
      expect(tilt, await note.innerText()).toBeGreaterThan(0.2);
      expect(tilt, await note.innerText()).toBeLessThan(6);
      expect(await note.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(
        /^"?Courier Prime/u,
      );
    }
  });

  test("Mouvement · en mouvement réduit, survoler ou focaliser une carte ne fait rien bouger", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("");
    const animated = await page
      .locator("body")
      .evaluate(
        (body) =>
          [body, ...body.querySelectorAll("*")]
            .map((node) => getComputedStyle(node))
            .filter(
              (style) =>
                style.transitionDuration.split(",").some((value) => parseFloat(value) > 0) ||
                style.animationName !== "none",
            ).length,
      );
    expect(animated).toBe(0);
    for (const look of LOOKS) {
      const card = page.getByRole("article", { name: look.name, exact: true });
      const preview = card.getByRole("img").first();
      await page.mouse.move(0, 0);
      const idle = await preview.evaluate(effectiveRotation);
      await card.getByRole("link").hover();
      expect(await preview.evaluate(effectiveRotation)).toBeCloseTo(idle, 3);
      await tabTo(page, card.getByRole("link"));
      expect(await preview.evaluate(effectiveRotation)).toBeCloseTo(idle, 3);
    }
  });

  // -------------------------------------------------------------------------------------------
  // Liens forgés : le lookbook n'a aucun paramètre, il doit ignorer tout ce qu'on lui colle.
  // -------------------------------------------------------------------------------------------

  const hostileSuffixes = [
    { name: "query vide", suffix: "?" },
    {
      name: "HTML dans la query",
      suffix: `?look=${encodeURIComponent("<img src=x onerror=alert(1)>")}`,
    },
    {
      name: "schéma javascript dans la query",
      // Assemblé en morceaux : no-script-url refuse le littéral, même dans un test.
      suffix: `?next=${encodeURIComponent(["javascript", "alert(1)"].join(":"))}`,
    },
    { name: "HTML dans le hash", suffix: `#${encodeURIComponent("<svg onload=alert(1)>")}` },
    { name: "query trop longue", suffix: `?x=${"A".repeat(8000)}` },
    {
      name: "unicode exotique",
      suffix: `?t=${encodeURIComponent(`${String.fromCodePoint(0x202e)}🧾${String.fromCodePoint(0)}עברית`)}`,
    },
    { name: "mauvais type", suffix: "?look=-1&look[]=2&look=NaN" },
  ];

  for (const { name, suffix } of hostileSuffixes) {
    test(`Robustesse · ${name} : page intacte, aucun script, liens inchangés`, async ({ page }) => {
      const errors: string[] = [];
      let dialog = false;
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("dialog", async (event) => {
        dialog = true;
        await event.dismiss();
      });
      const response = await page.goto(suffix);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Collection Paperasse");
      const hrefs = await page
        .getByRole("link")
        .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      expect(hrefs).toEqual([...LOOKS.map((look) => `${BASE_PATH}${look.slug}/`), REPO_URL]);
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
      expect(dialog).toBe(false);
      expect(errors).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Tour 2 : points précisés dans la spec depuis le tour 1.
// ---------------------------------------------------------------------------------------------

/** specs/lookbook.md (Design) : document et police de chaque aperçu, dans l'ordre des looks. */
const PREVIEW_OF: Record<(typeof LOOKS)[number]["slug"], { document: RegExp; font: string }> = {
  "reunion-metre": { document: /ticket/iu, font: "Doto" },
  "jure-crache": { document: /acte/iu, font: "Young Serif" },
  "sav-de-ta-vie": { document: /listing/iu, font: "Courier Prime" },
};

test.describe("lookbook · tester tour 2", () => {
  // CA-2 (tour 2) testait « une seule colonne sous 960 px » à 600, 768 et 959 px. La spec dit
  // désormais « 640 à 999 px : 2 colonnes » : voir les tests de seuils du bloc
  // « lookbook · disposition » en fin de fichier (639, 640, 999, 1000 px).

  // Contenu : « un aperçu statique en HTML/CSS (une miniature du document du look, role="img"
  // avec un nom accessible) » ; Design : « chaque look = un aperçu de son document (ticket, acte,
  // listing) » et « Les aperçus de chaque look reprennent les polices de ce look ».
  for (const look of LOOKS) {
    test(`Contenu · l'aperçu du Look ${look.number} est une miniature HTML/CSS nommée`, async ({
      page,
    }) => {
      const expected = PREVIEW_OF[look.slug];
      await page.goto("");
      await page.evaluate(() => document.fonts.ready);
      const card = page.getByRole("article", { name: look.name, exact: true });
      const previews = card.getByRole("img");
      await expect(previews).toHaveCount(1);
      const preview = previews.first();
      await expect(preview).toBeVisible();
      await expect(preview).toHaveAttribute("role", "img");
      await expect(preview).toHaveAccessibleName(expected.document);

      const markup = await preview.evaluate((element) => {
        const nodes = [element, ...element.querySelectorAll("*")];
        return {
          media: element.querySelectorAll("img, picture, canvas, object, embed, iframe, video")
            .length,
          urlBackgrounds: nodes
            .map((node) => getComputedStyle(node).backgroundImage)
            .filter((image) => image.includes("url(")),
          htmlText: [...element.querySelectorAll("*")]
            .filter((node) => node.closest("svg") === null)
            .map((node) =>
              [...node.childNodes]
                .filter((child) => child.nodeType === Node.TEXT_NODE)
                .map((child) => child.textContent ?? "")
                .join("")
                .trim(),
            )
            .filter(Boolean).length,
        };
      });
      expect(markup.media, "aucune image matricielle ni média").toBe(0);
      expect(markup.urlBackgrounds, "aucun fond en url()").toEqual([]);
      expect(markup.htmlText, "du texte HTML, pas une image").toBeGreaterThan(0);

      const fonts = await preview.evaluate((element) =>
        [...element.querySelectorAll("*")]
          .filter((node) =>
            [...node.childNodes].some(
              (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim(),
            ),
          )
          .map((node) => getComputedStyle(node).fontFamily.split(",")[0]?.replaceAll('"', "")),
      );
      expect(fonts, `police ${expected.font} dans l'aperçu`).toContain(expected.font);
      expect(
        await page.evaluate((family) => document.fonts.check(`16px "${family}"`), expected.font),
      ).toBe(true);
    });
  }

  // CLAUDE.md (« Vrais éléments ») et WCAG 2.5.3 : le nom accessible d'un lien contient son texte
  // visible, sinon la commande vocale « clique sur Essayer le Look 01 » échoue. Axe ne l'active
  // pas par défaut (règle expérimentale label-content-name-mismatch).
  test("CA-4 · le nom accessible de chaque lien contient son texte visible", async ({ page }) => {
    await page.goto("");
    const problems: string[] = [];
    for (const link of await page.getByRole("link").all()) {
      const visible = normalizeSpaces((await link.innerText()).replaceAll("→", "")).toLowerCase();
      const name = normalizeSpaces(
        await link.evaluate(
          (element) => element.getAttribute("aria-label") ?? element.textContent ?? "",
        ),
      ).toLowerCase();
      if (!name.includes(visible)) problems.push(`« ${visible} » absent de « ${name} »`);
    }
    expect(problems).toEqual([]);
  });

  // Le CollectionTag vu par un lecteur d'écran : « · » et « → » sont décoratifs, les deux liens
  // ont un nom qui se suffit (specs/lookbook.md, « Le CollectionTag »).
  for (const [index, look] of LOOKS.entries()) {
    test(`CA-5 · noms accessibles de l'étiquette du Look ${look.number}`, async ({ page }) => {
      await page.goto(`${look.slug}/`);
      const tag = page.getByRole("navigation", { name: "Collection", exact: true });
      const links = tag.getByRole("link");
      await expect(links).toHaveCount(2);
      await expect(links.first()).toHaveAccessibleName("Collection Paperasse · AH26");
      const nextLook = LOOKS[index + 1];
      const nextName =
        nextLook === undefined ? "Retour au lookbook" : `Suivant${NBSP}: ${nextLook.name}`;
      // Flèche hors du nom ; l'insécable est vérifiée telle quelle dans collection.spec.ts.
      await expect(links.last()).toHaveAccessibleName(normalizeSpaces(nextName));
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Tour 3 : précisions de la spec après le tour 2 (commit dbbb141).
// ---------------------------------------------------------------------------------------------

const NARROW_NBSP = String.fromCodePoint(0x202f);

test.describe("lookbook · tester tour 3", () => {
  // Design : « Insécable : U+00A0 partout (pas d'espace fine U+202F), pour un seul cas à
  // tester. » support/text.ts › normalizeSpaces confond les deux : on cherche U+202F à la source.
  test("Typo · aucune espace fine insécable U+202F dans le HTML, le CSS ni le rendu", async ({
    page,
    request,
  }) => {
    const html = await (await request.get("")).text();
    expect(html.includes(NARROW_NBSP), "caractère U+202F dans le HTML").toBe(false);
    expect(html, "entité U+202F dans le HTML").not.toMatch(
      /&#x0*202f;|&#8239;|&NarrowNoBreakSpace;/iu,
    );
    await page.goto("");
    const texts = await perceivedTexts(page, page.locator("body"));
    for (const { where, text } of texts) {
      expect(text.includes(NARROW_NBSP), where).toBe(false);
    }
    const stylesheets = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(stylesheets.length).toBeGreaterThan(0);
    for (const href of stylesheets) {
      const css = await (await request.get(new URL(href, page.url()).href)).text();
      expect(css.includes(NARROW_NBSP), href).toBe(false);
      // content: "\202F" dans une pseudo-classe.
      expect(css, href).not.toMatch(/\\0*202f/iu);
    }
  });

  // L'étiquette fait partie de la spec du lookbook (« Le CollectionTag ») : même règle.
  for (const look of LOOKS) {
    test(`Typo · CA-5 · aucune U+202F dans l'étiquette du Look ${look.number}`, async ({
      page,
    }) => {
      await page.goto(`${look.slug}/`);
      const tag = page.getByRole("navigation", { name: "Collection", exact: true });
      const text = await tag.evaluate((element) =>
        [
          element instanceof HTMLElement ? element.innerText : "",
          element.textContent ?? "",
          ...[...element.querySelectorAll("[aria-label]")].map(
            (node) => node.getAttribute("aria-label") ?? "",
          ),
        ].join("|"),
      );
      expect(text.includes(NARROW_NBSP)).toBe(false);
      expect(text).toContain(NBSP);
    });
  }

  // Design : « Un aperçu peut contenir un SVG inline décoratif (le sceau de l'acte), en
  // aria-hidden. » Décoratif : invisible pour les lecteurs d'écran, inerte, et inline (rien de
  // chargé, CA-3). L'aperçu reste une image nommée (testé au tour 2).
  for (const look of LOOKS) {
    test(`Contenu · tout SVG de l'aperçu du Look ${look.number} est inline, décoratif et inerte`, async ({
      page,
    }) => {
      await page.goto("");
      const preview = page.getByRole("article", { name: look.name, exact: true }).getByRole("img");
      await expect(preview).toHaveCount(1);
      const svgs = await preview.evaluate((element) =>
        [...element.querySelectorAll("svg")].map((svg) => ({
          ariaHidden: svg.getAttribute("aria-hidden"),
          role: svg.getAttribute("role"),
          focusable: svg.querySelectorAll("a, [tabindex], foreignObject").length,
          tabindex: svg.getAttribute("tabindex"),
          external: [...svg.querySelectorAll("image, use, script, feImage")].length,
          hrefs: [svg, ...svg.querySelectorAll("*")].filter(
            (node) => node.hasAttribute("href") || node.hasAttribute("xlink:href"),
          ).length,
          urlRefs: [svg, ...svg.querySelectorAll("*")].filter((node) =>
            [...node.attributes].some((attribute) =>
              /url\(\s*['"]?[^#'"\s)]/iu.test(attribute.value),
            ),
          ).length,
          handlers: [svg, ...svg.querySelectorAll("*")].filter((node) =>
            [...node.attributes].some((attribute) => /^on/iu.test(attribute.name)),
          ).length,
        })),
      );
      if (look.slug === "jure-crache") {
        // Le sceau de l'acte est cité par la spec : s'il est en SVG, il doit être là une fois.
        expect(svgs.length).toBeLessThanOrEqual(1);
      }
      for (const svg of svgs) {
        expect(svg.ariaHidden, "aria-hidden").toBe("true");
        expect(svg.role, "pas de rôle qui l'exposerait").toBeNull();
        expect(svg.tabindex, "pas focusable").toBeNull();
        expect(svg.focusable, "aucun lien ni élément focusable dedans").toBe(0);
        expect(svg.external, "aucun image/use/script/feImage").toBe(0);
        expect(svg.hrefs, "aucun href").toBe(0);
        expect(svg.urlRefs, "aucune url() externe").toBe(0);
        expect(svg.handlers, "aucun gestionnaire d'événement").toBe(0);
      }
      // Le texte du SVG (le « § » du sceau) ne fuit pas dans le nom de l'image. (Pas
      // d'ariaSnapshot ici : Playwright y liste les enfants d'un role="img", que Chrome traite
      // comme présentationnels, ARIA 1.2.)
      const svgText = await preview.evaluate((element) =>
        [...element.querySelectorAll("svg")].map((svg) => (svg.textContent ?? "").trim()).join(""),
      );
      const name = (await preview.getAttribute("aria-label")) ?? "";
      if (svgText !== "") expect(name.includes(svgText), svgText).toBe(false);
    });
  }

  // Design : « Le lien GitHub posé sur un post-it penche avec lui. » Et les boutons, eux,
  // restent droits (tour 2) : ce lien est l'exception, pas la règle.
  test("Design · le lien GitHub penche avec son post-it", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("");
    await page.mouse.move(0, 0);
    const repo = page.getByRole("contentinfo").getByRole("link", { name: /GitHub/u });
    await expect(repo).toHaveCount(1);
    // Le post-it : l'ancêtre le plus proche qui a un fond.
    const host = await repo.evaluateHandle((element) => {
      let node: Element | null = element.parentElement;
      while (node !== null && getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)") {
        node = node.parentElement;
      }
      return node ?? document.body;
    });
    const noteBackground = await host.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    const note = await host.evaluate(effectiveRotation);
    const link = await repo.evaluate(effectiveRotation);
    // Post-it : un des fonds de post-it de la maquette (bleu de la spec, ou jaune d'affiche).
    expect(["rgb(167, 224, 242)", "rgb(255, 228, 92)"]).toContain(noteBackground);
    expect(Math.abs(note)).toBeGreaterThan(0.2);
    expect(Math.abs(link)).toBeGreaterThan(0.2);
    expect(link).toBeCloseTo(note, 1);
  });
});

// ---------------------------------------------------------------------------------------------
// Disposition « tout sur un écran » (specs/lookbook.md, section « Disposition », CA-2 réécrit,
// CA-6, CA-7 ; commit 5f0cb22).
// ---------------------------------------------------------------------------------------------

type Box = { x: number; y: number; width: number; height: number };

const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;
const centerY = (box: Box) => box.y + box.height / 2;

/** Boîte d'un élément visible ; les boîtes des éléments inclinés englobent la rotation. */
async function boxOf(locator: ReturnType<Page["locator"]>, what: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${what} invisible`);
  return box;
}

/**
 * Un post-it, repéré par son texte (spec, « Contenu ») et non par une classe CSS : l'ancêtre le
 * plus proche du texte qui porte un fond. Renvoie sa boîte (rotation comprise, comme
 * boundingBox) et la couleur de ce fond.
 */
async function postItOf(page: Page, text: RegExp) {
  const anchor = page.getByRole("contentinfo").getByText(text);
  await expect(anchor).toHaveCount(1);
  return anchor.evaluate((element) => {
    let node: Element | null = element;
    while (node !== null && getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)") {
      node = node.parentElement;
    }
    if (node === null) return null;
    const rect = node.getBoundingClientRect();
    return {
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      background: getComputedStyle(node).backgroundColor,
      // Le lien GitHub est-il posé sur ce post-it ?
      hasRepoLink: node.querySelector('a[href*="github.com"]') !== null,
    };
  });
}

/** « jaune » : rouge et vert dominants, bleu nettement plus bas (aucun token pour ce post-it). */
function isYellow(background: string) {
  const [r = 0, g = 0, b = 0] = (background.match(/\d+/gu) ?? []).map(Number);
  return r >= 200 && g >= 180 && b <= 160 && r - b >= 80;
}

/** L'affiche, les trois cartes et les deux post-its (jaune puis bleu), tels qu'affichés. */
async function layoutOf(page: Page) {
  const [first, second, third] = await cardsOf(page);
  if (first === undefined || second === undefined || third === undefined) throw new Error();
  // specs/lookbook.md, « Contenu » : jaune « Prochaine collection : bientôt. », bleu « Aucun
  // cookie, aucun compte, aucun serveur. ». Repérés par leur texte, couleur vérifiée : un
  // échange des couleurs ou de l'ordre du HTML ne passe plus inaperçu.
  const yellowNote = await postItOf(page, /Prochaine collection/u);
  const blueNote = await postItOf(page, /Aucun cookie/u);
  if (yellowNote === null || blueNote === null) throw new Error("post-it sans fond");
  expect(isYellow(yellowNote.background), `post-it jaune : ${yellowNote.background}`).toBe(true);
  expect(blueNote.background, "post-it bleu #A7E0F2").toBe("rgb(167, 224, 242)");
  const banner = page.getByRole("banner");
  const posterWidth = await banner.evaluate((element) =>
    element instanceof HTMLElement ? element.offsetWidth : 0,
  );
  const mainWidth = await page
    .getByRole("main")
    .evaluate((element) => (element instanceof HTMLElement ? element.offsetWidth : 0));
  return {
    cards: [first, second, third] as const,
    poster: await boxOf(banner, "affiche"),
    posterWidth,
    mainWidth,
    yellow: yellowNote.box,
    blue: blueNote.box,
  };
}

type Layout = Awaited<ReturnType<typeof layoutOf>>;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "défilement horizontal").toBeLessThanOrEqual(0);
}

/** Tableau « Disposition », ligne « ≥ 1000 px ». */
function expectWide(layout: Layout, width: number) {
  const { cards, poster, yellow, blue } = layout;
  const [first, second, third] = cards;
  // 3 colonnes : même ligne, côte à côte, dans l'écran.
  expect(Math.abs(second.y - first.y)).toBeLessThan(1);
  expect(Math.abs(third.y - first.y)).toBeLessThan(1);
  expect(second.x).toBeGreaterThanOrEqual(right(first));
  expect(third.x).toBeGreaterThanOrEqual(right(second));
  expect(right(third)).toBeLessThanOrEqual(width);
  // Affiche : bandeau centré.
  expect(Math.abs(poster.x + poster.width / 2 - width / 2)).toBeLessThan(2);
  // Post-its : jaune à gauche, bleu à droite de l'affiche, sur sa hauteur, au-dessus des looks.
  expect(right(yellow), "jaune à gauche de l'affiche").toBeLessThanOrEqual(poster.x);
  expect(blue.x, "bleu à droite de l'affiche").toBeGreaterThanOrEqual(right(poster));
  for (const note of [yellow, blue]) {
    expect(note.y).toBeLessThan(bottom(poster));
    expect(bottom(note)).toBeGreaterThan(poster.y);
    expect(bottom(note)).toBeLessThanOrEqual(first.y);
    expect(note.x).toBeGreaterThanOrEqual(0);
    expect(right(note)).toBeLessThanOrEqual(width);
  }
}

/** Tableau « Disposition », ligne « 640 à 999 px ». */
function expectMedium(layout: Layout) {
  const { cards, posterWidth, mainWidth, yellow, blue } = layout;
  const [first, second, third] = cards;
  // Affiche pleine largeur (largeur de mise en page, hors inclinaison).
  expect(Math.abs(posterWidth - mainWidth)).toBeLessThanOrEqual(1);
  // 2 colonnes : 01 et 02 sur la même ligne, le 3e seul sur la ligne suivante, sous le 01.
  expect(Math.abs(second.y - first.y)).toBeLessThan(1);
  expect(second.x).toBeGreaterThanOrEqual(right(first));
  expect(third.y).toBeGreaterThanOrEqual(Math.max(bottom(first), bottom(second)));
  expect(Math.abs(third.x - first.x)).toBeLessThan(1);
  expect(Math.abs(third.width - first.width)).toBeLessThan(1);
  // Post-its côte à côte, sous les looks.
  expect(Math.abs(centerY(blue) - centerY(yellow))).toBeLessThan(20);
  expect(blue.x).toBeGreaterThanOrEqual(right(yellow));
  for (const note of [yellow, blue]) expect(note.y).toBeGreaterThanOrEqual(bottom(third));
}

/** Tableau « Disposition », ligne « < 640 px ». */
function expectNarrow(layout: Layout, width: number) {
  const { cards, posterWidth, mainWidth, yellow, blue } = layout;
  const [first, second, third] = cards;
  expect(Math.abs(posterWidth - mainWidth)).toBeLessThanOrEqual(1);
  // 1 colonne : empilées, mêmes bords, dans l'écran.
  expect(second.y).toBeGreaterThanOrEqual(bottom(first));
  expect(third.y).toBeGreaterThanOrEqual(bottom(second));
  for (const box of [second, third]) {
    expect(Math.abs(box.x - first.x)).toBeLessThan(1);
    expect(Math.abs(box.width - first.width)).toBeLessThan(1);
  }
  for (const box of cards) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(right(box)).toBeLessThanOrEqual(width);
  }
  // Post-its l'un sous l'autre, sous les looks.
  expect(yellow.y).toBeGreaterThanOrEqual(bottom(third));
  expect(blue.y).toBeGreaterThanOrEqual(bottom(yellow));
}

test.describe("lookbook · disposition", () => {
  test("CA-2 · à 1280 px : bandeau centré, titre sur une ligne, 3 colonnes, post-its de part et d'autre", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    expectWide(await layoutOf(page), 1280);
    await noHorizontalScroll(page);

    // « titre sur une ligne » : la hauteur de mise en page du h1 (hors inclinaison de l'affiche,
    // qui décale le haut des fragments de texte) reste celle d'une ligne, pas de deux.
    const title = await page.getByRole("heading", { level: 1 }).evaluate((h1) => ({
      height: h1 instanceof HTMLElement ? h1.offsetHeight : 0,
      fontSize: parseFloat(getComputedStyle(h1).fontSize),
    }));
    expect(title.height).toBeGreaterThan(0);
    expect(title.height, "titre sur une ligne").toBeLessThan(1.6 * title.fontSize);
  });

  test("CA-2 · à 800 px : affiche pleine largeur, 2 colonnes, post-its côte à côte dessous", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    expectMedium(await layoutOf(page));
    await noHorizontalScroll(page);
  });

  test("CA-2 · à 360 px : affiche pleine largeur, 1 colonne, post-its l'un sous l'autre", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    expectNarrow(await layoutOf(page), 360);
    await noHorizontalScroll(page);
  });

  // Les seuils du tableau, de part et d'autre de chaque bascule.
  const thresholds = [
    { width: 639, check: "narrow" },
    { width: 640, check: "medium" },
    { width: 999, check: "medium" },
    { width: 1000, check: "wide" },
  ] as const;
  for (const { width, check } of thresholds) {
    test(`CA-2 · seuil à ${width} px : disposition « ${check} »`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width, height: 900 });
      await page.goto("");
      await page.evaluate(() => document.fonts.ready);
      const layout = await layoutOf(page);
      if (check === "narrow") expectNarrow(layout, width);
      if (check === "medium") expectMedium(layout);
      if (check === "wide") expectWide(layout, width);
      await noHorizontalScroll(page);
    });
  }

  // Design : « numéro et nom du look sur la même ligne à 1280 px, largeur de la maquette ;
  // repli autorisé en dessous ».
  test("Design · à 1280 px, numéro et nom de chaque look sur la même ligne", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    for (const look of LOOKS) {
      const card = page.getByRole("article", { name: look.name, exact: true });
      const number = await boxOf(
        card.getByText(`Look ${look.number}`, { exact: true }),
        `numéro ${look.number}`,
      );
      const name = await boxOf(card.getByRole("heading", { name: look.name }), look.name);
      expect(name.x, `${look.name} à droite du numéro`).toBeGreaterThanOrEqual(right(number));
      expect(name.y, look.name).toBeLessThan(bottom(number));
      expect(bottom(name), look.name).toBeGreaterThan(number.y);
    }
  });

  // CA-6 : « À 1280×720, aucun défilement vertical : scrollHeight ≤ innerHeight, polices
  // chargées. » Et la section « Disposition » : fiches complètes, affiche d'environ 160 px,
  // « on réduit d'abord la hauteur des aperçus, jamais les fiches ».
  test("CA-6 · à 1280×720, polices chargées, toute la page tient sans défilement vertical", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");
    // Polices réellement chargées : sans elles, les replis système fausseraient la mesure.
    const families = await page.evaluate(() =>
      [...document.fonts]
        .filter((font) => font.status === "loaded")
        .map((font) => font.family.replaceAll('"', "")),
    );
    for (const family of [
      "Alfa Slab One",
      "JetBrains Mono",
      "Doto",
      "Young Serif",
      "Courier Prime",
    ]) {
      expect(families, family).toContain(family);
    }

    const sizes = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      innerHeight,
    }));
    expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.innerHeight);
    expect(sizes.bodyScrollHeight).toBeLessThanOrEqual(sizes.innerHeight);

    // Tout est dans l'écran : affiche, fiche complète et lien de chaque look, post-its.
    const inside = async (locator: ReturnType<Page["locator"]>, what: string) => {
      const box = await boxOf(locator, what);
      expect(box.y, `${what} : haut`).toBeGreaterThanOrEqual(0);
      expect(bottom(box), `${what} : bas`).toBeLessThanOrEqual(720);
    };
    await inside(page.getByRole("banner"), "affiche");
    for (const look of LOOKS) {
      const card = page.getByRole("article", { name: look.name, exact: true });
      await inside(card, look.name);
      for (const term of await card.getByRole("term").all()) await inside(term, look.name);
      for (const value of await card.getByRole("definition").all()) await inside(value, look.name);
      await inside(card.getByRole("link"), `lien ${look.name}`);
    }
    for (const note of await page
      .getByRole("contentinfo")
      .getByText(/Prochaine collection|Aucun cookie|GitHub/u)
      .all()) {
      await inside(note, await note.innerText());
    }

    // Bandeau compact : environ 160 px de haut (hors inclinaison).
    const posterHeight = await page
      .getByRole("banner")
      .evaluate((element) => (element instanceof HTMLElement ? element.offsetHeight : 0));
    expect(posterHeight).toBeGreaterThanOrEqual(120);
    expect(posterHeight).toBeLessThanOrEqual(200);
  });

  // « Si la place manque, on réduit d'abord la hauteur des aperçus, jamais les fiches » : la
  // fiche a les mêmes corps de texte à 1280 px qu'à 360 px, où rien ne contraint la hauteur.
  test("CA-6 · les fiches ne sont pas réduites pour tenir à 1280×720", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    const fontSizes = async () =>
      page
        .getByRole("article")
        .evaluateAll((cards) =>
          cards.map((card) =>
            [...card.querySelectorAll("p, dt, dd, a")]
              .filter((node) => node.closest('[role="img"]') === null)
              .map((node) => getComputedStyle(node).fontSize),
          ),
        );
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("");
    const narrow = await fontSizes();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("");
    expect(await fontSizes()).toEqual(narrow);
    // Aucune fiche rognée : rien n'y masque son débordement, et l'étiquette (le parent de la
    // liste Matière / Coupe / Prix) contient tout son contenu.
    const clipped = await page.getByRole("article").evaluateAll((cards) =>
      cards.flatMap((card) => {
        const label = card.querySelector("dl")?.parentElement;
        if (!(label instanceof HTMLElement)) return ["étiquette introuvable"];
        const hidden = [label, ...label.querySelectorAll("*")]
          .filter((node) => getComputedStyle(node).overflow !== "visible")
          .map((node) => `${node.tagName} : overflow masqué`);
        if (label.scrollHeight > label.clientHeight + 1) hidden.push("étiquette qui déborde");
        return hidden;
      }),
    );
    expect(clipped).toEqual([]);
  });

  // CA-7 : « L'ordre de tabulation suit l'ordre du HTML : affiche, looks 01 à 03, puis le lien
  // GitHub. » Contenu : les post-its viennent « après les looks (ordre de lecture et de
  // tabulation), même quand ils s'affichent sur les côtés ». Testé aux trois dispositions.
  for (const { width, height } of [
    { width: 1280, height: 720 },
    { width: 800, height: 900 },
    { width: 360, height: 780 },
  ]) {
    test(`CA-7 · à ${width} px, Tab parcourt les looks 01 à 03 puis le lien GitHub`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width, height });
      await page.goto("");
      const expected = [...LOOKS.map((look) => `${BASE_PATH}${look.slug}/`), REPO_URL];
      const reached: (string | null)[] = [];
      for (let press = 0; press < expected.length; press += 1) {
        await page.keyboard.press("Tab");
        reached.push(
          await page.evaluate(() => document.activeElement?.getAttribute("href") ?? null),
        );
      }
      expect(reached).toEqual(expected);
      // Après le lien GitHub, plus rien dans la page.
      await page.keyboard.press("Tab");
      const after = await page.evaluate(() => {
        const active = document.activeElement;
        if (active === null || active === document.body) return null;
        return `${active.tagName} ${active.getAttribute("href") ?? ""}`.trim();
      });
      expect(after).toBeNull();
    });
  }

  test("CA-7 · ordre du HTML : affiche, puis looks 01 à 03, puis les post-its", async ({
    page,
  }) => {
    await page.goto("");
    const order = await page.evaluate(() => {
      const banner = document.querySelector("header");
      const articles = [...document.querySelectorAll("main article")];
      const footer = document.querySelector("footer");
      if (banner === null || footer === null) return null;
      const sequence = [banner, ...articles, footer];
      const follows = sequence
        .slice(1)
        .map(
          (node, index) =>
            ((sequence[index]?.compareDocumentPosition(node) ?? 0) &
              Node.DOCUMENT_POSITION_FOLLOWING) !==
            0,
        );
      return {
        titles: articles.map((article) => article.querySelector("h3")?.textContent ?? ""),
        follows,
        // Rien de focalisable dans l'affiche : elle ouvre la lecture, pas la tabulation.
        focusableInBanner: banner.querySelectorAll("a, button, input, [tabindex]").length,
        // Aucun tabindex positif ni order CSS qui contredirait le HTML.
        positiveTabindex: [...document.querySelectorAll("[tabindex]")].filter(
          (node) => Number(node.getAttribute("tabindex")) > 0,
        ).length,
        reordered: [...document.querySelectorAll("body *")].filter(
          (node) => getComputedStyle(node).order !== "0",
        ).length,
      };
    });
    expect(order).toEqual({
      titles: LOOKS.map((look) => look.name),
      follows: [true, true, true, true],
      focusableInBanner: 0,
      positiveTabindex: 0,
      reordered: 0,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Tester, tour 1 de la retouche « tout sur un écran » : ce que les tests du builder ne
// tranchaient pas encore (titre qui déborde de l'affiche, nom coupé, texte recouvert ou rogné
// pour tenir dans 720 px, couleur et contenu de chaque post-it).
// ---------------------------------------------------------------------------------------------

/**
 * Lignes occupées par le texte d'un élément (Range.getClientRects, une boîte par fragment) et
 * boîte englobante de ce texte. Autonome (sérialisée par Playwright).
 */
function textLines(element: Element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
  // Deux fragments sont sur la même ligne si leurs boîtes se recouvrent verticalement de plus
  // de la moitié de la plus petite (les glyphes de corps différents n'ont pas le même haut).
  const lines: { top: number; bottom: number }[] = [];
  for (const rect of rects) {
    const line = lines.find(
      (candidate) =>
        Math.min(candidate.bottom, rect.bottom) - Math.max(candidate.top, rect.top) >
        Math.min(candidate.bottom - candidate.top, rect.height) / 2,
    );
    if (line === undefined) lines.push({ top: rect.top, bottom: rect.bottom });
  }
  const box = range.getBoundingClientRect();
  return { lines: lines.length, left: box.left, right: box.right };
}

test.describe("lookbook · tester tour 1 (tout sur un écran)", () => {
  // Tableau « Disposition », ligne « ≥ 1000 px » : « bandeau centré, titre sur une ligne ». Le
  // test du builder ne mesure que la hauteur du h1 à 1280 px : un titre forcé sur une ligne
  // (white-space: nowrap) qui sortirait du bandeau, sur les post-its, passerait. On vérifie la
  // ligne unique ET que le texte reste dans l'affiche, du seuil de 1000 px jusqu'au plein écran.
  for (const width of [1000, 1100, 1280, 1440]) {
    test(`CA-2 · à ${width} px, le titre tient sur une ligne et reste dans l'affiche`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width, height: 720 });
      await page.goto("");
      await page.evaluate(() => document.fonts.ready);
      const title = page.getByRole("heading", { level: 1 });
      const text = await title.evaluate(textLines);
      expect(text.lines, "titre sur une ligne").toBe(1);
      const overflow = await title.evaluate((h1) => h1.scrollWidth - h1.clientWidth);
      expect(overflow, "texte du titre plus large que sa boîte").toBeLessThanOrEqual(0);
      const poster = await boxOf(page.getByRole("banner"), "affiche");
      expect(text.left, "titre sorti de l'affiche à gauche").toBeGreaterThanOrEqual(poster.x);
      expect(text.right, "titre sorti de l'affiche à droite").toBeLessThanOrEqual(right(poster));
    });
  }

  // Tableau « Disposition », ligne « ≥ 1000 px » : elle n'a pas de borne haute. L'ancien test
  // CA-2 vérifiait 1440 px ; les tests du builder s'arrêtent à 1280. Grands écrans courants.
  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    test(`CA-2 · à ${width} px, toujours la disposition « ≥ 1000 px », sans défilement`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width, height });
      await page.goto("");
      await page.evaluate(() => document.fonts.ready);
      expectWide(await layoutOf(page), width);
      await noHorizontalScroll(page);
      // Plus grand que 1280×720 dans les deux sens : ce qui tient à 1280×720 doit tenir ici.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      );
      expect(overflow, "défilement vertical").toBeLessThanOrEqual(0);
    });
  }

  // Design : « numéro et nom du look sur la même ligne à 1280 px ». Le test du builder vérifie
  // que le nom commence à droite du numéro, mais un nom lui-même replié (« Le SAV de » / « ta
  // vie ») passerait : la moitié du nom ne serait plus sur la ligne du numéro.
  test("Design · à 1280 px, numéro et nom de chaque look tiennent ensemble sur une seule ligne", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    for (const look of LOOKS) {
      const card = page.getByRole("article", { name: look.name, exact: true });
      const number = await card
        .getByText(`Look ${look.number}`, { exact: true })
        .evaluate(textLines);
      const name = await card.getByRole("heading", { name: look.name }).evaluate(textLines);
      expect(number.lines, `numéro ${look.number} sur une ligne`).toBe(1);
      expect(name.lines, `« ${look.name} » sur une ligne`).toBe(1);
    }
  });

  // CA-6 + section « Disposition » : « toute la page tient » à 1280×720. scrollHeight ne voit
  // pas un texte rogné par un ancêtre (overflow), poussé hors de l'écran par un positionnement,
  // ou recouvert par un autre document punaisé. Chaque texte lisible de la page est vérifié :
  // dans l'écran, entier, et au premier plan en son centre et à ses deux bouts. Les aperçus
  // (role="img") sont exclus : la spec autorise à réduire leur hauteur.
  test("CA-6 · à 1280×720, chaque texte de la page est dans l'écran, ni rogné ni recouvert", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    const report = await page.locator("body").evaluate((body) => {
      const problems: string[] = [];
      let checked = 0;
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        const text = (node.textContent ?? "").trim();
        if (parent === null || text === "") continue;
        if (parent.closest('[role="img"]') !== null) continue;
        // Texte réservé aux lecteurs d'écran (boîte de 1 px) : rien à afficher.
        let hidden = false;
        for (let up: Element | null = parent; up !== null; up = up.parentElement) {
          const box = up.getBoundingClientRect();
          if (box.width <= 1 && box.height <= 1) hidden = true;
        }
        if (hidden) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width === 0 || rect.height === 0) continue;
          checked += 1;
          const what = `« ${text.slice(0, 30)} »`;
          if (
            rect.left < 0 ||
            rect.right > innerWidth ||
            rect.top < 0 ||
            rect.bottom > innerHeight
          ) {
            problems.push(`${what} hors de l'écran`);
            continue;
          }
          for (let up: Element | null = parent; up !== null; up = up.parentElement) {
            const style = getComputedStyle(up);
            const box = up.getBoundingClientRect();
            const clipsX = style.overflowX !== "visible";
            const clipsY = style.overflowY !== "visible";
            if (clipsX && (rect.left < box.left - 1 || rect.right > box.right + 1)) {
              problems.push(`${what} rogné horizontalement par ${up.tagName}`);
            }
            if (clipsY && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) {
              problems.push(`${what} rogné verticalement par ${up.tagName}`);
            }
          }
          const middle = rect.top + rect.height / 2;
          for (const x of [rect.left + 2, rect.left + rect.width / 2, rect.right - 2]) {
            const hit = document.elementFromPoint(x, middle);
            if (hit !== null && !parent.contains(hit) && !hit.contains(parent)) {
              problems.push(
                `${what} recouvert par ${hit.tagName} en (${Math.round(x)}, ${Math.round(middle)})`,
              );
            }
          }
        }
      }
      return { checked, problems: [...new Set(problems)] };
    });
    // Affiche (5 textes), 3 cartes (numéro, nom, accroche, 6 lignes de fiche, lien), post-its.
    expect(report.checked).toBeGreaterThan(40);
    expect(report.problems).toEqual([]);
  });

  // Contenu : « bleu « Aucun cookie, aucun compte, aucun serveur. » avec le lien vers le repo
  // GitHub » ; Disposition : jaune à gauche, bleu à droite à partir de 1000 px. Le test du tour 3
  // acceptait le lien sur l'un ou l'autre post-it.
  for (const { width, height } of [
    { width: 1280, height: 720 },
    { width: 800, height: 900 },
    { width: 360, height: 780 },
  ]) {
    test(`Contenu · à ${width} px, le lien GitHub est sur le post-it bleu « Aucun cookie », pas sur le jaune`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width, height });
      await page.goto("");
      const yellow = await postItOf(page, /Prochaine collection/u);
      const blue = await postItOf(page, /Aucun cookie/u);
      expect(yellow?.hasRepoLink).toBe(false);
      expect(blue?.hasRepoLink).toBe(true);
      expect(blue?.background).toBe("rgb(167, 224, 242)");
      expect(isYellow(yellow?.background ?? ""), yellow?.background).toBe(true);
    });
  }

  // Design : « Alfa Slab One (titres façon affiche en caractères bois, numéros de look) » et
  // « numéros de look #C2410C (uniquement en gros, ≥ 24 px) ». Le test du builder (seuil 24 px)
  // tourne à 1280 et 360 px ; la disposition intermédiaire (800 px) a ses propres règles CSS.
  for (const { width, height } of [
    { width: 1280, height: 720 },
    { width: 1000, height: 720 },
    { width: 800, height: 900 },
    { width: 360, height: 780 },
  ]) {
    test(`Design · à ${width} px, les numéros de look sont en Alfa Slab One orange, ≥ 24 px`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width, height });
      await page.goto("");
      await page.evaluate(() => document.fonts.ready);
      for (const look of LOOKS) {
        const number = page
          .getByRole("article", { name: look.name, exact: true })
          .getByText(`Look ${look.number}`, { exact: true });
        const style = await number.evaluate((element) => {
          const computed = getComputedStyle(element);
          return {
            family: computed.fontFamily.split(",")[0]?.replaceAll('"', "").trim(),
            size: parseFloat(computed.fontSize),
            color: computed.color,
          };
        });
        expect(style.family, `numéro ${look.number}`).toBe("Alfa Slab One");
        expect(style.size, `numéro ${look.number}`).toBeGreaterThanOrEqual(24);
        expect(style.color, `numéro ${look.number}`).toBe("rgb(194, 65, 12)");
      }
    });
  }

  // CA-4 aux bornes de la disposition « ≥ 1000 px » : à 1000 px, l'affiche est la plus étroite,
  // les post-its les plus serrés et le titre au plus juste. Axe passe déjà à 1280 et 360 px
  // (collection.spec.ts) et à 800 px (bloc « tester »).
  test("CA-4 · axe : zéro violation à 1000×720 (bascule vers « tout sur un écran »)", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 1000, height: 720 });
    await page.goto("");
    await page.evaluate(() => document.fonts.ready);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  // CLAUDE.md : focus visible ; .board rogne son débordement horizontal (overflow-x: clip) et
  // la page tient tout juste dans 720 px : le contour de focus (3 px + 3 px de décalage) ne doit
  // être rogné ni par ce conteneur ni par le bas de l'écran, à 1280×720 comme à 1000×720.
  for (const width of [1000, 1280]) {
    test(`CA-7 · à ${width}×720, le contour de focus de chaque lien est entier`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width, height: 720 });
      await page.goto("");
      await page.evaluate(() => document.fonts.ready);
      const problems: string[] = [];
      for (let press = 0; press < 4; press += 1) {
        await page.keyboard.press("Tab");
        const clipped = await page.evaluate(() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return ["aucun élément focalisé"];
          const style = getComputedStyle(active);
          const reach =
            parseFloat(style.outlineWidth) + Math.max(0, parseFloat(style.outlineOffset));
          const box = active.getBoundingClientRect();
          const ring = {
            left: box.left - reach,
            right: box.right + reach,
            top: box.top - reach,
            bottom: box.bottom + reach,
          };
          const name = active.getAttribute("aria-label") ?? active.textContent ?? "";
          const found: string[] = [];
          if (
            ring.top < 0 ||
            ring.bottom > innerHeight ||
            ring.left < 0 ||
            ring.right > innerWidth
          ) {
            found.push(`${name} : contour hors de l'écran`);
          }
          for (let up = active.parentElement; up !== null; up = up.parentElement) {
            const upStyle = getComputedStyle(up);
            const upBox = up.getBoundingClientRect();
            if (
              upStyle.overflowX !== "visible" &&
              (ring.left < upBox.left || ring.right > upBox.right)
            ) {
              found.push(`${name} : contour rogné par ${up.tagName}`);
            }
            if (
              upStyle.overflowY !== "visible" &&
              (ring.top < upBox.top || ring.bottom > upBox.bottom)
            ) {
              found.push(`${name} : contour rogné par ${up.tagName}`);
            }
          }
          return found;
        });
        problems.push(...clipped);
      }
      expect(problems).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Décisions prises : « le titre de l'affiche ne doit jamais sortir de l'affiche, y compris avec
// une taille de police du navigateur agrandie (réglage "Très grande") ».
// ---------------------------------------------------------------------------------------------

test.describe("lookbook · police du navigateur agrandie", () => {
  // « Très grande » dans Chrome = police standard à 24 px. On la règle comme le ferait
  // l'utilisateur, par CDP (Page.setFontSizes) avant le chargement : c'est la taille « medium »
  // du navigateur qui change, donc le rem, sans toucher au HTML ni à la CSP (page.addStyleTag
  // injecterait un <style> que la CSP bloque). Le test vérifie que la racine passe bien à
  // 24 px, sinon il ne prouverait rien. Chromium seulement (CDP).
  const cases = [
    { fontSize: 16, width: 1000 },
    { fontSize: 16, width: 1280 },
    { fontSize: 24, width: 360 },
    { fontSize: 24, width: 800 },
    { fontSize: 24, width: 1000 },
    { fontSize: 24, width: 1280 },
  ] as const;
  for (const { fontSize, width } of cases) {
    test(`titre dans l'affiche à ${width} px, police racine ${fontSize} px`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      if (fontSize !== 16) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontSize } });
      }
      await page.setViewportSize({ width, height: 720 });
      await page.goto("");
      await page.evaluate(() => document.fonts.ready);

      const title = page.getByRole("heading", { level: 1 });
      const metrics = await title.evaluate((h1) => {
        const poster = h1.closest("header");
        if (poster === null) throw new Error("affiche introuvable");
        const range = document.createRange();
        range.selectNodeContents(h1);
        const text = range.getBoundingClientRect();
        const posterStyle = getComputedStyle(poster);
        return {
          rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
          fontSize: parseFloat(getComputedStyle(h1).fontSize),
          titleHeight: h1.clientHeight,
          titleScrollWidth: h1.scrollWidth,
          titleClientWidth: h1.clientWidth,
          posterScrollWidth: poster.scrollWidth,
          posterClientWidth: poster.clientWidth,
          // Largeur de contenu de l'affiche, hors marges intérieures.
          posterContentWidth:
            poster.clientWidth -
            parseFloat(posterStyle.paddingLeft) -
            parseFloat(posterStyle.paddingRight),
          // Boîte du texte (rotation de l'affiche comprise : moins d'un pixel à -0,8 deg).
          text: { left: text.left, right: text.right, width: text.width },
        };
      });
      expect(metrics.rootFontSize, "police racine émulée").toBe(fontSize);
      expect(metrics.titleScrollWidth, "titre qui déborde de sa boîte").toBeLessThanOrEqual(
        metrics.titleClientWidth,
      );
      expect(metrics.text.width, "titre plus large que l'affiche").toBeLessThanOrEqual(
        metrics.posterContentWidth,
      );
      expect(metrics.posterScrollWidth, "affiche qui déborde").toBeLessThanOrEqual(
        metrics.posterClientWidth,
      );

      if (width >= 1000) {
        // Bandeau : titre sur une ligne, entre les deux post-its, sans passer dessous.
        expect(metrics.titleHeight, "titre sur une ligne").toBeLessThan(1.5 * metrics.fontSize);
        const yellow = await postItOf(page, /Prochaine collection/);
        const blue = await postItOf(page, /Aucun cookie/);
        if (yellow === null || blue === null) throw new Error("post-it sans fond");
        expect(metrics.text.left, "titre sous le post-it jaune").toBeGreaterThanOrEqual(
          right(yellow.box),
        );
        expect(metrics.text.right, "titre sous le post-it bleu").toBeLessThanOrEqual(blue.box.x);
      }

      // CA-6 à la police par défaut : le titre recalé ne fait pas défiler la page à 1280×720.
      if (fontSize === 16 && width === 1280) {
        const overflow = await page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        );
        expect(overflow, "défilement vertical à 1280×720").toBeLessThanOrEqual(0);
      }
    });
  }
});
