// Tests e2e du tour 3 (agent tester), écrits à partir de la spec mise à jour après le tour 2
// (specs/jure-crache.md) et branchés ensuite par rôle et nom accessible :
// - numéro « N° AAAA- » + 26 caractères base32 Crockford par 4 (ligne 49), lisible et sans
//   coupure au milieu d'un groupe de 360 à 1280 px (CA-11), entier dans le PDF (CA-6) ;
// - « 1er » pour le premier du mois (« Décisions prises »), jamais pour 11, 21, 31 ;
// - pied en marge sur les seules pages de l'acte (CA-6) ;
// - CL-9 : acte dans les bornes dont le lien dépasserait 4 Ko ;
// - CA-7 : focus piégé dans le repli de copie (le copieur est partagé avec le Réunion-mètre,
//   voir tests/e2e/reunion-metre/tester-focus-trap.spec.ts).
//
// Le numéro attendu est calculé ici par un oracle indépendant (chaîne de bits, tranches de 5),
// ni celui de l'app ni celui du builder (tests/e2e/support/crockford.ts). Le temps est contrôlé
// par page.clock (setFixedTime).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type * as LZStringModule from "../../../apps/jure-crache/node_modules/lz-string";
import { countIgnoringSpaces, pdfPageTexts } from "../support/pdf";

const requireFromLook = createRequire(
  new URL("../../../apps/jure-crache/package.json", import.meta.url),
);
const LZString: typeof LZStringModule = requireFromLook("lz-string");

/** Mercredi 14 octobre 2026, 10:00 à Paris (UTC+2). */
const NOW_MS = Date.UTC(2026, 9, 14, 8, 0, 0);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const PDF_ONLY_DESKTOP = "le PDF ne dépend pas de la fenêtre";
const FIXED_VIEWPORT = "fenêtre fixée par le test";

type DeedJson = { p: string; c: string; o: string; e: string; a: string[]; d: number; t: number };

const BASE: DeedJson = {
  p: "Théo",
  c: "Inès",
  o: "Kevin arrivera en retard à la soirée de samedi.",
  e: "Un (1) kebab, sauce au choix du gagnant.",
  a: ["Le retard est constaté au-delà de dix minutes.", "Un message vocal ne vaut pas arrivée."],
  d: NOW_MS + 3 * DAY,
  t: NOW_MS - 2 * HOUR,
};

function deedWith(changes: Partial<DeedJson>): DeedJson {
  return { ...BASE, ...changes };
}

function canonical(deed: DeedJson): string {
  return JSON.stringify({
    p: deed.p,
    c: deed.c,
    o: deed.o,
    e: deed.e,
    a: deed.a,
    d: deed.d,
    t: deed.t,
  });
}

function hashOf(deed: DeedJson | string, suffix = ""): string {
  const json = typeof deed === "string" ? deed : canonical(deed);
  return `#1.${LZString.compressToEncodedURIComponent(json)}${suffix}`;
}

// --- Oracle indépendant du numéro (spec, ligne 49) --------------------------------------------

const CROCKFORD = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
  .filter((char) => !"ILOU".includes(char))
  .join("");

function crockford128(fingerprintHex: string): string {
  const bits = [...fingerprintHex.slice(0, 32)]
    .map((digit) => parseInt(digit, 16).toString(2).padStart(4, "0"))
    .join("")
    .padEnd(130, "0");
  return (bits.match(/.{5}/gu) ?? []).map((chunk) => CROCKFORD[parseInt(chunk, 2)]).join("");
}

/** « N° 2026-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX », espace simple après « N° » (comparaison souple). */
function specNumber(deed: DeedJson): string {
  const hex = createHash("sha256").update(canonical(deed), "utf8").digest("hex");
  const groups = crockford128(hex).match(/.{1,4}/gu) ?? [];
  return `N° ${new Date(deed.t).getUTCFullYear()}-${groups.join("-")}`;
}

function squeezeSpaces(text: string): string {
  return text.replace(/[\s\u00a0\u202f]+/gu, " ").trim();
}

// --- Écrans et sélecteurs ---------------------------------------------------------------------

function deedArticle(page: Page): Locator {
  return page.getByRole("article", { name: "Acte de pari" });
}
/** Le numéro seul (sans « · enregistré le … ») : forme scellée ou NON-SCELLÉ. */
function deedNumber(page: Page): Locator {
  return deedArticle(page).getByText(/^N°\s(?:\d{4}(?:-[0-9A-Z]{4}){6}-[0-9A-Z]{2}|NON-SCELLÉ)$/u);
}
function deadlineClause(page: Page): Locator {
  return deedArticle(page).getByRole("region", { name: "Échéance du pari", exact: true });
}
function draftForm(page: Page): Locator {
  return page.getByRole("form", { name: "Rédiger un acte de pari" });
}
function field(page: Page, label: string): Locator {
  return draftForm(page).getByLabel(label, { exact: true });
}
function sealButton(page: Page): Locator {
  return page.getByRole("button", { name: "Sceller l'acte", exact: true });
}
function copyButton(page: Page): Locator {
  return page.getByRole("button", { name: "Copier le lien de l'acte", exact: true });
}
function declareButton(page: Page): Locator {
  return page.getByRole("button", { name: "Déclarer le vainqueur", exact: true });
}

const FOOTER = "Acte sans aucune valeur juridique. Juré, craché.";

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror : ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console : ${message.text()}`);
  });
  page.on("dialog", (dialog) => {
    errors.push(`boîte native : ${dialog.type()} ${dialog.message()}`);
    void dialog.dismiss();
  });
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? [], "erreurs JS, console ou boîte native").toEqual([]);
});

async function openAt(page: Page, hash: string, at = NOW_MS) {
  await page.clock.setFixedTime(at);
  await page.goto(`jure-crache/${hash}`);
  await page.evaluate(() => document.fonts.ready);
}

async function openDeed(page: Page, deed: DeedJson, suffix = "", at = NOW_MS) {
  await openAt(page, hashOf(deed, suffix), at);
  await expect(deedNumber(page)).toBeVisible();
}

async function printedPages(page: Page): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  return pdfPageTexts(
    await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true }),
  );
}

async function expectAxeClean(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id} : ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);
}

/** Le numéro tel qu'un humain le sélectionne et le copie (sélection de tout l'élément). */
async function selectedText(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const selection = window.getSelection();
    if (selection === null) return "";
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.addRange(range);
    const text = selection.toString();
    selection.removeAllRanges();
    return text;
  });
}

/**
 * Problèmes de lisibilité du numéro, caractère par caractère (fonction sérialisée) : un groupe
 * (« 2026 », « K7QM »…) réparti sur deux lignes, un tiret rejeté en début de ligne, un
 * caractère hors de la fenêtre, hors de l'acte ou invisible, du défilement horizontal.
 */
function numberProblems(element: Element): string[] {
  const problems: string[] = [];
  const article = element.closest("article");
  const articleBox = article?.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const fontSize = parseFloat(getComputedStyle(element).fontSize);
  type Glyph = { char: string; middle: number; left: number; right: number; width: number };
  const glyphs: Glyph[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    for (let index = 0; index < text.length; index += 1) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = range.getBoundingClientRect();
      glyphs.push({
        char: text.charAt(index),
        middle: rect.top + rect.height / 2,
        left: rect.left,
        right: rect.right,
        width: rect.width,
      });
    }
  }
  for (const glyph of glyphs) {
    if (/\s/u.test(glyph.char)) continue;
    if (glyph.width <= 0) problems.push(`« ${glyph.char} » sans largeur (invisible)`);
    if (glyph.left < -0.5 || glyph.right > viewportWidth + 0.5) {
      problems.push(`« ${glyph.char} » hors de la fenêtre (${glyph.left}…${glyph.right})`);
    }
    if (
      articleBox &&
      (glyph.left < articleBox.left - 0.5 || glyph.right > articleBox.right + 0.5)
    ) {
      problems.push(`« ${glyph.char} » hors de l'acte`);
    }
  }
  // Groupes : suites de caractères sans tiret ni espace ; chacun sur une seule ligne.
  let group: Glyph[] = [];
  const closeGroup = () => {
    if (group.length > 1) {
      const middles = group.map((glyph) => glyph.middle);
      if (Math.max(...middles) - Math.min(...middles) > fontSize / 2) {
        problems.push(`groupe « ${group.map((glyph) => glyph.char).join("")} » coupé`);
      }
    }
    group = [];
  };
  glyphs.forEach((glyph, index) => {
    if (glyph.char === "-") {
      const before = glyphs[index - 1];
      if (before !== undefined && Math.abs(before.middle - glyph.middle) > fontSize / 2) {
        problems.push(`tiret n° ${index} rejeté en début de ligne`);
      }
      closeGroup();
    } else if (/[\s\u00a0]/u.test(glyph.char)) {
      closeGroup();
    } else {
      group.push(glyph);
    }
  });
  closeGroup();
  if (document.documentElement.scrollWidth > viewportWidth) {
    problems.push(
      `défilement horizontal (${document.documentElement.scrollWidth} > ${viewportWidth})`,
    );
  }
  return problems;
}

/** Noms de 40 caractères sans espace (CL-7) : le titre et ses voisins sont au plus serré. */
const LONG_NAMES = deedWith({ p: "W".repeat(40), c: "M".repeat(40) });
const FDFD = String.fromCodePoint(0xfdfd);
/** Lien forgé le plus « large » que le schéma accepte. */
const FORGED_WIDE: DeedJson = {
  p: FDFD.repeat(40),
  c: `x${FDFD.repeat(39)}`,
  o: FDFD.repeat(200),
  e: FDFD.repeat(120),
  a: [0, 1, 2, 3, 4].map(() => FDFD.repeat(160)),
  d: BASE.d,
  t: BASE.t,
};
const CJK = "契約書証人印鑑署名期限賭事裁判友達遅刻言訳鉄道";
const cjk = (length: number, seed: number) =>
  Array.from({ length }, (_, index) => CJK[(index * 5 + seed) % CJK.length] ?? "契").join("");
const LONGEST_CJK: DeedJson = {
  p: cjk(40, 1),
  c: cjk(40, 2),
  o: cjk(200, 3),
  e: cjk(120, 4),
  a: [5, 6, 7, 8, 9].map((seed) => cjk(160, seed)),
  d: BASE.t + 3652 * DAY,
  t: BASE.t,
};

// ==============================================================================================
// CA-3 · numéro sur 128 bits, base32 Crockford, groupé par 4
// ==============================================================================================

test.describe("Tour 3 · CA-3 · numéro N° AAAA- + 26 caractères base32 Crockford", () => {
  for (const [label, deed, suffix] of [
    ["acte ordinaire", BASE, ""],
    ["acte jugé (parieur)", BASE, ".p"],
    ["idéogrammes aux bornes", LONGEST_CJK, ""],
    ["lien forgé en U+FDFD", FORGED_WIDE, ".n"],
  ] as const) {
    test(`CA-3 · ${label} : numéro égal à l'oracle indépendant, 6 groupes de 4 puis 2, sans I L O U`, async ({
      page,
    }) => {
      await openDeed(page, deed, suffix);
      const shown = squeezeSpaces((await deedNumber(page).textContent()) ?? "");
      expect(shown).toBe(specNumber(deed));
      const code = shown.replace(/^N° \d{4}-/u, "").replaceAll("-", "");
      expect(code).toHaveLength(26);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
      // 128 bits = 25 × 5 + 3 : le dernier caractère finit par 2 bits à zéro.
      expect(CROCKFORD.indexOf(code.charAt(25)) % 4).toBe(0);
    });
  }

  test("CA-3 · le numéro sélectionné et copié à la main est entier, sans caractère ajouté", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openDeed(page, BASE);
    const selected = await selectedText(deedNumber(page));
    expect(squeezeSpaces(selected)).toBe(specNumber(BASE));
    // Aucun retour à la ligne, aucun caractère invisible glissé entre les groupes.
    expect(selected).not.toMatch(/[\n\r\u00ad\u200b\u2060]/u);
  });

  test("CA-3 · un lecteur d'écran lit le numéro d'un seul tenant (texte accessible de l'acte)", async ({
    page,
  }) => {
    await openDeed(page, BASE);
    const articleText = squeezeSpaces((await deedArticle(page).innerText()).replace(/\n/gu, " "));
    expect(articleText).toContain(specNumber(BASE));
  });
});

// ==============================================================================================
// CA-11 · numéro lisible, jamais coupé au milieu d'un groupe, de 360 à 1280 px
// ==============================================================================================

test.describe("Tour 3 · CA-11 · numéro lisible de 360 à 1280 px", () => {
  const SIZES = [
    { width: 360, height: 780 },
    { width: 375, height: 667 },
    { width: 414, height: 896 },
    { width: 640, height: 900 },
    { width: 768, height: 1024 },
    { width: 960, height: 900 },
    { width: 1024, height: 768 },
    { width: 1093, height: 614 },
    { width: 1280, height: 800 },
  ];
  for (const size of SIZES) {
    for (const [label, deed] of [
      ["acte ordinaire", BASE],
      ["noms de 40 caractères sans espace", LONG_NAMES],
      ["lien forgé en U+FDFD", FORGED_WIDE],
    ] as const) {
      test(`CA-11 · ${size.width}×${size.height}, ${label} : chaque groupe du numéro sur une ligne, rien hors de l'acte`, async ({
        page,
      }, testInfo) => {
        test.skip(testInfo.project.name !== "desktop", FIXED_VIEWPORT);
        await page.setViewportSize(size);
        await openDeed(page, deed);
        expect(squeezeSpaces((await deedNumber(page).textContent()) ?? "")).toBe(specNumber(deed));
        expect(await deedNumber(page).evaluate(numberProblems)).toEqual([]);
      });
    }
  }

  test("CA-11 · projet mobile-360 : le numéro tient sans couper un groupe, acte jugé", async ({
    page,
  }) => {
    await openDeed(page, BASE, ".c");
    expect(await deedNumber(page).evaluate(numberProblems)).toEqual([]);
  });

  test("CA-11 · CL-6 à 360 px : « N° NON-SCELLÉ » reste entier et dans l'acte", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, "subtle", {
        configurable: true,
        get: () => undefined,
      });
    });
    await openAt(page, hashOf(BASE));
    await expect(deedNumber(page)).toHaveText(/^N°\sNON-SCELLÉ$/u);
    expect(await deedNumber(page).evaluate(numberProblems)).toEqual([]);
  });
});

// ==============================================================================================
// CA-6 · numéro entier sur papier
// ==============================================================================================

test.describe("Tour 3 · CA-6 · numéro entier dans le PDF", () => {
  for (const [label, deed, suffix] of [
    ["acte ordinaire", BASE, ""],
    ["acte jugé match nul", BASE, ".n"],
    ["idéogrammes aux bornes", LONGEST_CJK, ".p"],
    ["noms de 40 caractères sans espace", LONG_NAMES, ""],
    ["lien forgé en U+FDFD", FORGED_WIDE, ""],
  ] as const) {
    test(`CA-6 · ${label} : une page, le numéro y figure une fois, en entier`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
      await openDeed(page, deed, suffix);
      const pages = await printedPages(page);
      expect(pages).toHaveLength(1);
      expect(countIgnoringSpaces(pages[0] ?? "", specNumber(deed))).toBe(1);
    });
  }

  test("CA-6 · en média print, à la largeur A4, aucun groupe du numéro n'est coupé", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", FIXED_VIEWPORT);
    await openDeed(page, LONG_NAMES, ".p");
    await page.setViewportSize({ width: Math.floor(((210 - 20) / 25.4) * 96), height: 1100 });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    expect(await deedNumber(page).evaluate(numberProblems)).toEqual([]);
  });
});

// ==============================================================================================
// « 1er » pour le premier du mois
// ==============================================================================================

test.describe("Tour 3 · Dates · « 1er » pour le premier du mois, pas pour 11, 21, 31", () => {
  /** Rédigé le 1er octobre 2026 à 10 h (Paris), échéance le 1er novembre 2026 à 20 h (Paris). */
  const FIRSTS = deedWith({ t: Date.UTC(2026, 9, 1, 8), d: Date.UTC(2026, 10, 1, 19) });

  test("Dates · rédigé le 1er, échéance le 1er : « enregistré le 1er octobre 2026 », « Le 1er novembre 2026 à 20:00 »", async ({
    page,
  }) => {
    await openDeed(page, FIRSTS);
    await expect(deedArticle(page).getByText(/enregistré le/u)).toHaveText(
      /enregistré le\s1er\soctobre\s2026$/u,
    );
    await expect(deadlineClause(page)).toContainText(/Le\s1er\snovembre\s2026\sà\s20:00/u);
    expect(await deedArticle(page).innerText()).not.toMatch(/(?:^|\D)1\s(?:octobre|novembre)/u);
  });

  test("Dates · acte jugé : « Verdict déclaré. Échéance du pari : 1er novembre 2026. »", async ({
    page,
  }) => {
    await openDeed(page, FIRSTS, ".p");
    await expect(
      deedArticle(page).getByText(/^Verdict déclaré\.\sÉchéance du pari\s:\s1er novembre 2026\.$/u),
    ).toBeVisible();
  });

  test("Dates · rédigé le 11, échéance le 21 puis le 31 : jamais « 11er », « 21er », « 31er »", async ({
    page,
  }) => {
    const deed = deedWith({ t: Date.UTC(2026, 9, 11, 8), d: Date.UTC(2026, 9, 21, 18) });
    await openDeed(page, deed);
    await expect(deedArticle(page).getByText(/enregistré le/u)).toHaveText(
      /enregistré le\s11\soctobre\s2026$/u,
    );
    await expect(deadlineClause(page)).toContainText(/Le\s21\soctobre\s2026\sà\s20:00/u);

    const judged = deedWith({ t: Date.UTC(2026, 9, 11, 8), d: Date.UTC(2026, 9, 31, 19) });
    await openDeed(page, judged, ".n");
    await expect(
      deedArticle(page).getByText(/^Verdict déclaré\.\sÉchéance du pari\s:\s31 octobre 2026\.$/u),
    ).toBeVisible();
    expect(await page.locator("body").innerText()).not.toMatch(/\d1er/u);
  });

  test("Dates · 31 octobre à 23 h 30 UTC lu à Paris : « Le 1er novembre 2026 à 00:30 »", async ({
    page,
  }) => {
    await openDeed(page, deedWith({ d: Date.UTC(2026, 9, 31, 23, 30) }));
    await expect(deadlineClause(page)).toContainText(/Le\s1er\snovembre\s2026\sà\s00:30/u);
  });

  test.describe("à New York", () => {
    test.use({ timezoneId: "America/New_York" });
    test("Dates · même lien lu à New York : « Le 31 octobre 2026 à 19:30 », pas de « 1er »", async ({
      page,
    }) => {
      await openDeed(page, deedWith({ d: Date.UTC(2026, 9, 31, 23, 30) }));
      await expect(deadlineClause(page)).toContainText(/Le\s31\soctobre\s2026\sà\s19:30/u);
      await expect(deadlineClause(page)).not.toContainText("1er");
    });
  });

  test("Dates · sur papier aussi : « 1er octobre 2026 » et « 1er novembre 2026 » dans le PDF", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
    await openDeed(page, FIRSTS);
    const [text = ""] = await printedPages(page);
    expect(countIgnoringSpaces(text, "1er octobre 2026")).toBe(1);
    expect(countIgnoringSpaces(text, "1er novembre 2026")).toBe(1);
  });
});

// ==============================================================================================
// CA-6 · pied en marge sur les seules pages de l'acte
// ==============================================================================================

test.describe("Tour 3 · CA-6 · pied en marge : pages de l'acte seulement", () => {
  function footerCounts(pages: readonly string[]): number[] {
    return pages.map((text) => countIgnoringSpaces(text, FOOTER));
  }

  test("CA-6 · Rédaction avec des erreurs affichées : aucune page ne porte le pied d'acte", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
    await openAt(page, "");
    await sealButton(page).click();
    await expect(field(page, "Le parieur")).toBeFocused();
    const pages = await printedPages(page);
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(footerCounts(pages)).toEqual(pages.map(() => 0));
  });

  test("CA-6 · Rédaction atteinte depuis un acte (« Nouvel acte ») : aucun pied d'acte imprimé", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
    await openDeed(page, BASE);
    await page.getByRole("button", { name: "Nouvel acte", exact: true }).click();
    await expect(draftForm(page)).toBeVisible();
    const pages = await printedPages(page);
    expect(footerCounts(pages)).toEqual(pages.map(() => 0));
  });

  for (const [label, hash, heading] of [
    ["noms identiques arrivés par l'URL (CL-4)", hashOf(deedWith({ c: "théo" })), "Acte illisible"],
    ["lien de plus de 4 Ko", `#1.${"A".repeat(4200)}`, "Acte illisible"],
    ["clé inconnue", hashOf(`${canonical(BASE).slice(0, -1)},"x":1}`), "Acte illisible"],
  ] as const) {
    test(`CA-6 · refus (${label}) : aucun pied d'acte imprimé`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
      await openAt(page, hash);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      const pages = await printedPages(page);
      expect(footerCounts(pages)).toEqual(pages.map(() => 0));
    });
  }

  test("CA-6 · acte → lien abîmé (hashchange) : le refus imprimé n'a plus de pied ; retour à l'acte : il revient", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
    await openDeed(page, BASE);
    await page.evaluate(() => {
      location.hash = "#1.%%%";
    });
    await expect(page.getByRole("heading", { name: "Acte illisible" })).toBeVisible();
    let pages = await printedPages(page);
    expect(footerCounts(pages)).toEqual(pages.map(() => 0));

    await page.evaluate(
      (hash) => {
        location.hash = hash;
      },
      hashOf(BASE, ".p"),
    );
    await expect(deedNumber(page)).toBeVisible();
    pages = await printedPages(page);
    expect(footerCounts(pages)).toEqual([2]);
  });

  for (const [label, prepare] of [
    ["non scellé (CL-6)", true],
    ["jugé (parieur)", false],
  ] as const) {
    test(`CA-6 · acte ${label} : une page, pied dans l'acte et dans la marge`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
      if (prepare) {
        await page.addInitScript(() => {
          Object.defineProperty(Crypto.prototype, "subtle", {
            configurable: true,
            get: () => undefined,
          });
        });
      }
      await openDeed(page, BASE, prepare ? "" : ".p");
      expect(footerCounts(await printedPages(page))).toEqual([2]);
    });
  }
});

// ==============================================================================================
// CL-9 · acte dans les bornes dont le lien dépasserait 4 Ko
// ==============================================================================================

/** Idéogrammes tous différents, qui se compressent mal. */
function ideographs(start: number) {
  let next = start;
  return {
    bmp: (length: number) =>
      Array.from({ length }, () => String.fromCodePoint(0x4e00 + ((next++ * 7919) % 20_000))).join(
        "",
      ),
    astral: (length: number) =>
      Array.from({ length }, () => String.fromCodePoint(0x20000 + ((next++ * 7919) % 40_000))).join(
        "",
      ),
  };
}

type Typed = { p: string; c: string; o: string; e: string; a: string[] };

/** Échéance tapée : 15 octobre 2026 à 10:00 (Paris), soit NOW + 1 jour. */
const TYPED_DEADLINE = "2026-10-15T10:00";
const TYPED_DEADLINE_MS = NOW_MS + DAY;

function typedJson(typed: Typed): string {
  return canonical({ ...typed, d: TYPED_DEADLINE_MS, t: NOW_MS });
}
function rawJudgedLength(typed: Typed): number {
  return `1.${LZString.compressToEncodedURIComponent(typedJson(typed))}.p`.length;
}
function compressedSize(text: string): number {
  return LZString.compressToEncodedURIComponent(text).length;
}

/** Libellé du champ du texte le plus lourd une fois compressé (oracle lz-string). */
function heaviestLabel(typed: Typed): string {
  const entries: [string, string][] = [
    ["Le parieur", typed.p],
    ["Le contre-parieur", typed.c],
    ["Objet du pari", typed.o],
    ["Enjeu", typed.e],
    ...typed.a.map((text, index): [string, string] => [`Article ${index + 1}`, text]),
  ];
  const sizes = entries.map(([label, text]) => ({ label, size: compressedSize(text) }));
  const sorted = [...sizes].sort((a, b) => b.size - a.size);
  const [first, second] = sorted;
  if (first === undefined || second === undefined || first.size < second.size * 1.1) {
    throw new Error(`texte le plus lourd ambigu : ${JSON.stringify(sorted.slice(0, 2))}`);
  }
  return first.label;
}

async function typeDraft(page: Page, typed: Typed) {
  await field(page, "Le parieur").fill(typed.p);
  await field(page, "Le contre-parieur").fill(typed.c);
  await field(page, "Objet du pari").fill(typed.o);
  await field(page, "Enjeu").fill(typed.e);
  await field(page, "Échéance du pari").fill(TYPED_DEADLINE);
  const add = page.getByRole("button", { name: "Ajouter un article" });
  for (let count = 3; count < typed.a.length; count += 1) await add.click();
  for (const [index, text] of typed.a.entries()) {
    await field(page, `Article ${index + 1}`).fill(text);
  }
}

/** Brouillon dont le hash brut jugé (« 1.<payload>.p ») mesure exactement `target`. */
function typedWithRawJudgedLength(target: number): Typed {
  // On part de 150 : la solution est vers 153 (recherche courte, déterministe).
  for (let last = 150; last <= 160; last += 1) {
    const gen = ideographs(1);
    const head = { p: gen.bmp(40), c: gen.bmp(40), o: gen.bmp(200) };
    const a = [gen.bmp(160), gen.bmp(160), gen.bmp(160), gen.bmp(last)];
    for (let tail = 1; tail <= 120; tail += 1) {
      const typed = { ...head, e: "k".repeat(tail), a };
      if (rawJudgedLength(typed) === target) return typed;
    }
  }
  throw new Error(`aucun brouillon à ${target} caractères bruts`);
}

async function describedErrors(control: Locator): Promise<string> {
  return control.evaluate((element) =>
    (element.getAttribute("aria-describedby") ?? "")
      .split(/\s+/u)
      .filter(Boolean)
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => node.innerText.trim())
      .filter((text) => text !== "")
      .join(" | "),
  );
}

test.describe("Tour 3 · CL-9 · lien de plus de 4 Ko refusé au formulaire", () => {
  test("CL-9 · l'erreur va sur l'enjeu, le plus lourd une fois compressé, pas sur l'objet (le plus long)", async ({
    page,
  }) => {
    const gen = ideographs(1);
    const typed: Typed = {
      p: gen.bmp(40),
      c: gen.bmp(40),
      // 200 caractères (le plus long), mais répétitif : il se compresse en quelques octets.
      o: "Kevin sera en retard. ".repeat(10).slice(0, 200),
      e: gen.astral(120),
      a: [gen.bmp(160), gen.bmp(160), gen.bmp(160), gen.bmp(160), gen.bmp(160)],
    };
    expect(rawJudgedLength(typed)).toBeGreaterThan(4096);
    expect(heaviestLabel(typed)).toBe("Enjeu");

    await openAt(page, "");
    await typeDraft(page, typed);
    await sealButton(page).click();
    const stake = field(page, "Enjeu");
    await expect(stake).toBeFocused();
    await expect(stake).toHaveAttribute("aria-invalid", "true");
    expect(await describedErrors(stake)).toMatch(/lien/u);
    await expect(field(page, "Objet du pari")).not.toHaveAttribute("aria-invalid", "true");
    expect(new URL(page.url()).hash).toBe("");
  });

  test("CL-9 · lien jugé de 4 096 caractères bruts : scellé, jugé, rechargé, toujours lisible et même numéro", async ({
    page,
  }) => {
    const typed = typedWithRawJudgedLength(4096);
    await openAt(page, "");
    await typeDraft(page, typed);
    await sealButton(page).click();
    await expect(deedNumber(page)).toBeVisible();
    const deed: DeedJson = { ...typed, d: TYPED_DEADLINE_MS, t: NOW_MS };
    expect(new URL(page.url()).hash).toBe(hashOf(deed));
    await expect(deedNumber(page)).toHaveText(
      new RegExp(`^${specNumber(deed).replace(" ", "\\s")}$`, "u"),
    );

    await declareButton(page).click();
    await page
      .getByRole("dialog", { name: "Déclarer le vainqueur" })
      .getByRole("button")
      .first()
      .click();
    await expect.poll(() => new URL(page.url()).hash.length).toBe(4097);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Acte illisible" })).toHaveCount(0);
    await expect(deedNumber(page)).toHaveText(
      new RegExp(`^${specNumber(deed).replace(" ", "\\s")}$`, "u"),
    );
  });

  test("CL-9 · lien sans verdict de 4 097 caractères bruts : refusé au formulaire, erreur sur le plus lourd, focus", async ({
    page,
  }) => {
    const typed = typedWithRawJudgedLength(4099);
    const label = heaviestLabel(typed);
    await openAt(page, "");
    await typeDraft(page, typed);
    await sealButton(page).click();
    const heavy = field(page, label);
    await expect(heavy).toBeFocused();
    await expect(heavy).toHaveAttribute("aria-invalid", "true");
    expect(new URL(page.url()).hash).toBe("");
  });
});

// ==============================================================================================
// CA-7 · focus piégé dans le repli de copie (copieur partagé)
// ==============================================================================================

async function refuseClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new DOMException("refus", "NotAllowedError")),
    });
  });
}

/** Le focus est dans le dialogue, et la page a toujours le focus (pas parti vers le navigateur). */
async function focusInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate(
    (element) => document.hasFocus() && element.contains(document.activeElement),
  );
}

test.describe("Tour 3 · CA-7 · repli de copie : focus piégé", () => {
  test("CA-7 · Maj+Tab depuis le champ (premier élément) boucle sur « Fermer », puis reste dedans", async ({
    page,
  }) => {
    await refuseClipboard(page);
    await openDeed(page, BASE);
    await copyButton(page).click();
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("textbox", { name: "Lien à copier" });
    await expect(input).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Fermer" })).toBeFocused();
    for (let press = 0; press < 5; press += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusInside(dialog), `Maj+Tab n° ${press + 2}`).toBe(true);
    }
  });

  test("CA-7 · après un clic sur le texte du dialogue, Tab et Maj+Tab ne sortent pas", async ({
    page,
  }) => {
    await refuseClipboard(page);
    await openDeed(page, BASE);
    await copyButton(page).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading").click();
    for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
      await page.keyboard.press(key);
      expect(await focusInside(dialog), key).toBe(true);
    }
  });

  test("CA-7 · une fois le repli fermé, Tab quitte le bouton de copie vers la suite de la page (piège levé)", async ({
    page,
  }) => {
    await refuseClipboard(page);
    await openDeed(page, BASE);
    await copyButton(page).click();
    await page.keyboard.press("Escape");
    await expect(copyButton(page)).toBeFocused();
    await page.keyboard.press("Tab");
    const moved = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        inDialog: (active?.closest("dialog") ?? null) !== null,
        isBody: active === document.body,
        name: active?.textContent?.trim() ?? "",
      };
    });
    expect(moved.inDialog).toBe(false);
    expect(moved.isBody).toBe(false);
    expect(moved.name).not.toBe("Copier le lien de l'acte");
  });

  for (const width of [360, 1280]) {
    test(`axe · repli de copie ouvert à ${width} px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", FIXED_VIEWPORT);
      await page.setViewportSize({ width, height: 780 });
      await refuseClipboard(page);
      await openDeed(page, BASE);
      await copyButton(page).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectAxeClean(page);
    });
  }
});
