// Tests du lookbook écrits par l'agent tester à partir de specs/lookbook.md et des règles de
// CLAUDE.md. Ils complètent tests/e2e/lookbook/lookbook.spec.ts (builder) et
// tests/e2e/collection.spec.ts (garde-fous communs) avec des assertions plus strictes.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";

const NBSP = String.fromCodePoint(0xa0);
const NARROW_NBSP = String.fromCodePoint(0x202f);
const EM_DASH = String.fromCodePoint(0x2014);
const BASE_PATH = "/collection-paperasse/";
const REPO_URL = "https://github.com/G0nni/collection-paperasse";

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

/** Les insécables comptent comme des espaces quand on compare au texte de la spec. */
function normalizeSpaces(text: string): string {
  return text.replaceAll(NBSP, " ").replaceAll(NARROW_NBSP, " ").replace(/\s+/gu, " ").trim();
}

// ---------------------------------------------------------------------------------------------
// Typographie : oracle indépendant de apps/lookbook/src/lib/typography.ts.
// ---------------------------------------------------------------------------------------------

function isNonBreaking(char: string | undefined): boolean {
  return char === NBSP || char === NARROW_NBSP;
}

/** Renvoie les fautes trouvées, avec un extrait autour de chacune. */
function typographyIssues(text: string): string[] {
  const issues: string[] = [];
  const chars = Array.from(text);
  const context = (index: number) =>
    JSON.stringify(
      chars
        .slice(Math.max(0, index - 15), index + 15)
        .join("")
        .replaceAll(NBSP, "⍽")
        .replaceAll(NARROW_NBSP, "⍽"),
    );
  chars.forEach((char, index) => {
    const previous = chars[index - 1];
    const next = chars[index + 1];
    if (char === EM_DASH) issues.push(`tiret cadratin ${context(index)}`);
    if (char === "«" && !isNonBreaking(next)) {
      issues.push(`pas d'insécable après « ${context(index)}`);
    }
    if (char === "»" && !isNonBreaking(previous)) {
      issues.push(`pas d'insécable avant » ${context(index)}`);
    }
    if (":;!?".includes(char) && index > 0) {
      // Heure (14:30) ou schéma d'URL (https://) : pas d'espace.
      if (char === ":" && /\d/u.test(previous ?? "") && /\d/u.test(next ?? "")) return;
      if (char === ":" && next === "/") return;
      // « ?! » : seul le premier signe porte l'espace.
      if ("!?".includes(char) && previous !== undefined && "!?".includes(previous)) return;
      if (!isNonBreaking(previous)) {
        issues.push(`pas d'insécable avant « ${char} » ${context(index)}`);
      }
    }
  });
  return issues;
}

/** Tous les textes perçus de la page : rendu (innerText), attributs lus par les lecteurs d'écran. */
async function perceivedTexts(page: Page, root: Locator) {
  const rendered = await root.evaluate((element) => {
    const texts: { where: string; text: string }[] = [];
    if (element instanceof HTMLElement) {
      texts.push({ where: "texte rendu", text: element.innerText });
    }
    for (const node of element.querySelectorAll("[aria-label], [alt], [title]")) {
      for (const attribute of ["aria-label", "alt", "title"]) {
        const value = node.getAttribute(attribute);
        if (value !== null) texts.push({ where: `@${attribute}`, text: value });
      }
    }
    return texts;
  });
  const head = await page.evaluate(() => [
    { where: "<title>", text: document.title },
    {
      where: "meta description",
      text: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    },
  ]);
  return [...rendered, ...head];
}

// ---------------------------------------------------------------------------------------------
// Couleurs et contraste, calculés à partir des styles calculés (axe ne voit ni :hover ni
// :focus-visible, et classe « incomplete » tout ce qui est sur un dégradé).
// ---------------------------------------------------------------------------------------------

type Rgba = { r: number; g: number; b: number; a: number };

type Layer = { background: string; image: string; opacity: string };

type StyleSnapshot = {
  text: string;
  color: string;
  fontSize: number;
  fontWeight: number;
  /** Du nœud lui-même jusqu'à <html>. */
  chain: Layer[];
};

function parseColor(value: string): Rgba[] {
  const colors: Rgba[] = [];
  for (const match of value.matchAll(/rgba?\(([^)]+)\)/gu)) {
    const parts = (match[1] ?? "")
      .split(/[\s,/]+/u)
      .filter(Boolean)
      .map(Number);
    const [r = 0, g = 0, b = 0, a = 1] = parts;
    colors.push({ r, g, b, a });
  }
  for (const match of value.matchAll(/#([0-9a-f]{6})\b/giu)) {
    const hex = match[1] ?? "000000";
    colors.push({
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    });
  }
  return colors;
}

function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(first: Rgba, second: Rgba): number {
  const [light, dark] = [luminance(first), luminance(second)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * Fonds possibles derrière un nœud. Chaque dégradé rencontré ajoute ses couleurs comme fonds
 * candidats (on garde le pire cas). Une image `url(…)` rend le calcul impossible : signalé.
 */
function backdrops(chain: Layer[]): { candidates: Rgba[]; unknown: string[] } {
  const unknown: string[] = [];
  const stack: Layer[] = [];
  for (const layer of chain) {
    stack.push(layer);
    const color = parseColor(layer.background)[0];
    if (color !== undefined && color.a >= 1) break;
  }
  let candidates: Rgba[] = [{ r: 255, g: 255, b: 255, a: 1 }];
  for (const layer of stack.reverse()) {
    const color = parseColor(layer.background)[0] ?? { r: 0, g: 0, b: 0, a: 0 };
    let next = candidates.map((candidate) => over(color, candidate));
    if (layer.image !== "none") {
      if (layer.image.includes("url(")) unknown.push(layer.image);
      for (const stop of parseColor(layer.image)) {
        next = next.concat(candidates.map((candidate) => over(stop, over(color, candidate))));
      }
    }
    if (Number(layer.opacity) < 1) unknown.push(`opacity ${layer.opacity}`);
    candidates = next;
  }
  return { candidates, unknown };
}

function worstContrast(foreground: string, chain: Layer[]) {
  const { candidates, unknown } = backdrops(chain);
  const text = parseColor(foreground)[0] ?? { r: 0, g: 0, b: 0, a: 1 };
  const ratios = candidates.map((background) => contrast(over(text, background), background));
  return { ratio: Math.min(...ratios), unknown };
}

function requiredRatio(snapshot: StyleSnapshot): number {
  const large =
    snapshot.fontSize >= 24 || (snapshot.fontSize >= 18.66 && snapshot.fontWeight >= 700);
  return large ? 3 : 4.5;
}

/** Instantané des nœuds porteurs de texte sous `root` (lui compris). Autonome : sérialisé. */
function snapshotTextNodes(root: Element): StyleSnapshot[] {
  const layerOf = (node: Element) => {
    const style = getComputedStyle(node);
    return {
      background: style.backgroundColor,
      image: style.backgroundImage,
      opacity: style.opacity,
    };
  };
  const result: StyleSnapshot[] = [];
  const nodes = [root, ...root.querySelectorAll("*")];
  for (const node of nodes) {
    if (node.closest("svg") !== null) continue;
    const ownText = [...node.childNodes]
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? "")
      .join("")
      .trim();
    if (ownText === "") continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue;
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.display === "none") continue;
    const chain = [];
    for (let current: Element | null = node; current !== null; current = current.parentElement) {
      chain.push(layerOf(current));
    }
    result.push({
      text: ownText.slice(0, 50),
      color: style.color,
      fontSize: parseFloat(style.fontSize),
      fontWeight: Number(style.fontWeight),
      chain,
    });
  }
  return result;
}

function contrastFailures(snapshots: StyleSnapshot[]): string[] {
  const failures: string[] = [];
  for (const snapshot of snapshots) {
    const { ratio, unknown } = worstContrast(snapshot.color, snapshot.chain);
    const required = requiredRatio(snapshot);
    if (unknown.length > 0) {
      failures.push(`« ${snapshot.text} » : fond non calculable (${unknown.join(", ")})`);
    } else if (ratio < required) {
      failures.push(
        `« ${snapshot.text} » : ${ratio.toFixed(2)}:1 < ${required}:1 (${snapshot.color}, ${snapshot.fontSize}px)`,
      );
    }
  }
  return failures;
}

/** Propriétés qui distinguent un état sans passer par la couleur. */
function nonColorState(element: Element) {
  const style = getComputedStyle(element);
  return {
    textDecorationLine: style.textDecorationLine,
    textDecorationThickness: style.textDecorationThickness,
    textDecorationStyle: style.textDecorationStyle,
    outlineStyle: style.outlineStyle,
    outlineWidth: style.outlineWidth,
    borderWidth: `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`,
    borderStyle: style.borderTopStyle,
    boxShadow: style.boxShadow,
    transform: style.transform,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
  };
}

function colorState(element: Element) {
  const style = getComputedStyle(element);
  return `${style.color} | ${style.backgroundColor} | ${style.textDecorationColor}`;
}

/** Instantané du contour de focus et du fond qui l'entoure (celui du parent). */
function focusRing(element: Element) {
  const style = getComputedStyle(element);
  const chain = [];
  for (
    let current: Element | null = element.parentElement;
    current !== null;
    current = current.parentElement
  ) {
    const parentStyle = getComputedStyle(current);
    chain.push({
      background: parentStyle.backgroundColor,
      image: parentStyle.backgroundImage,
      opacity: parentStyle.opacity,
    });
  }
  return {
    focusVisible: element.matches(":focus-visible"),
    outlineStyle: style.outlineStyle,
    outlineWidth: parseFloat(style.outlineWidth),
    outlineColor: style.outlineColor,
    outlineOffset: parseFloat(style.outlineOffset),
    boxShadow: style.boxShadow,
    chain,
  };
}

/** Angle de rotation effectif (en degrés) d'un élément, ancêtres compris. Autonome. */
function effectiveRotation(element: Element): number {
  let a = 1;
  let b = 0;
  let c = 0;
  let d = 1;
  for (let current: Element | null = element; current !== null; current = current.parentElement) {
    const transform = getComputedStyle(current).transform;
    if (transform === "none") continue;
    const values = (/matrix\(([^)]+)\)/u.exec(transform)?.[1] ?? "1,0,0,1,0,0")
      .split(",")
      .map(Number);
    const [ma = 1, mb = 0, mc = 0, md = 1] = values;
    // Le transform de l'ancêtre s'applique après celui du descendant : M_ancêtre × M_courant.
    const na = ma * a + mc * b;
    const nb = mb * a + md * b;
    const nc = ma * c + mc * d;
    const nd = mb * c + md * d;
    a = na;
    b = nb;
    c = nc;
    d = nd;
  }
  return (Math.atan2(b, a) * 180) / Math.PI;
}

/** Va au lien `link` au clavier depuis le haut de la page. Échoue s'il n'est jamais atteint. */
async function tabTo(page: Page, link: Locator, maxPresses = 40) {
  await page.locator("body").focus();
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (let press = 0; press < maxPresses; press += 1) {
    await page.keyboard.press("Tab");
    if (await link.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error("lien jamais atteint au clavier");
}

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

  test("CA-2 · à 360 px, les cartes s'empilent et tiennent dans l'écran", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("");
    const [first, second, third] = await cardsOf(page);
    if (first === undefined || second === undefined || third === undefined) throw new Error();
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    expect(third.y).toBeGreaterThanOrEqual(second.y + second.height);
    for (const box of [first, second, third]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  for (const width of [960, 1440]) {
    test(`CA-2 · à ${width} px, trois colonnes alignées sans chevauchement`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("");
      const [first, second, third] = await cardsOf(page);
      if (first === undefined || second === undefined || third === undefined) throw new Error();
      expect(Math.abs(second.y - first.y)).toBeLessThan(1);
      expect(Math.abs(third.y - first.y)).toBeLessThan(1);
      expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
      expect(third.x).toBeGreaterThanOrEqual(second.x + second.width);
      expect(third.x + third.width).toBeLessThanOrEqual(width);
    });
  }

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

  for (const width of [360, 960, 1280]) {
    test(`CA-4 · axe : zéro violation à ${width} px (WCAG 2.2 AA + bonnes pratiques)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("");
      await page.evaluate(() => document.fonts.ready);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
  }

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

  test("CA-5 · on fait le tour par les liens « suivant » et l'étiquette est correcte partout", async ({
    page,
    baseURL,
  }) => {
    const base = new URL(baseURL ?? "http://localhost/collection-paperasse/");
    await page.goto("");
    await page.getByRole("article", { name: LOOKS[0].name, exact: true }).getByRole("link").click();

    for (const [index, look] of LOOKS.entries()) {
      await expect(page).toHaveURL(new URL(`${look.slug}/`, base).href);
      const tags = page.getByRole("navigation", { name: "Collection", exact: true });
      await expect(tags).toHaveCount(1);
      const tag = tags.first();
      expect(await tag.evaluate((element) => element.tagName)).toBe("NAV");

      // Texte de la spec : « COLLECTION PAPERASSE · AH26 · LOOK 02/03 · suivant → ».
      const text = normalizeSpaces(await tag.innerText());
      expect(text).toMatch(
        new RegExp(`^COLLECTION PAPERASSE · AH26 · LOOK ${look.number}/03 · suivant\\b.*→$`, "iu"),
      );

      // Vrais liens : la marque renvoie au lookbook, le dernier lien va au look suivant.
      const links = tag.getByRole("link");
      expect(await links.count()).toBeGreaterThanOrEqual(1);
      const nextLook = LOOKS[index + 1];
      const expectedNext = nextLook === undefined ? BASE_PATH : `${BASE_PATH}${nextLook.slug}/`;
      const next = links.last();
      await expect(next).toHaveAttribute("href", expectedNext);

      // Cousue en bas : rien de visible ne commence sous l'étiquette.
      const tagTop = (await tag.boundingBox())?.y ?? 0;
      const below = await page
        .locator("main")
        .evaluateAll(
          (mains, top) =>
            mains.filter((main) => main.getBoundingClientRect().bottom > top + 1).length,
          tagTop,
        );
      expect(below, "le contenu principal ne doit pas passer sous l'étiquette").toBe(0);

      await next.click();
    }
    await expect(page).toHaveURL(base.href);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Collection Paperasse");
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

  test("CSP · aucun attribut style dans le HTML construit, aucune violation CSP", async ({
    page,
    request,
  }) => {
    for (const path of ["", ...LOOKS.map((look) => `${look.slug}/`)]) {
      const html = await (await request.get(path)).text();
      const styleAttributes = [...html.matchAll(/<[^>]*\sstyle\s*=[^>]*>/giu)].map((m) => m[0]);
      expect(styleAttributes, path || "lookbook").toEqual([]);
    }
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
    await page.goto("");
    await page.waitForLoadState("networkidle");
    for (const link of await page.getByRole("link").all()) await link.hover();
    expect(violations).toEqual([]);
  });

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

  test("Design · l'orange des numéros (#C2410C) n'apparaît qu'en ≥ 34 px", async ({ page }) => {
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
    for (const use of uses) expect(use.size, use.text).toBeGreaterThanOrEqual(34);
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

  test("Design · seuls l'affiche et les aperçus penchent ; fiches, liens et post-its droits", async ({
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
    const footerTilts = await page
      .getByRole("contentinfo")
      .evaluate((footer) =>
        [footer, ...footer.querySelectorAll("*")].map((node) => getComputedStyle(node).transform),
      );
    expect(footerTilts.filter((transform) => transform !== "none")).toEqual([]);
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
