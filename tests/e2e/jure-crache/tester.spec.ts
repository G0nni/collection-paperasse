// Tests de Juré Craché écrits par l'agent tester à partir de specs/jure-crache.md et des règles
// de CLAUDE.md, avant lecture de l'implémentation (sélecteurs branchés ensuite, par rôle et nom
// accessible). Les garde-fous communs (axe sur l'écran par défaut, requêtes tierces, CSP, tour
// des étiquettes) sont dans tests/e2e/collection.spec.ts et tests/e2e/csp.spec.ts.
//
// Le temps est toujours contrôlé par page.clock :
// - `openDeed` : Date figée (setFixedTime) ; les minuteurs tournent mais l'heure ne bouge pas.
// - `openTicking` : horloge installée puis mise en pause à NOW_MS ; on avance avec runFor.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";
import type * as LZStringModule from "../../../apps/jure-crache/node_modules/lz-string";
import { contrastFailures, snapshotTextNodes } from "../support/contrast";
import { expectedDeedNumber } from "../support/crockford";
import { countIgnoringSpaces, pdfPageTexts } from "../support/pdf";
import { normalizeSpaces, perceivedTexts, typographyIssues } from "../support/text";

// lz-string du look lui-même (même version que le site), chargé sans passer par son code :
// l'oracle des tests ne dépend pas de link.ts.
const requireFromLook = createRequire(
  new URL("../../../apps/jure-crache/package.json", import.meta.url),
);
const LZString: typeof LZStringModule = requireFromLook("lz-string");

/** Mercredi 14 octobre 2026, 10:00 à Paris (UTC+2). */
const NOW_MS = Date.UTC(2026, 9, 14, 8, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** « javascript: », écrit en deux morceaux pour ESLint (no-script-url) : c'est une charge hostile. */
const SCRIPT_SCHEME = ["java", "script:"].join("");
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const NUL = String.fromCodePoint(0);

type DeedJson = {
  p: string;
  c: string;
  o: string;
  e: string;
  a: string[];
  d: number;
  t: number;
};

const BASE: DeedJson = {
  p: "Théo",
  c: "Inès",
  o: "Kevin arrivera en retard à la soirée de samedi.",
  e: "Un (1) kebab, sauce au choix du gagnant.",
  a: ["Le retard est constaté au-delà de dix minutes.", "Un message vocal ne vaut pas arrivée."],
  d: NOW_MS + 3 * DAY + 4 * HOUR + 5 * MINUTE + 6 * SECOND,
  t: NOW_MS - 2 * HOUR,
};

function deedWith(changes: Partial<DeedJson>): DeedJson {
  return { ...BASE, ...changes };
}

/** JSON canonique de la spec : clés dans l'ordre p, c, o, e, a, d, t, sans espace. */
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

function payloadOf(json: string): string {
  return LZString.compressToEncodedURIComponent(json);
}

/** `#1.<payload>[suffixe]` pour un acte (JSON canonique) ou un JSON brut quelconque. */
function hashOf(deed: DeedJson | string, suffix = ""): string {
  const json = typeof deed === "string" ? deed : canonical(deed);
  return `#1.${payloadOf(json)}${suffix}`;
}

/**
 * Numéro attendu d'après la spec. Mis à jour au tour 3 par le builder : la spec
 * (specs/jure-crache.md, ligne 49) passe à « N° AAAA- » suivi des 128 premiers bits de
 * l'empreinte en base32 Crockford (26 caractères), groupés par 4 (oracle tests/e2e/support).
 */
function expectedNumber(deed: DeedJson): string {
  const hex = createHash("sha256").update(canonical(deed), "utf8").digest("hex");
  return expectedDeedNumber(hex, deed.t).replace(String.fromCodePoint(0xa0), " ");
}

/**
 * Ligne de l'acte jugé (spec, ligne 14) : « Verdict déclaré. Échéance du pari : <date> ».
 * Remplace « Jugé … » au tour 2 (builder).
 */
const JUDGED_LINE = /^Verdict déclaré\.\sÉchéance du pari\s:\s/u;

/** Texte de la spec → regex tolérant aux insécables et à l'apostrophe typographique. */
function specText(text: string): RegExp {
  const escaped = text
    .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/'/gu, "['’]")
    .replace(/ /gu, "\\s+");
  return new RegExp(escaped, "u");
}

function exactText(text: string): RegExp {
  return new RegExp(`^\\s*${specText(text).source}\\s*$`, "u");
}

// --- Pièges : aucune erreur JS ni console sur aucun écran ---------------------------------------

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror : ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console : ${message.text()}`);
  });
  page.on("dialog", (dialog) => {
    errors.push(`boîte native ouverte : ${dialog.type()} ${dialog.message()}`);
    void dialog.dismiss();
  });
});

test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? [], "erreurs JS, console ou boîte native").toEqual([]);
});

// --- Écrans et sélecteurs ---------------------------------------------------------------------

function deedArticle(page: Page): Locator {
  return page.getByRole("article", { name: "Acte de pari" });
}
function deedNumber(page: Page): Locator {
  // Tour 3 (builder) : 128 bits en base32 Crockford, 6 groupes de 4 puis 1 de 2 (spec ligne 49).
  return deedArticle(page).getByText(
    /^N°\s(?:\d{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){6}-[0-9A-HJKMNP-TV-Z]{2}|NON-SCELLÉ)$/u,
  );
}
function party(page: Page, role: "Le parieur" | "Le contre-parieur"): Locator {
  return deedArticle(page).getByRole("region", { name: role, exact: true });
}
function clause(page: Page, name: "Objet du pari" | "Enjeu" | "Articles" | "Échéance du pari") {
  return deedArticle(page).getByRole("region", { name, exact: true });
}
function sealButton(page: Page): Locator {
  return page.getByRole("button", { name: "Sceller l'acte", exact: true });
}
function copyButton(page: Page): Locator {
  return page.getByRole("button", { name: "Copier le lien de l'acte", exact: true });
}
function printButton(page: Page): Locator {
  return page.getByRole("button", { name: "Imprimer", exact: true });
}
function declareButton(page: Page): Locator {
  return page.getByRole("button", { name: "Déclarer le vainqueur", exact: true });
}
function verdictDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Déclarer le vainqueur" });
}
function draftHeading(page: Page): Locator {
  return page.getByRole("heading", { name: "Rédiger un acte de pari" });
}
function unreadableHeading(page: Page): Locator {
  return page.getByRole("heading", { name: "Acte illisible" });
}
/** Champ du formulaire de Rédaction (l'acte a des sections aux mêmes noms). */
function field(page: Page, label: string): Locator {
  return page
    .getByRole("form", { name: "Rédiger un acte de pari" })
    .getByLabel(label, { exact: true });
}

const FOOTER = "Acte sans aucune valeur juridique. Juré, craché.";
const PASSED = "Échéance passée. Le tribunal des potes attend votre verdict.";
const VERDICT_NOTE =
  "Verdict déclaré par la personne qui a envoyé ce lien. En cas de litige, le tribunal des potes statue en dernier ressort.";

async function openAt(page: Page, hash: string, at = NOW_MS) {
  await page.clock.setFixedTime(at);
  await page.goto(`jure-crache/${hash}`);
  await page.evaluate(() => document.fonts.ready);
}

/** Ouvre un acte et attend que son numéro soit calculé (empreinte asynchrone). */
async function openDeed(page: Page, hash: string, at = NOW_MS) {
  await openAt(page, hash, at);
  await expect(deedNumber(page)).toBeVisible();
}

async function openTicking(page: Page, hash: string, at = NOW_MS) {
  await page.clock.install({ time: at - 10 * SECOND });
  await page.goto(`jure-crache/${hash}`);
  await page.clock.pauseAt(at);
  await expect(deedNumber(page)).toBeVisible();
}

async function setHash(page: Page, hash: string) {
  await page.evaluate((value) => {
    location.hash = value;
  }, hash);
}

function currentHash(page: Page): string {
  return new URL(page.url()).hash;
}

/** Le payload d'un hash « #1.<payload>[.v] », décompressé et vérifié. */
function decodeHash(hash: string): DeedJson {
  const [, payload = ""] = hash.slice(1).split(".");
  const value: unknown = JSON.parse(LZString.decompressFromEncodedURIComponent(payload));
  if (typeof value !== "object" || value === null) throw new Error("payload illisible");
  const read = (key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;
  const [p, c, o, e, a, d, t] = ["p", "c", "o", "e", "a", "d", "t"].map(read);
  if (
    typeof p !== "string" ||
    typeof c !== "string" ||
    typeof o !== "string" ||
    typeof e !== "string" ||
    !Array.isArray(a) ||
    typeof d !== "number" ||
    typeof t !== "number"
  ) {
    throw new Error(`payload inattendu : ${JSON.stringify(value)}`);
  }
  return { p, c, o, e, a: a.map(String), d, t };
}

/** Écart entre deux boîtes (0 si elles se touchent ou se recouvrent). */
function boxGap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const horizontal = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const vertical = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.hypot(horizontal, vertical);
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

async function expectFrenchTypography(page: Page) {
  const texts = await perceivedTexts(page, page.locator("body"));
  const issues = texts.flatMap(({ where, text }) =>
    typographyIssues(text).map((issue) => `${where} : ${issue}`),
  );
  expect(issues).toEqual([]);
}

/** Remplit le formulaire de Rédaction. `deadline` : valeur d'un champ datetime-local. */
async function fillDraft(
  page: Page,
  values: { p?: string; c?: string; o?: string; e?: string; deadline?: string },
) {
  if (values.p !== undefined) await field(page, "Le parieur").fill(values.p);
  if (values.c !== undefined) await field(page, "Le contre-parieur").fill(values.c);
  if (values.o !== undefined) await field(page, "Objet du pari").fill(values.o);
  if (values.e !== undefined) await field(page, "Enjeu").fill(values.e);
  if (values.deadline !== undefined) {
    await field(page, "Échéance du pari").fill(values.deadline);
  }
}

/** Le message d'erreur relié au champ par aria-describedby (CA-1). */
async function describedErrors(control: Locator): Promise<string> {
  return control.evaluate((element) => {
    const ids = (element.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean);
    return ids
      .map((id) => document.getElementById(id))
      .filter((node): node is HTMLElement => node instanceof HTMLElement)
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => node.innerText.trim())
      .filter((text) => text !== "")
      .join(" | ");
  });
}

// --- Textes les plus longs (CA-6, CA-11, CL-7) -----------------------------------------------

/** Prose française coupée à `length` points de code exactement, avec de longs mots. */
function prose(length: number, seed: number): string {
  const words = [
    "anticonstitutionnellement",
    "intergouvernementalisations",
    "retard",
    "soirée",
    "samedi",
    "tribunal",
    "potes",
    "kebab",
    "SNCF",
    "excuse",
    "irrévocablement",
    "contre-parieur",
  ];
  let text = "";
  let index = seed;
  while (Array.from(text).length < length) {
    text += `${words[index % words.length] ?? "pari"} `;
    index += 7;
  }
  return Array.from(text).slice(0, length).join("").trimEnd().padEnd(length, "W");
}

/** L'acte le plus long en prose : toutes les bornes atteintes. */
const LONGEST_PROSE: DeedJson = {
  p: "W".repeat(40),
  c: "M".repeat(40),
  o: prose(200, 1),
  e: prose(120, 2),
  a: [3, 4, 5, 6, 7].map((seed) => prose(160, seed)),
  d: BASE.t + 3652 * DAY,
  t: BASE.t,
};

/** Idem sans aucune espace : chaque texte est un seul « mot ». */
const LONGEST_SOLID: DeedJson = {
  p: "W".repeat(40),
  c: "M".repeat(40),
  o: "W".repeat(200),
  e: "M".repeat(120),
  a: [0, 1, 2, 3, 4].map(() => "W".repeat(160)),
  d: BASE.t + 3652 * DAY,
  t: BASE.t,
};

/** Idem en idéogrammes (pleine chasse, 3 octets UTF-8 : sous les 4 Ko). */
const CJK = "契約書証人印鑑署名期限賭事裁判友達遅刻言訳鉄道";
function cjk(length: number, seed: number): string {
  return Array.from({ length }, (_, index) => CJK[(index * 5 + seed) % CJK.length] ?? "契").join(
    "",
  );
}
const LONGEST_CJK: DeedJson = {
  p: cjk(40, 1),
  c: cjk(40, 2),
  o: cjk(200, 3),
  e: cjk(120, 4),
  a: [5, 6, 7, 8, 9].map((seed) => cjk(160, seed)),
  d: BASE.t + 3652 * DAY,
  t: BASE.t,
};

/**
 * Problèmes de mise en page d'un acte, lus dans la page (fonction autonome, sérialisée) :
 * - texte qui sort de la largeur de la fenêtre ;
 * - texte coupé par un ancêtre qui rogne (overflow: clip / hidden) ;
 * - deux textes qui se recouvrent ;
 * - sceau ou signature posé sur un texte ;
 * - texte circulaire du sceau qui dépasse son cercle (il serait tronqué).
 */
function layoutProblems(root: Element): string[] {
  const problems: string[] = [];
  const viewportWidth = document.documentElement.clientWidth;
  type Box = { left: number; top: number; right: number; bottom: number };
  const overlap = (a: Box, b: Box) => ({
    width: Math.min(a.right, b.right) - Math.max(a.left, b.left),
    height: Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
  });
  const visible = (element: Element) => {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
  const texts: { label: string; owner: Element; rects: DOMRect[] }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const owner = node.parentElement;
    if (owner === null || (node.textContent ?? "").trim() === "") continue;
    if (owner.closest("svg") !== null || !visible(owner)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
    texts.push({ label: (node.textContent ?? "").trim().slice(0, 30), owner, rects });
  }
  for (const text of texts) {
    for (const rect of text.rects) {
      if (rect.left < -0.5 || rect.right > viewportWidth + 0.5) {
        problems.push(`« ${text.label} » sort de la fenêtre (${rect.left}…${rect.right})`);
      }
      for (
        let node: Element | null = text.owner;
        node !== null && node !== root.parentElement;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        const clips = [style.overflowX, style.overflowY].some((value) =>
          ["clip", "hidden", "scroll", "auto"].includes(value),
        );
        if (clips) {
          const box = node.getBoundingClientRect();
          const margin = (parseFloat(style.overflowClipMargin) || 0) + 0.5;
          const fontSlack = parseFloat(getComputedStyle(text.owner).fontSize) * 0.2;
          if (
            rect.left < box.left - margin ||
            rect.right > box.right + margin ||
            rect.top < box.top - margin - fontSlack ||
            rect.bottom > box.bottom + margin + fontSlack
          ) {
            problems.push(`« ${text.label} » est rogné par <${node.tagName.toLowerCase()}>`);
            break;
          }
        }
      }
    }
  }
  for (let first = 0; first < texts.length; first += 1) {
    for (let second = first + 1; second < texts.length; second += 1) {
      const a = texts[first];
      const b = texts[second];
      if (a === undefined || b === undefined) continue;
      for (const ra of a.rects) {
        for (const rb of b.rects) {
          const { width, height } = overlap(ra, rb);
          if (width > 2 && height > 0.25 * Math.min(ra.height, rb.height)) {
            problems.push(`« ${a.label} » recouvre « ${b.label} »`);
          }
        }
      }
    }
  }
  const covers = [...root.querySelectorAll('svg[role="img"], figure svg')].filter(visible);
  for (const cover of covers) {
    const box = cover.getBoundingClientRect();
    for (const text of texts) {
      for (const rect of text.rects) {
        const { width, height } = overlap(box, rect);
        if (width > 1 && height > 1) {
          problems.push(
            `${cover.getAttribute("aria-label") ?? "signature"} recouvre « ${text.label} »`,
          );
        }
      }
    }
  }
  for (const ring of root.querySelectorAll("textPath")) {
    const href = ring.getAttribute("href") ?? "";
    const path = href.startsWith("#") ? document.getElementById(href.slice(1)) : null;
    const text = ring.closest("text");
    if (path instanceof SVGPathElement && text instanceof SVGTextElement) {
      // Longueur rendue : `textLength` si l'attribut impose une longueur (le navigateur
      // resserre alors l'espacement), sinon la longueur naturelle (`getComputedTextLength`,
      // que la propriété reflète par défaut). La longueur naturelle seule dépend de la police
      // et de la version du navigateur, et ignore `textLength`.
      const length = text.textLength.baseVal.value;
      if (length > path.getTotalLength() + 0.5) {
        problems.push(
          `texte circulaire du sceau tronqué (${length.toFixed(1)} > ${path.getTotalLength().toFixed(1)})`,
        );
      }
    }
  }
  return problems;
}

/** Souches du compte à rebours, lues case par case : « 03 jours 04 heures 05 min 06 sec ». */
async function stubsText(page: Page): Promise<string> {
  const parts = await page.getByRole("timer").locator("span").allTextContents();
  return normalizeSpaces(parts.join(" "));
}

/** Boîte d'un élément dans la page (pas dans la fenêtre : le défilement ne compte pas). */
async function pageBox(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

// ==============================================================================================
// CA-1 · Rédaction, validation, scellé
// ==============================================================================================

test.describe("CA-1 · Sceller l'acte", () => {
  test("CA-1 · formulaire vide : chaque champ obligatoire en erreur, relié par aria-describedby, focus sur le parieur, aucun hash", async ({
    page,
  }) => {
    await openAt(page, "");
    await expect(draftHeading(page)).toBeVisible();
    await sealButton(page).click();

    for (const label of ["Le parieur", "Le contre-parieur", "Objet du pari", "Enjeu"]) {
      const control = field(page, label);
      await expect(control, label).toHaveAttribute("aria-invalid", "true");
      expect(await describedErrors(control), `erreur de « ${label} »`).not.toBe("");
    }
    await expect(field(page, "Le parieur")).toBeFocused();
    expect(currentHash(page)).toBe("");
  });

  test("CA-1 · seul l'enjeu manque : le focus va sur l'enjeu, les autres champs ne sont pas en erreur", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillDraft(page, { p: "Théo", c: "Inès", o: "Kevin sera en retard." });
    await sealButton(page).click();
    await expect(field(page, "Enjeu")).toBeFocused();
    await expect(field(page, "Enjeu")).toHaveAttribute("aria-invalid", "true");
    for (const label of ["Le parieur", "Le contre-parieur", "Objet du pari"]) {
      await expect(field(page, label)).not.toHaveAttribute("aria-invalid", "true");
      expect(await describedErrors(field(page, label))).toBe("");
    }
    expect(currentHash(page)).toBe("");
  });

  test("CA-1 · un article vidé est en erreur et reçoit le focus", async ({ page }) => {
    await openAt(page, "");
    await fillDraft(page, { p: "Théo", c: "Inès", o: "Kevin sera en retard.", e: "Un kebab." });
    await field(page, "Article 2").fill("   ");
    await sealButton(page).click();
    await expect(field(page, "Article 2")).toBeFocused();
    expect(await describedErrors(field(page, "Article 2"))).not.toBe("");
    expect(currentHash(page)).toBe("");
  });

  test("CA-1 · 41 caractères pour un nom, 201 pour l'objet, 121 pour l'enjeu, 161 pour un article : erreurs", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillDraft(page, {
      p: "a".repeat(41),
      c: "Inès",
      o: "o".repeat(201),
      e: "e".repeat(121),
    });
    await field(page, "Article 1").fill("x".repeat(161));
    await sealButton(page).click();
    await expect(field(page, "Le parieur")).toBeFocused();
    for (const label of ["Le parieur", "Objet du pari", "Enjeu", "Article 1"]) {
      expect(await describedErrors(field(page, label)), label).toMatch(/\d+ caractères/u);
    }
    expect(currentHash(page)).toBe("");
  });

  test("CA-1 · un formulaire valide met #1.<payload> dans l'URL, au JSON canonique exact, et affiche l'Acte", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillDraft(page, {
      p: "  Théo  ",
      c: `Inès${RLO}`,
      o: "Kevin arrivera en retard à la soirée de samedi.",
      e: "Un (1) kebab.",
      deadline: "2026-10-17T20:00",
    });
    await sealButton(page).click();
    await expect(deedNumber(page)).toBeVisible();

    const hash = currentHash(page);
    expect(hash).toMatch(/^#1\.[A-Za-z0-9+$-]+$/u);
    const json = LZString.decompressFromEncodedURIComponent(hash.slice(3));
    const articles = decodeHash(hash).a;
    expect(articles).toHaveLength(3);
    const expected: DeedJson = {
      p: "Théo",
      c: "Inès",
      o: "Kevin arrivera en retard à la soirée de samedi.",
      e: "Un (1) kebab.",
      a: articles,
      // 20:00 à Paris, heure d'été : 18:00 UTC.
      d: Date.UTC(2026, 9, 17, 18, 0),
      t: NOW_MS,
    };
    expect(json).toBe(canonical(expected));
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(expected)));
    await expect(party(page, "Le parieur")).toContainText("Théo");
    await expect(party(page, "Le contre-parieur")).toContainText("Inès");
    await expect(clause(page, "Objet du pari")).toContainText(expected.o);
    await expect(clause(page, "Enjeu")).toContainText(expected.e);
    await expect(sealButton(page)).toBeHidden();
  });

  test("CA-1 · l'échéance proposée par défaut est valide : remplir les 4 textes suffit à sceller", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillDraft(page, { p: "Théo", c: "Inès", o: "Kevin sera en retard.", e: "Un kebab." });
    await sealButton(page).click();
    await expect(deedNumber(page)).toBeVisible();
    const deed = decodeHash(currentHash(page));
    expect(deed.d).toBeGreaterThan(NOW_MS);
  });
});

// ==============================================================================================
// CA-10 · Articles par défaut, 0 à 5
// ==============================================================================================

test.describe("CA-10 · Articles", () => {
  test("CA-10 · 3 articles pré-remplis : retard > 10 min, « j'suis en bas », excuse SNCF", async ({
    page,
  }) => {
    await openAt(page, "");
    const rows = page.getByRole("group", { name: /Articles/u }).getByRole("textbox");
    await expect(rows).toHaveCount(3);
    const [first, second, third] = await rows.evaluateAll((areas) =>
      areas.map((area) => (area instanceof HTMLTextAreaElement ? area.value : "")),
    );
    expect(first).toMatch(/retard/iu);
    expect(first).toMatch(/\b10\b.*min|dix.*\(10\).*min/iu);
    expect(normalizeSpaces(second ?? "")).toMatch(/«\s*j['’]suis en bas\s*»/iu);
    expect(second).toMatch(/ne vaut pas arrivée/iu);
    expect(third).toMatch(/SNCF/u);
    expect(third).toMatch(/examinée par le tribunal des potes/iu);
  });

  test("CA-10 · on peut monter à 5 articles, pas au-delà, et descendre à 0", async ({ page }) => {
    await openAt(page, "");
    const add = page.getByRole("button", { name: "Ajouter un article" });
    await add.click();
    await add.click();
    await expect(field(page, "Article 5")).toBeVisible();
    await expect(add).toBeDisabled();
    await expect(page.getByText(/5 articles au maximum/u)).toBeVisible();

    for (let position = 5; position >= 1; position -= 1) {
      await page.getByRole("button", { name: `Retirer l'article ${position}` }).click();
    }
    await expect(page.getByRole("group", { name: /Articles/u }).getByRole("textbox")).toHaveCount(
      0,
    );
    await expect(add).toBeEnabled();
  });

  test("CA-10 · un acte sans article se scelle avec a = [] et s'affiche sans article", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillDraft(page, { p: "Théo", c: "Inès", o: "Kevin sera en retard.", e: "Un kebab." });
    for (let position = 3; position >= 1; position -= 1) {
      await page.getByRole("button", { name: `Retirer l'article ${position}` }).click();
    }
    await sealButton(page).click();
    await expect(deedNumber(page)).toBeVisible();
    expect(decodeHash(currentHash(page)).a).toEqual([]);
    await expect(clause(page, "Articles").getByRole("listitem")).toHaveCount(0);
  });

  test("CA-10 · un article modifié se retrouve tel quel dans l'acte", async ({ page }) => {
    await openAt(page, "");
    await fillDraft(page, { p: "Théo", c: "Inès", o: "Kevin sera en retard.", e: "Un kebab." });
    await field(page, "Article 1").fill("Le retard est constaté au-delà de 15 minutes.");
    await sealButton(page).click();
    await expect(clause(page, "Articles").getByRole("listitem").first()).toContainText(
      "Le retard est constaté au-delà de 15 minutes.",
    );
  });
});

// ==============================================================================================
// CL-4 / CL-5 · Erreurs de formulaire
// ==============================================================================================

test.describe("CL-4 / CL-5 · Formulaire", () => {
  for (const [bettor, opponent] of [
    ["Théo", "théo"],
    ["THÉO", "théo"],
    ["Théo", `The${String.fromCodePoint(0x301)}o`],
    ["Théo", `Th${ZWSP}éo`],
  ] as const) {
    test(`CL-4 · « ${bettor} » contre « ${opponent.normalize("NFC")} » : erreur sur le contre-parieur, focus, pas de hash`, async ({
      page,
    }) => {
      await openAt(page, "");
      await fillDraft(page, { p: bettor, c: opponent, o: "Kevin sera en retard.", e: "Un kebab." });
      await sealButton(page).click();
      await expect(field(page, "Le contre-parieur")).toBeFocused();
      await expect(field(page, "Le contre-parieur")).toHaveAttribute("aria-invalid", "true");
      expect(await describedErrors(field(page, "Le contre-parieur"))).not.toBe("");
      expect(currentHash(page)).toBe("");
    });
  }

  for (const [label, deadline] of [
    ["hier", "2026-10-13T10:00"],
    ["à la minute même", "2026-10-14T10:00"],
  ] as const) {
    test(`CL-5 · échéance ${label} : erreur sur l'échéance, focus, pas de hash`, async ({
      page,
    }) => {
      await openAt(page, "");
      await fillDraft(page, {
        p: "Théo",
        c: "Inès",
        o: "Kevin sera en retard.",
        e: "Un kebab.",
        deadline,
      });
      await sealButton(page).click();
      const control = field(page, "Échéance du pari");
      await expect(control).toBeFocused();
      await expect(control).toHaveAttribute("aria-invalid", "true");
      expect(await describedErrors(control)).toMatch(/passée|passé/u);
      expect(currentHash(page)).toBe("");
    });
  }

  test("CL-5 · échéance effacée : erreur, focus, pas de hash", async ({ page }) => {
    await openAt(page, "");
    await fillDraft(page, { p: "Théo", c: "Inès", o: "Kevin sera en retard.", e: "Un kebab." });
    await field(page, "Échéance du pari").fill("");
    await sealButton(page).click();
    await expect(field(page, "Échéance du pari")).toBeFocused();
    expect(currentHash(page)).toBe("");
  });

  test("CL-4 · noms identiques arrivés par l'URL : acte refusé", async ({ page }) => {
    for (const [p, c] of [
      ["Théo", "théo"],
      ["THÉO", "théo"],
      ["Théo", `The${String.fromCodePoint(0x301)}o`],
      ["Théo", ` théo${RLO} `],
    ] as const) {
      await openAt(page, hashOf(deedWith({ p, c })));
      await expect(unreadableHeading(page), `${p} / ${c}`).toBeVisible();
      await expect(deedNumber(page)).toBeHidden();
    }
  });
});

// ==============================================================================================
// CA-2 · Même acte, même numéro, partout
// ==============================================================================================

test.describe("CA-2 · Recharger, ouvrir ailleurs", () => {
  async function readDeed(page: Page) {
    return {
      number: normalizeSpaces((await deedNumber(page).textContent()) ?? ""),
      bettor: normalizeSpaces((await party(page, "Le parieur").textContent()) ?? ""),
      opponent: normalizeSpaces((await party(page, "Le contre-parieur").textContent()) ?? ""),
      subject: normalizeSpaces((await clause(page, "Objet du pari").textContent()) ?? ""),
      stake: normalizeSpaces((await clause(page, "Enjeu").textContent()) ?? ""),
      articles: (await clause(page, "Articles").getByRole("listitem").allTextContents()).map(
        normalizeSpaces,
      ),
    };
  }

  test("CA-2 · scellé puis rechargé : même acte, même numéro, même URL", async ({ page }) => {
    await openAt(page, "");
    await fillDraft(page, { p: "Théo", c: "Inès", o: "Kevin sera en retard.", e: "Un kebab." });
    await sealButton(page).click();
    await expect(deedNumber(page)).toBeVisible();
    const before = await readDeed(page);
    const url = page.url();
    await page.reload();
    await expect(deedNumber(page)).toBeVisible();
    expect(await readDeed(page)).toEqual(before);
    expect(page.url()).toBe(url);
  });

  async function openElsewhere(browser: Browser, url: string, timezoneId: string) {
    const context = await browser.newContext({ locale: "fr-FR", timezoneId });
    const other = await context.newPage();
    await other.clock.setFixedTime(NOW_MS);
    await other.goto(url);
    await expect(deedNumber(other)).toBeVisible();
    return { context, other };
  }

  test("CA-2 · le lien ouvert dans un autre navigateur, à New York ou Tokyo : même numéro et mêmes textes", async ({
    page,
    browser,
  }) => {
    await openDeed(page, hashOf(BASE));
    const here = await readDeed(page);
    expect(here.number).toBe(expectedNumber(BASE));
    for (const zone of ["America/New_York", "Asia/Tokyo"]) {
      const { context, other } = await openElsewhere(browser, page.url(), zone);
      expect(await readDeed(other), zone).toEqual(here);
      await context.close();
    }
  });

  test("CA-2 · l'acte le plus long que le formulaire accepte se recharge à l'identique", async ({
    page,
  }) => {
    await openAt(page, "");
    await page.getByRole("button", { name: "Ajouter un article" }).click();
    await page.getByRole("button", { name: "Ajouter un article" }).click();
    await fillDraft(page, {
      p: LONGEST_CJK.p,
      c: LONGEST_CJK.c,
      o: LONGEST_CJK.o,
      e: LONGEST_CJK.e,
    });
    for (const [index, article] of LONGEST_CJK.a.entries()) {
      await field(page, `Article ${index + 1}`).fill(article);
    }
    await sealButton(page).click();
    await expect(deedNumber(page)).toBeVisible();
    const before = await readDeed(page);
    await page.reload();
    await expect(deedNumber(page)).toBeVisible();
    expect(await readDeed(page)).toEqual(before);
  });
});

// ==============================================================================================
// CA-3 · Un caractère change le numéro ; le numéro suit la formule de la spec
// ==============================================================================================

test.describe("CA-3 · Numéro d'acte", () => {
  test("CA-3 · le numéro est N° AAAA-XXXX-…-XX : année de t, 128 premiers bits du SHA-256 du JSON canonique en base32 Crockford", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE));
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(BASE)));
  });

  test("CA-3 · modifier un seul caractère de chaque champ (ou 1 ms d'une date) change le numéro", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE));
    const original = normalizeSpaces((await deedNumber(page).textContent()) ?? "");
    const variants: [string, DeedJson][] = [
      ["p", deedWith({ p: "Théa" })],
      ["p (casse)", deedWith({ p: "théo" })],
      ["c", deedWith({ c: "Inés" })],
      ["o", deedWith({ o: BASE.o.replace("samedi", "samedI") })],
      ["e", deedWith({ e: BASE.e.replace("(1)", "(2)") })],
      ["a[1]", deedWith({ a: [BASE.a[0] ?? "", (BASE.a[1] ?? "").replace("vocal", "vocaL")] })],
      ["d + 1 ms", deedWith({ d: BASE.d + 1 })],
      ["t + 1 ms", deedWith({ t: BASE.t + 1 })],
    ];
    const seen = new Set([original]);
    for (const [label, deed] of variants) {
      await setHash(page, hashOf(deed));
      await expect(deedNumber(page), label).toHaveText(exactText(expectedNumber(deed)));
      const number = normalizeSpaces((await deedNumber(page).textContent()) ?? "");
      expect(seen.has(number), `${label} : numéro déjà vu (${number})`).toBe(false);
      seen.add(number);
    }
  });

  test("CA-3 · le verdict ne change pas le numéro (il est déclaratif, hors empreinte)", async ({
    page,
  }) => {
    for (const suffix of ["", ".p", ".c", ".n"]) {
      await openDeed(page, hashOf(BASE, suffix));
      await expect(deedNumber(page), suffix).toHaveText(exactText(expectedNumber(BASE)));
    }
  });

  test("CA-3 · les clés dans un autre ordre donnent le même acte et le même numéro (JSON canonique)", async ({
    page,
  }) => {
    const shuffled = JSON.stringify({
      t: BASE.t,
      d: BASE.d,
      a: BASE.a,
      e: BASE.e,
      o: BASE.o,
      c: BASE.c,
      p: BASE.p,
    });
    await openDeed(page, hashOf(shuffled));
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(BASE)));
  });

  test("CA-3 · un caractère retiré au nettoyage (contrôle bidi, NUL) ne change ni l'acte ni le numéro", async ({
    page,
  }) => {
    await openDeed(page, hashOf(deedWith({ p: `Th${RLO}éo`, o: `${BASE.o}${NUL}` })));
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(BASE)));
    await expect(party(page, "Le parieur")).toContainText("Théo");
  });

  test("CA-3 · deux actes différents ont deux couleurs de cire de la palette, toujours la même pour un acte donné", async ({
    page,
  }) => {
    const palette = ["#9E2A24", "#1E4636", "#2B3A67", "#7A4B12"].map((hex) => {
      const value = Number.parseInt(hex.slice(1), 16);
      return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
    });
    const seal = page.getByRole("img", { name: /Sceau de cire/u });
    const waxColor = () =>
      seal.evaluate((svg) => {
        const fills = [...svg.querySelectorAll("circle")].map(
          (circle) => getComputedStyle(circle).fill,
        );
        return fills.find((fill) => fill !== "none") ?? "none";
      });
    const colors = new Set<string>();
    for (let index = 0; index < 12; index += 1) {
      const deed = deedWith({ o: `${BASE.o} Pari n° ${index}.` });
      await openDeed(page, hashOf(deed));
      const first = await waxColor();
      expect(palette, `couleur de cire ${first}`).toContain(first);
      await page.reload();
      await expect(deedNumber(page)).toBeVisible();
      expect(await waxColor()).toBe(first);
      colors.add(first);
    }
    expect(colors.size).toBeGreaterThan(1);
  });

  test("CA-3 · signatures : même nom, même gribouillis (quel que soit le rôle) ; autre nom, autre tracé", async ({
    page,
  }) => {
    const trace = (role: string) =>
      page
        .getByRole("figure", { name: role })
        .locator("path")
        .evaluate((path) => path.getAttribute("d") ?? "");
    await openDeed(page, hashOf(BASE));
    const theoAsBettor = await trace("Signature du parieur");
    const inesAsOpponent = await trace("Signature du contre-parieur");
    expect(theoAsBettor).not.toBe(inesAsOpponent);
    expect(theoAsBettor).not.toContain("Théo");

    await setHash(page, hashOf(deedWith({ p: "Inès", c: "Théo", o: "Autre pari." })));
    await expect(party(page, "Le parieur")).toContainText("Inès");
    expect(await trace("Signature du parieur")).toBe(inesAsOpponent);
    expect(await trace("Signature du contre-parieur")).toBe(theoAsBettor);
  });
});

// ==============================================================================================
// CA-4 · Compte à rebours
// ==============================================================================================

test.describe("CA-4 · Compte à rebours", () => {
  test("CA-4 · jours, heures, min, sec, mis à jour chaque seconde", async ({ page }) => {
    await openTicking(page, hashOf(BASE));
    const timer = page.getByRole("timer");
    await expect(timer).toBeVisible();
    expect(await stubsText(page)).toBe("03 jours 04 heures 05 min 06 sec");
    for (const expected of ["05", "04", "03"]) {
      await page.clock.runFor(SECOND);
      expect(await stubsText(page)).toBe(`03 jours 04 heures 05 min ${expected} sec`);
    }
    await page.clock.runFor(4 * SECOND);
    expect(await stubsText(page)).toBe("03 jours 04 heures 04 min 59 sec");
  });

  test("CA-4 · à l'échéance, le message du tribunal remplace les souches", async ({ page }) => {
    await openTicking(page, hashOf(deedWith({ d: NOW_MS + 2 * SECOND })));
    expect(await stubsText(page)).toBe("00 jours 00 heures 00 min 02 sec");
    await page.clock.runFor(SECOND);
    expect(await stubsText(page)).toBe("00 jours 00 heures 00 min 01 sec");
    await page.clock.runFor(SECOND);
    await expect(page.getByText(exactText(PASSED))).toBeVisible();
    await expect(page.getByRole("timer")).toBeHidden();
  });

  test("CA-4 · échéance déjà passée à l'ouverture : message du tribunal, pas de souches", async ({
    page,
  }) => {
    await openDeed(page, hashOf(deedWith({ d: NOW_MS - HOUR })));
    await expect(page.getByText(exactText(PASSED))).toBeVisible();
    await expect(page.getByRole("timer")).toBeHidden();
  });

  test("CA-4 · compteur live : role=timer, aria-live=off, résumé accessible mis à jour au plus toutes les 30 s", async ({
    page,
  }) => {
    // À NOW : 3 j 4 h 5 min 1 s. À +2 s : 3 j 4 h 4 min 59 s.
    await openTicking(
      page,
      hashOf(deedWith({ d: NOW_MS + 3 * DAY + 4 * HOUR + 5 * MINUTE + SECOND })),
    );
    const timer = page.getByRole("timer");
    await expect(timer).toHaveAttribute("aria-live", "off");
    await expect(timer).toHaveAccessibleName(/3 jours, 4 heures et 5 minutes/u);
    await page.clock.runFor(2 * SECOND);
    expect(await stubsText(page)).toContain("04 min 59 sec");
    await expect(timer).toHaveAccessibleName(/5 minutes/u);
    await page.clock.runFor(28 * SECOND);
    await expect(timer).toHaveAccessibleName(/3 jours, 4 heures et 4 minutes/u);
  });
});

// ==============================================================================================
// CA-5 · Déclarer le vainqueur
// ==============================================================================================

test.describe("CA-5 · Verdict", () => {
  test("CA-5 · <dialog> modal, 3 choix nommés, focus piégé (Tab et Maj+Tab), Échap ferme et rend le focus", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE));
    const hashBefore = currentHash(page);
    await declareButton(page).click();
    const dialog = verdictDialog(page);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.tagName)).toBe("DIALOG");
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(dialog.getByRole("button", { name: /Le parieur.*Théo/u })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Le contre-parieur.*Inès/u })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Match nul/u })).toBeVisible();

    const inside = () => dialog.evaluate((element) => element.contains(document.activeElement));
    expect(await inside(), "focus dans la boîte à l'ouverture").toBe(true);
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Tab");
      expect(await inside(), `Tab n° ${press + 1}`).toBe(true);
    }
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await inside(), `Maj+Tab n° ${press + 1}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(declareButton(page)).toBeFocused();
    expect(currentHash(page)).toBe(hashBefore);
  });

  for (const [choice, suffix, winner] of [
    [/Le parieur.*Théo/u, ".p", "Le parieur"],
    [/Le contre-parieur.*Inès/u, ".c", "Le contre-parieur"],
  ] as const) {
    test(`CA-5 · choisir ${winner} ajoute « ${suffix} » au hash, tamponne VAINQUEUR sur son nom, remplace le compte à rebours`, async ({
      page,
    }) => {
      await openDeed(page, hashOf(BASE));
      const hashBefore = currentHash(page);
      await declareButton(page).click();
      await verdictDialog(page).getByRole("button", { name: choice }).click();
      await expect(verdictDialog(page)).toBeHidden();
      await expect.poll(() => currentHash(page)).toBe(`${hashBefore}${suffix}`);

      const loser = winner === "Le parieur" ? "Le contre-parieur" : "Le parieur";
      await expect(party(page, winner).getByText("VAINQUEUR", { exact: true })).toBeVisible();
      await expect(party(page, loser).getByText("VAINQUEUR", { exact: true })).toBeHidden();
      await expect(page.getByRole("timer")).toBeHidden();
      await expect(deedArticle(page).getByText(JUDGED_LINE)).toBeVisible();
      await expect(deedArticle(page).getByText(exactText(VERDICT_NOTE))).toBeVisible();
      await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(BASE)));
    });
  }

  test("CA-5 · match nul : suffixe « .n », MATCH NUL sur les deux noms, aucun VAINQUEUR", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE));
    await declareButton(page).click();
    await verdictDialog(page)
      .getByRole("button", { name: /Match nul/u })
      .click();
    await expect.poll(() => currentHash(page)).toBe(hashOf(BASE, ".n"));
    for (const role of ["Le parieur", "Le contre-parieur"] as const) {
      await expect(party(page, role).getByText("MATCH NUL", { exact: true })).toBeVisible();
    }
    await expect(deedArticle(page).getByText("VAINQUEUR", { exact: true })).toHaveCount(0);
    await expect(deedArticle(page).getByText(exactText(VERDICT_NOTE))).toBeVisible();
  });

  test("CA-5 · acte jugé ouvert par lien : tampon, « Verdict déclaré. Échéance du pari : … », avertissement honnête, pas de compte à rebours", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE, ".c"));
    await expect(
      party(page, "Le contre-parieur").getByText("VAINQUEUR", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("timer")).toBeHidden();
    await expect(deedArticle(page).getByText(JUDGED_LINE)).toBeVisible();
    await expect(deedArticle(page).getByText(exactText(VERDICT_NOTE))).toBeVisible();
  });

  test("CA-5 · re-déclarer sur un acte jugé remplace le suffixe, sans l'empiler", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE, ".p"));
    await page.getByRole("button", { name: /Modifier le verdict|Déclarer le vainqueur/u }).click();
    await verdictDialog(page)
      .getByRole("button", { name: /Match nul/u })
      .click();
    await expect.poll(() => currentHash(page)).toBe(hashOf(BASE, ".n"));
  });

  test("CA-5 · un nom piégé s'affiche en texte dans la boîte de dialogue", async ({ page }) => {
    const deed = deedWith({ p: "<img src=x onerror=alert(1)>", c: "<b>Inès</b>" });
    await openDeed(page, hashOf(deed));
    await declareButton(page).click();
    const dialog = verdictDialog(page);
    await expect(
      dialog.getByRole("button", { name: /<img src=x onerror=alert\(1\)>/u }),
    ).toBeVisible();
    await expect(dialog.locator("img, b")).toHaveCount(0);
  });
});

// ==============================================================================================
// CA-6 · Impression
// ==============================================================================================

test.describe("CA-6 · Imprimer", () => {
  test("CA-6 · « Imprimer » ouvre l'impression (window.print)", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "print", {
        configurable: true,
        value: () => {
          document.documentElement.dataset["printed"] = String(
            Number(document.documentElement.dataset["printed"] ?? "0") + 1,
          );
        },
      });
    });
    await openDeed(page, hashOf(BASE));
    await printButton(page).click();
    await expect(page.locator("html")).toHaveAttribute("data-printed", "1");
  });

  test("CA-6 · feuille d'impression : aucun bouton, l'acte et son pied visibles", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE, ".p"));
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(deedArticle(page)).toBeVisible();
    await expect(deedArticle(page).getByText(exactText(FOOTER))).toBeVisible();
    await expect(deedArticle(page).getByText(exactText(VERDICT_NOTE))).toBeVisible();
    await expect(deedNumber(page)).toBeVisible();
  });

  async function pdfPages(page: Page): Promise<number> {
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/gu) ?? []).length;
  }

  const LONGEST = [
    ["prose française aux bornes", LONGEST_PROSE],
    ["textes sans espace aux bornes", LONGEST_SOLID],
    ["idéogrammes aux bornes", LONGEST_CJK],
  ] as const;
  for (const [label, deed] of LONGEST) {
    for (const suffix of ["", ".n"]) {
      test(`CA-6 · une seule page A4 : ${label}${suffix === "" ? "" : ", jugé match nul"}`, async ({
        page,
      }, testInfo) => {
        test.skip(testInfo.project.name !== "desktop", "le PDF ne dépend pas de la fenêtre");
        await openDeed(page, hashOf(deed, suffix));
        expect(await pdfPages(page)).toBe(1);
      });
    }
  }

  test("CA-6 · une seule page A4 pour l'acte le plus large qu'accepte le lien (U+FDFD, sous les 4 Ko)", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "le PDF ne dépend pas de la fenêtre");
    // Si on ne corrige pas : un lien forgé imprime un « acte officiel » sur plusieurs pages, la
    // première sans le pied « sans aucune valeur juridique » (CA-8, modèle de menace).
    const wide = String.fromCodePoint(0xfdfd);
    const deed: DeedJson = {
      p: wide.repeat(40),
      c: `x${wide.repeat(39)}`,
      o: wide.repeat(200),
      e: wide.repeat(120),
      a: [0, 1, 2, 3, 4].map(() => wide.repeat(160)),
      d: BASE.d,
      t: BASE.t,
    };
    await openDeed(page, hashOf(deed));
    expect(await pdfPages(page)).toBe(1);
  });
});

// ==============================================================================================
// CA-7 · Copier le lien
// ==============================================================================================

test.describe("CA-7 · Copier le lien", () => {
  test("CA-7 · copie l'URL courante, confirmation polie à côté du bouton, qui s'efface quand le lien change", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openDeed(page, hashOf(BASE));
    const before = await Promise.all(
      [copyButton(page), printButton(page), declareButton(page)].map(pageBox),
    );
    await copyButton(page).click();
    const status = page.getByText(/Lien copié/u);
    await expect(status).toBeVisible();
    expect(
      await status.evaluate((element) => element.closest("[aria-live]")?.getAttribute("aria-live")),
    ).toBe("polite");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    const after = await Promise.all(
      [copyButton(page), printButton(page), declareButton(page)].map(pageBox),
    );
    expect(after, "les boutons ne bougent pas").toEqual(before);

    // À côté du bouton, jamais sur l'acte.
    const statusBox = await status.boundingBox();
    const deedBox = await deedArticle(page).boundingBox();
    const copyBox = await copyButton(page).boundingBox();
    if (statusBox === null || deedBox === null || copyBox === null) throw new Error("boîtes");
    expect(statusBox.y).toBeGreaterThanOrEqual(deedBox.y + deedBox.height);
    expect(boxGap(statusBox, copyBox), "confirmation collée au bouton").toBeLessThanOrEqual(16);

    // Le lien change (verdict déclaré) : la confirmation s'efface.
    await declareButton(page).click();
    await verdictDialog(page)
      .getByRole("button", { name: /Match nul/u })
      .click();
    await expect.poll(() => currentHash(page)).toMatch(/\.n$/u);
    await expect(page.getByText(/Lien copié/u)).toHaveCount(0);

    await copyButton(page).click();
    await expect(page.getByText(/Lien copié/u)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    await setHash(page, hashOf(deedWith({ p: "Sam" })));
    await expect(party(page, "Le parieur")).toContainText("Sam");
    await expect(page.getByText(/Lien copié/u)).toHaveCount(0);
  });

  test("CA-7 · copie de la forme propre quand le lien reçu contenait un verdict inconnu", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openDeed(page, hashOf(BASE, ".z"));
    await copyButton(page).click();
    await expect(page.getByText(/Lien copié/u)).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(page.url());
    expect(new URL(copied).hash).toBe(hashOf(BASE));
  });

  for (const closeWith of ["Fermer", "Escape"] as const) {
    test(`CA-7 · presse-papiers refusé : <dialog> modal, champ sélectionné, ${closeWith} ferme, focus rendu`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator.clipboard, "writeText", {
          configurable: true,
          value: () => Promise.reject(new DOMException("refus", "NotAllowedError")),
        });
      });
      await openDeed(page, hashOf(BASE));
      await copyButton(page).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      expect(
        await dialog.evaluate(
          (element) => element.tagName === "DIALOG" && element.matches(":modal"),
        ),
      ).toBe(true);
      const input = dialog.getByRole("textbox", { name: "Lien à copier" });
      await expect(input).toHaveValue(page.url());
      await expect(input).toBeFocused();
      expect(
        await input.evaluate((element) =>
          element instanceof HTMLInputElement
            ? [element.selectionStart, element.selectionEnd, element.value.length]
            : [],
        ),
      ).toEqual([0, page.url().length, page.url().length]);
      await expect(page.getByText(/Lien copié/u)).toHaveCount(0);

      if (closeWith === "Fermer") {
        await dialog.getByRole("button", { name: "Fermer" }).click();
      } else {
        await page.keyboard.press("Escape");
      }
      await expect(dialog).toBeHidden();
      await expect(copyButton(page)).toBeFocused();
    });
  }

  test("CA-7 · presse-papiers absent (contexte non sécurisé) : même repli", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "clipboard", {
        configurable: true,
        get: () => undefined,
      });
    });
    await openDeed(page, hashOf(BASE));
    await copyButton(page).click();
    await expect(
      page.getByRole("dialog").getByRole("textbox", { name: "Lien à copier" }),
    ).toHaveValue(page.url());
  });

  test("CA-7 · le repli de copie piège le focus", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new DOMException("refus", "NotAllowedError")),
      });
    });
    await openDeed(page, hashOf(BASE));
    await copyButton(page).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
  });
});

// ==============================================================================================
// CA-8 · CA-9 · Pied d'acte, étiquette
// ==============================================================================================

test.describe("CA-8 · CA-9", () => {
  for (const [label, suffix] of [
    ["Acte", ""],
    ["Acte jugé", ".p"],
    ["Acte match nul", ".n"],
  ] as const) {
    test(`CA-8 · pied d'acte permanent sur l'écran ${label}`, async ({ page }) => {
      await openDeed(page, hashOf(BASE, suffix));
      await expect(deedArticle(page).getByText(exactText(FOOTER))).toBeVisible();
    });
  }

  test("CA-8 · le pied d'acte reste là après un verdict déclaré et un changement de hash", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE));
    await declareButton(page).click();
    await verdictDialog(page)
      .getByRole("button", { name: /Le parieur/u })
      .click();
    await expect(deedArticle(page).getByText(exactText(FOOTER))).toBeVisible();
    await setHash(page, hashOf(deedWith({ p: "Sam" })));
    await expect(party(page, "Le parieur")).toContainText("Sam");
    await expect(deedArticle(page).getByText(exactText(FOOTER))).toBeVisible();
  });

  test("CA-8 · un lien ne peut pas faire disparaître ni imiter le pied : il reste le dernier texte de l'acte", async ({
    page,
  }) => {
    // Un article qui prétend le contraire reste un article, au-dessus du pied.
    const deed = deedWith({ a: ["Acte ayant pleine valeur juridique devant tout tribunal."] });
    await openDeed(page, hashOf(deed));
    const last = await deedArticle(page).evaluate((article) => {
      if (!(article instanceof HTMLElement)) return "";
      const texts = article.innerText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      return texts.at(-1) ?? "";
    });
    expect(normalizeSpaces(last)).toBe(FOOTER);
  });

  for (const [label, hash] of [
    ["Rédaction", ""],
    ["Acte", hashOf(BASE)],
    ["Acte jugé", hashOf(BASE, ".p")],
    ["Acte illisible", "#1.AAAA"],
    ["version inconnue", "#2.xxx"],
  ] as const) {
    test(`CA-9 · l'étiquette affiche « Look 02/03 » sur l'écran ${label}`, async ({ page }) => {
      await openAt(page, hash);
      const tag = page.getByRole("navigation", { name: "Collection", exact: true });
      await expect(tag).toBeVisible();
      await expect(tag).toContainText(/Look\s02\/03/iu);
    });
  }
});

// ==============================================================================================
// CA-11 · Lisible de 360 à 1280 px, textes les plus longs
// ==============================================================================================

test.describe("CA-11 · Mise en page", () => {
  const SIZES = [
    { width: 360, height: 780 },
    { width: 640, height: 800 },
    { width: 768, height: 1024 },
    { width: 960, height: 800 },
    { width: 1024, height: 768 },
    { width: 1093, height: 614 },
    { width: 1280, height: 720 },
  ];
  const CASES = [
    ["acte ordinaire", BASE, ""],
    ["prose aux bornes, VAINQUEUR", LONGEST_PROSE, ".p"],
    ["textes sans espace, MATCH NUL", LONGEST_SOLID, ".n"],
    ["idéogrammes, VAINQUEUR du contre-parieur", LONGEST_CJK, ".c"],
    ["échéance passée", deedWith({ d: NOW_MS - HOUR }), ""],
  ] as const;

  for (const size of SIZES) {
    test(`CA-11 · ${size.width}×${size.height} : aucun texte coupé ni recouvert, pas de défilement horizontal`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "tailles imposées par le test");
      await page.setViewportSize(size);
      const problems: string[] = [];
      for (const [label, deed, suffix] of CASES) {
        await openDeed(page, hashOf(deed, suffix));
        const overflow = await horizontalOverflow(page);
        if (overflow > 0) problems.push(`${label} : défilement horizontal de ${overflow} px`);
        const found = await deedArticle(page).evaluate(layoutProblems);
        problems.push(...found.map((problem) => `${label} : ${problem}`));
      }
      expect(problems).toEqual([]);
    });
  }

  test("CA-11 · boîte du verdict à 360 px avec des noms de 40 caractères sans espace : rien ne déborde", async ({
    page,
  }) => {
    await openDeed(page, hashOf(LONGEST_SOLID));
    await declareButton(page).click();
    const dialog = verdictDialog(page);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(layoutProblems)).toEqual([]);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("CA-11 · textes libres nettoyés par sanitizeText : contrôles, bidi et NUL retirés, NFC", async ({
    page,
  }) => {
    const deed = deedWith({
      p: `${RLO}Théo${String.fromCodePoint(0x2066)}`,
      c: `In${String.fromCodePoint(0x65)}${String.fromCodePoint(0x300)}s`,
      o: `Kevin${NUL} arrivera${String.fromCodePoint(0x7)} en retard.`,
    });
    await openDeed(page, hashOf(deed));
    expect(await party(page, "Le parieur").getByRole("paragraph").first().textContent()).toBe(
      "Théo",
    );
    const opponent =
      (await party(page, "Le contre-parieur").getByRole("paragraph").first().textContent()) ?? "";
    expect(opponent).toBe("Inès");
    expect(opponent.normalize("NFC")).toBe(opponent);
    expect(await clause(page, "Objet du pari").getByRole("paragraph").first().textContent()).toBe(
      "Kevin arrivera en retard.",
    );
    // La forme propre de l'URL ne contient plus rien d'invisible.
    const clean = decodeHash(currentHash(page));
    expect(clean.p).toBe("Théo");
    expect(clean.o).toBe("Kevin arrivera en retard.");
  });

  test("CA-11 · texte « zalgo » : réduit à 4 marques combinantes et contenu dans sa ligne", async ({
    page,
  }) => {
    const zalgo = `Z${String.fromCodePoint(0x300, 0x301, 0x302, 0x303, 0x304, 0x305, 0x306, 0x307)}éro`;
    await openDeed(page, hashOf(deedWith({ p: zalgo })));
    const shown =
      (await party(page, "Le parieur").getByRole("paragraph").first().textContent()) ?? "";
    expect(
      Array.from(shown.normalize("NFD")).filter((char) => /\p{M}/u.test(char)).length,
    ).toBeLessThanOrEqual(5);
    expect(await deedArticle(page).evaluate(layoutProblems)).toEqual([]);
  });
});

// ==============================================================================================
// CL-1 · Hash vide, version inconnue, verdict inconnu
// ==============================================================================================

test.describe("CL-1 · Formes du hash", () => {
  for (const hash of ["", "#", "#1", "#1."]) {
    test(`CL-1 · « ${hash || "(aucun hash)"} » : écran Rédaction, sans message d'erreur`, async ({
      page,
    }) => {
      await openAt(page, hash);
      await expect(draftHeading(page)).toBeVisible();
      await expect(sealButton(page)).toBeVisible();
      await expect(unreadableHeading(page)).toBeHidden();
    });
  }

  for (const hash of ["#2.xxx", "#2." + payloadOf(canonical(BASE)), "#10.abc", "#3"]) {
    test(`CL-1 · « ${hash.slice(0, 12)} » : « Acte d'une version inconnue », URL conservée`, async ({
      page,
    }) => {
      await openAt(page, hash);
      await expect(
        page.getByRole("heading", { name: specText("Acte d'une version inconnue") }),
      ).toBeVisible();
      await expect(deedNumber(page)).toBeHidden();
      expect(currentHash(page)).toBe(hash);
      await expect(page.getByRole("button", { name: "Rédiger un nouvel acte" })).toBeVisible();
    });
  }

  for (const suffix of [".z", ".P", ".pp", ".p.c", ".", ".<img>"]) {
    test(`CL-1 · verdict inconnu « ${suffix} » : acte sans verdict, compte à rebours, même numéro`, async ({
      page,
    }) => {
      await openDeed(page, `${hashOf(BASE)}${suffix}`);
      await expect(page.getByRole("timer")).toBeVisible();
      await expect(deedArticle(page).getByText(/^(VAINQUEUR|MATCH NUL)$/u)).toHaveCount(0);
      await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(BASE)));
      await expect(declareButton(page)).toBeVisible();
    });
  }
});

// ==============================================================================================
// CL-2 · Payloads hostiles
// ==============================================================================================

test.describe("CL-2 · Payload hostile → « Acte illisible »", () => {
  const validJson = canonical(BASE);
  const withProto = `{"__proto__":{"polluted":"oui"},${validJson.slice(1)}`;
  const withConstructor = `{"constructor":{"prototype":{"polluted":"oui"}},${validJson.slice(1)}`;
  const cases: [string, string][] = [
    ["tableau", "[]"],
    ["tableau d'acte", `[${validJson}]`],
    ["nombre", "42"],
    ["null", "null"],
    ["chaîne", '"acte"'],
    ["booléen", "true"],
    ["objet avec __proto__", withProto],
    ["objet avec constructor.prototype", withConstructor],
    ["objet vide", "{}"],
    ["JSON invalide", "{p:"],
    ["JSON tronqué", validJson.slice(0, -1)],
    ["clé inconnue", `${validJson.slice(0, -1)},"x":1}`],
    ["clé manquante", JSON.stringify({ ...BASE, t: undefined })],
    ["acte valide suivi de blancs (> 4 Ko décompressés)", `${validJson}${" ".repeat(4200)}`],
    ["bombe : 2 millions de caractères", `"${"a".repeat(2_000_000)}"`],
  ];
  for (const [label, json] of cases) {
    test(`CL-2 · ${label}`, async ({ page }) => {
      await openAt(page, hashOf(json));
      await expect(unreadableHeading(page)).toBeVisible();
      await expect(deedNumber(page)).toBeHidden();
      await expect(page.getByRole("button", { name: "Rédiger un nouvel acte" })).toBeVisible();
      expect(
        await page.evaluate(() => {
          const probe: Record<string, unknown> = {};
          return [
            probe["polluted"],
            Object.prototype.hasOwnProperty.call(Object.prototype, "polluted"),
          ];
        }),
      ).toEqual([undefined, false]);
    });
  }

  for (const [label, hash] of [
    ["caractères hors alphabet", "#1.!!!"],
    ["lz-string renvoie une chaîne vide", "#1.A"],
    ["lz-string renvoie null", "#1.Q"],
    ["percent-encodage", "#1.%3Cimg%3E"],
    ["hash brut de plus de 4 Ko", `#1.${"A".repeat(4100)}`],
    ["hash brut de plus de 4 Ko avec un acte valide devant", `${hashOf(BASE)}.${"p".repeat(4100)}`],
  ] as const) {
    test(`CL-2 · ${label}`, async ({ page }) => {
      await openAt(page, hash);
      await expect(unreadableHeading(page)).toBeVisible();
      await expect(deedNumber(page)).toBeHidden();
    });
  }

  test("CL-2 · « Rédiger un nouvel acte » ouvre la Rédaction et vide le hash", async ({ page }) => {
    await openAt(page, "#1.!!!");
    await page.getByRole("button", { name: "Rédiger un nouvel acte" }).click();
    await expect(draftHeading(page)).toBeVisible();
    expect(currentHash(page)).toBe("");
  });

  test("CL-2 · un acte décompressé de 4096 octets exactement est accepté", async ({ page }) => {
    const json = canonical(BASE);
    const padded = `${json.slice(0, -1)}${" ".repeat(4096 - Buffer.byteLength(json))}}`;
    expect(Buffer.byteLength(padded)).toBe(4096);
    await openDeed(page, hashOf(padded));
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(BASE)));
  });
});

// ==============================================================================================
// Champ par champ : absent, vide, mauvais type, hors bornes, trop long, HTML/JS, unicode
// ==============================================================================================

test.describe("Champs du lien : chaque valeur hostile est refusée proprement", () => {
  const tooLong = (n: number) => "x".repeat(n + 1);
  const refused: [string, Record<string, unknown>][] = [
    ["p vide", { p: "" }],
    ["p blancs", { p: "   " }],
    ["p invisible (U+200B)", { p: ZWSP.repeat(3) }],
    ["p contrôle seul", { p: NUL }],
    ["p nombre", { p: 42 }],
    ["p null", { p: null }],
    ["p tableau", { p: ["Théo"] }],
    ["p 41 caractères", { p: tooLong(40) }],
    ["c 41 caractères", { c: tooLong(40) }],
    ["o 201 caractères", { o: tooLong(200) }],
    ["e 121 caractères", { e: tooLong(120) }],
    ["o objet", { o: { toString: "x" } }],
    ["a pas un tableau", { a: "article" }],
    ["a objet", { a: { 0: "x", length: 1 } }],
    ["a 6 éléments", { a: ["1", "2", "3", "4", "5", "6"] }],
    ["a élément vide", { a: [""] }],
    ["a élément nombre", { a: [1] }],
    ["a élément 161 caractères", { a: [tooLong(160)] }],
    ["d chaîne", { d: String(BASE.d) }],
    ["d flottant", { d: BASE.d + 0.5 }],
    ["d égal à t", { d: BASE.t }],
    ["d avant t", { d: BASE.t - 1 }],
    ["d plus de 10 ans après t", { d: BASE.t + 3654 * DAY }],
    ["d négatif", { d: -1 }],
    ["d très grand", { d: 1e300 }],
    ["t avant 2026", { t: Date.UTC(2025, 11, 31, 23, 59, 59, 999) }],
    ["t plus d'un jour dans le futur", { t: NOW_MS + DAY + 1, d: NOW_MS + 2 * DAY }],
    ["t chaîne", { t: String(BASE.t) }],
    ["t flottant", { t: BASE.t + 0.25 }],
    ["t null", { t: null }],
  ];
  for (const [label, changes] of refused) {
    test(`URL · ${label} → acte refusé`, async ({ page }) => {
      const json = JSON.stringify({ ...BASE, ...changes });
      await openAt(page, hashOf(json));
      await expect(unreadableHeading(page)).toBeVisible();
      await expect(deedNumber(page)).toBeHidden();
    });
  }

  const accepted: [string, Partial<DeedJson>][] = [
    ["p 40 caractères", { p: "x".repeat(40) }],
    ["p 40 emoji", { p: "🎉".repeat(40) }],
    ["p en arabe (RTL)", { p: "ثيو" }],
    [
      "o 200, e 120, 5 articles de 160",
      {
        o: "o".repeat(200),
        e: "e".repeat(120),
        a: ["a", "b", "c", "d", "e"].map((x) => x.repeat(160)),
      },
    ],
    ["a vide", { a: [] }],
    ["d = t + 1 ms", { d: BASE.t + 1 }],
    ["d = t + 3650 jours", { d: BASE.t + 3650 * DAY }],
    ["t = 2026-01-01 00:00 UTC", { t: Date.UTC(2026, 0, 1), d: Date.UTC(2026, 0, 2) }],
    ["t = maintenant + 1 jour", { t: NOW_MS + DAY, d: NOW_MS + 2 * DAY }],
  ];
  for (const [label, changes] of accepted) {
    test(`URL · ${label} → acte accepté, numéro conforme`, async ({ page }) => {
      const deed = deedWith(changes);
      await openDeed(page, hashOf(deed));
      await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(deed)));
    });
  }
});

// ==============================================================================================
// CL-3 · HTML, script, URL : du texte, jamais un lien
// ==============================================================================================

test.describe("CL-3 · Contenu piégé affiché en texte", () => {
  const TRAPPED = deedWith({
    p: "<img src=x onerror=alert(1)>",
    c: "<script>alert(2)</script>",
    o: `Voir https://evil.example/phish ou ${SCRIPT_SCHEME}alert(3) ou www.evil.example`,
    e: "<b>Un kebab</b> & <i>des frites</i>",
    a: [
      '<a href="https://evil.example">Cliquez ici</a>',
      "<svg onload=alert(4)>",
      `[lien](${SCRIPT_SCHEME}alert(5))`,
    ],
  });

  test("CL-3 · tout s'affiche tel quel, aucun élément ni lien créé dans l'acte", async ({
    page,
  }) => {
    await openDeed(page, hashOf(TRAPPED));
    await expect(party(page, "Le parieur")).toContainText(TRAPPED.p);
    await expect(party(page, "Le contre-parieur")).toContainText(TRAPPED.c);
    await expect(clause(page, "Objet du pari")).toContainText(TRAPPED.o);
    await expect(clause(page, "Enjeu")).toContainText(TRAPPED.e);
    for (const article of TRAPPED.a) {
      await expect(clause(page, "Articles")).toContainText(article);
    }
    await expect(deedArticle(page).getByRole("link")).toHaveCount(0);
    await expect(deedArticle(page).locator("img, script, b, i, a, iframe")).toHaveCount(0);
    await expect(deedArticle(page).locator("svg")).toHaveCount(4);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll("[href], [src]")]
          .map((element) => element.getAttribute("href") ?? element.getAttribute("src") ?? "")
          .filter((value) => value.includes("evil") || value.toLowerCase().includes("script:")),
      ),
    ).toEqual([]);
  });

  test("CL-3 · contenu piégé : rien ne s'exécute après verdict, impression et copie", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openDeed(page, hashOf(TRAPPED));
    await copyButton(page).click();
    await declareButton(page).click();
    await verdictDialog(page)
      .getByRole("button", { name: /Le parieur/u })
      .click();
    await expect(deedArticle(page).getByText(/^Vainqueur déclaré/u)).toContainText(TRAPPED.p);
    await expect(page.locator("img, iframe")).toHaveCount(0);
  });
});

// ==============================================================================================
// CL-6 · crypto.subtle indisponible
// ==============================================================================================

test.describe("CL-6 · Sans crypto.subtle", () => {
  test("CL-6 · crypto.subtle absent : « N° NON-SCELLÉ », bandeau d'explication, acte lisible", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, "subtle", {
        configurable: true,
        get: () => undefined,
      });
    });
    await openDeed(page, hashOf(BASE));
    await expect(deedNumber(page)).toHaveText(/^N°\sNON-SCELLÉ$/u);
    await expect(page.getByText(/non scellé/iu).first()).toBeVisible();
    await expect(page.getByText(/empreinte|sécurisé/iu).first()).toBeVisible();
    await expect(party(page, "Le parieur")).toContainText("Théo");
    await expect(clause(page, "Objet du pari")).toContainText(BASE.o);
    await expect(deedArticle(page).getByText(exactText(FOOTER))).toBeVisible();
    await expect(page.getByRole("timer")).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("CL-6 · digest qui échoue : même repli, pas d'écran blanc", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(SubtleCrypto.prototype, "digest", {
        configurable: true,
        value: () => Promise.reject(new DOMException("non", "NotSupportedError")),
      });
    });
    await openDeed(page, hashOf(BASE));
    await expect(deedNumber(page)).toHaveText(/^N°\sNON-SCELLÉ$/u);
    await expect(party(page, "Le parieur")).toContainText("Théo");
  });

  test("CL-6 · axe : écran non scellé sans violation", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, "subtle", {
        configurable: true,
        get: () => undefined,
      });
    });
    await openDeed(page, hashOf(BASE));
    await expectAxeClean(page);
  });
});

// ==============================================================================================
// CL-7 · Noms très longs sans espace
// ==============================================================================================

test.describe("CL-7 · Noms de 40 caractères sans espace", () => {
  test("CL-7 · à 360 px : coupure propre, rien ne déborde ni n'est rogné", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    const deed = deedWith({ p: "W".repeat(40), c: "Ｍ".repeat(40) });
    await openDeed(page, hashOf(deed, ".p"));
    for (const role of ["Le parieur", "Le contre-parieur"] as const) {
      const name = party(page, role).getByRole("paragraph").first();
      expect(await name.evaluate((element) => getComputedStyle(element).overflowWrap)).toBe(
        "anywhere",
      );
      const lines = await name.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
      });
      expect(lines, `${role} coupé sur plusieurs lignes`).toBeGreaterThan(1);
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    expect(await deedArticle(page).evaluate(layoutProblems)).toEqual([]);
  });
});

// ==============================================================================================
// CL-8 · hashchange
// ==============================================================================================

test.describe("CL-8 · Hash modifié page ouverte", () => {
  test("CL-8 · acte A → acte B → Rédaction → illisible → acte jugé → Précédent", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE));
    const other = deedWith({ p: "Sam", c: "Léa", o: "Léa finira le marathon." });

    await setHash(page, hashOf(other));
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(other)));
    await expect(party(page, "Le parieur")).toContainText("Sam");
    await expect(clause(page, "Objet du pari")).toContainText(other.o);

    await setHash(page, "");
    await expect(draftHeading(page)).toBeVisible();
    await expect(deedArticle(page)).toBeHidden();

    await setHash(page, "#1.!!!");
    await expect(unreadableHeading(page)).toBeVisible();

    await setHash(page, hashOf(other, ".c"));
    await expect(
      party(page, "Le contre-parieur").getByText("VAINQUEUR", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("timer")).toBeHidden();

    await setHash(page, hashOf(other));
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(deedArticle(page).getByText("VAINQUEUR", { exact: true })).toHaveCount(0);

    await page.goBack();
    await expect(
      party(page, "Le contre-parieur").getByText("VAINQUEUR", { exact: true }),
    ).toBeVisible();
  });

  test("CL-8 · le hash change pendant que la boîte du verdict est ouverte : elle se ferme, l'acte se recharge", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE));
    await declareButton(page).click();
    await expect(verdictDialog(page)).toBeVisible();
    const other = deedWith({ p: "Sam" });
    await setHash(page, hashOf(other));
    await expect(verdictDialog(page)).toBeHidden();
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(other)));
    expect(currentHash(page)).toBe(hashOf(other));
  });

  test("CL-8 · le compte à rebours suit le nouvel acte, sans deux minuteurs qui se battent", async ({
    page,
  }) => {
    await openTicking(page, hashOf(BASE));
    await setHash(page, hashOf(deedWith({ d: NOW_MS + 10 * SECOND })));
    await expect(page.getByRole("timer")).toContainText(/10\s*sec/u);
    for (const remaining of ["09", "08", "07"]) {
      await page.clock.runFor(SECOND);
      expect(await stubsText(page)).toBe(`00 jours 00 heures 00 min ${remaining} sec`);
    }
  });
});

// ==============================================================================================
// CLAUDE.md · accessibilité, typographie, budget, sur chaque écran de la spec
// ==============================================================================================

test.describe("Écrans de la spec · axe, typographie, cibles, contraste", () => {
  const SCREENS: [string, (page: Page) => Promise<void>][] = [
    ["Rédaction", (page) => openAt(page, "")],
    [
      "Rédaction en erreur",
      async (page) => {
        await openAt(page, "");
        await sealButton(page).click();
        await expect(field(page, "Le parieur")).toBeFocused();
      },
    ],
    ["Acte", (page) => openDeed(page, hashOf(BASE))],
    ["Acte, échéance passée", (page) => openDeed(page, hashOf(deedWith({ d: NOW_MS - HOUR })))],
    ["Acte jugé VAINQUEUR", (page) => openDeed(page, hashOf(BASE, ".p"))],
    ["Acte jugé MATCH NUL", (page) => openDeed(page, hashOf(BASE, ".n"))],
    ["Acte avec verdict inconnu (message)", (page) => openDeed(page, hashOf(BASE, ".z"))],
    [
      "Boîte du verdict",
      async (page) => {
        await openDeed(page, hashOf(BASE));
        await declareButton(page).click();
        await expect(verdictDialog(page)).toBeVisible();
      },
    ],
    [
      "Repli de copie",
      async (page) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator.clipboard, "writeText", {
            configurable: true,
            value: () => Promise.reject(new DOMException("refus", "NotAllowedError")),
          });
        });
        await openDeed(page, hashOf(BASE));
        await copyButton(page).click();
        await expect(page.getByRole("dialog")).toBeVisible();
      },
    ],
    ["Acte illisible", (page) => openAt(page, "#1.!!!")],
    ["Version inconnue", (page) => openAt(page, "#2.xxx")],
  ];

  for (const [label, open] of SCREENS) {
    test(`axe · ${label}`, async ({ page }) => {
      await open(page);
      await expectAxeClean(page);
    });

    test(`typographie française · ${label}`, async ({ page }) => {
      await open(page);
      await expectFrenchTypography(page);
    });

    test(`cibles tactiles ≥ 44 px et pas de défilement horizontal · ${label}`, async ({ page }) => {
      await open(page);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("button, input, textarea, select")]
          .filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0;
          })
          .filter((element) => {
            const dialog = element.closest("dialog");
            return dialog === null || dialog.open;
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              name: (
                element.textContent ??
                element.getAttribute("aria-label") ??
                element.id
              ).trim(),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          })
          .filter((target) => target.width < 44 || target.height < 44),
      );
      expect(small).toEqual([]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test(`contraste ≥ 4.5:1 (3:1 au-delà de 24 px) · ${label}`, async ({ page }) => {
      await open(page);
      const failures = contrastFailures(await page.locator("body").evaluate(snapshotTextNodes));
      expect(failures).toEqual([]);
    });
  }

  test("prefers-reduced-motion : le coup de tampon n'anime rien", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDeed(page, hashOf(BASE));
    await declareButton(page).click();
    await verdictDialog(page)
      .getByRole("button", { name: /Le parieur/u })
      .click();
    await expect(party(page, "Le parieur").getByText("VAINQUEUR", { exact: true })).toBeVisible();
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .map((animation) => (animation instanceof CSSAnimation ? animation.animationName : "?")),
    );
    expect(running).toEqual([]);
  });

  test("budget : moins de 50 Ko de JS gzip sur la page", async ({ page }) => {
    const pending: Promise<Buffer>[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "script") pending.push(response.body());
    });
    await openDeed(page, hashOf(BASE));
    await page.waitForLoadState("networkidle");
    const scripts = await Promise.all(pending);
    const total = scripts.reduce((sum, body) => sum + gzipSync(body).length, 0);
    expect(scripts.length).toBeGreaterThan(0);
    expect(total).toBeLessThan(50 * 1024);
  });

  test("langue : <html lang=fr>, titre en français avec insécable", async ({ page }) => {
    await openAt(page, "");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    expect(await page.title()).toContain("Juré Craché");
  });

  test("tiret cadratin : aucun dans les textes d'interface", async ({ page }) => {
    for (const hash of ["", hashOf(BASE), hashOf(BASE, ".n"), "#1.!!!", "#2.x"]) {
      await openAt(page, hash);
      const text = await page.locator("body").innerText();
      expect(text.includes(String.fromCodePoint(0x2014)), hash).toBe(false);
    }
  });
});

// ==============================================================================================
// Tour 2 (agent tester) : spec mise à jour après le tour 1. Écran 3 « Verdict déclaré », numéro
// sur 64 bits (128 bits en base32 depuis le tour 3, builder), 4 Ko en unités UTF-16 (acte
// d'emoji), CA-6 par construction (plafonds, pied en marge @page, pas de page blanche), CL-6
// imprimé, « lien trop long » relié au champ, heure inexistante au passage à l'heure d'été,
// « Nouvel acte » absent des écrans de refus.
// ==============================================================================================

/** Largeur imprimable d'une page A4 (210 mm moins 2 × 10 mm de marge @page), en px CSS. */
const PDF_ONLY_DESKTOP = "le PDF ne dépend pas de la fenêtre";
const A4_TEXT_WIDTH = Math.floor(((210 - 20) / 25.4) * 96);

/** Emoji d'un point de code (les plus larges) mêlés de séquences ZWJ et de drapeaux. */
const EMOJI = [
  "🎉",
  "😂",
  "🍕",
  "🚆",
  "⏰",
  "🥙",
  "🤝",
  "🏆",
  "😤",
  "🙏",
  "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
  "🇫🇷",
];
function emoji(length: number, seed: number): string {
  const out: string[] = [];
  for (let index = seed; out.length < length; index += 5) {
    const next = Array.from(EMOJI[index % EMOJI.length] ?? "🎉");
    out.push(...(out.length + next.length <= length ? next : ["🎉"]));
  }
  return out.join("");
}
/** Acte d'emoji aux bornes : 1200 points de code, plus de 4 Ko en UTF-8, ~2 300 unités UTF-16. */
const EMOJI_AT_BOUNDS: DeedJson = {
  p: emoji(40, 1),
  c: emoji(40, 2),
  o: emoji(200, 3),
  e: emoji(120, 4),
  a: [5, 6, 7, 8, 9].map((seed) => emoji(160, seed)),
  d: BASE.d,
  t: BASE.t,
};

/**
 * Même acte en emoji d'un seul point de code (les glyphes d'emoji les plus larges), pour lire le
 * PDF : Chromium y écrit un drapeau (2 points de code, 1 glyphe) sous un code privé, ce qui
 * rendrait l'oracle aveugle (limite du PDF, pas du look).
 */
const WIDE_EMOJI = ["🎉", "😂", "🍕", "🚆", "⏰", "🥙", "🤝", "🏆", "😤", "🙏"];
function wideEmoji(length: number, seed: number): string {
  return Array.from(
    { length },
    (_, index) => WIDE_EMOJI[(index * 3 + seed) % WIDE_EMOJI.length],
  ).join("");
}
const WIDE_EMOJI_AT_BOUNDS: DeedJson = {
  p: wideEmoji(40, 1),
  c: wideEmoji(40, 2),
  o: wideEmoji(200, 3),
  e: wideEmoji(120, 4),
  a: [5, 6, 7, 8, 9].map((seed) => wideEmoji(160, seed)),
  d: BASE.d,
  t: BASE.t,
};

/** U+FDFD aux bornes : le lien le plus « large » que le schéma accepte (forgé). */
const FDFD = String.fromCodePoint(0xfdfd);
const FORGED_WIDE: DeedJson = {
  p: FDFD.repeat(40),
  c: `x${FDFD.repeat(39)}`,
  o: FDFD.repeat(200),
  e: FDFD.repeat(120),
  a: [0, 1, 2, 3, 4].map(() => FDFD.repeat(160)),
  d: BASE.d,
  t: BASE.t,
};

async function printedPdf(page: Page): Promise<Buffer> {
  await page.evaluate(() => document.fonts.ready);
  return page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
}

/** Oracle indépendant du nombre de pages : objets « /Type /Page » du PDF. */
function pageObjects(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/gu) ?? []).length;
}

function freeTexts(deed: DeedJson): string[] {
  return [deed.p, deed.c, deed.o, deed.e, ...deed.a];
}

/** Sans crypto.subtle (contexte non sécurisé, CL-6). */
async function withoutSubtle(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Crypto.prototype, "subtle", { configurable: true, get: () => undefined });
  });
}

/** L'acte vu comme sur papier : média print, largeur imprimable A4. */
async function asPrinted(page: Page) {
  await page.setViewportSize({ width: A4_TEXT_WIDTH, height: 1100 });
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.fonts.ready);
}

test.describe("Tour 2 · CA-6 · une page A4 par construction", () => {
  // Les 3 échecs du tour 1 : une page, le pied deux fois sur cette page (fin de l'acte + marge
  // @page), le numéro une fois.
  const TOUR1_FAILURES = [
    ["idéogrammes aux bornes", LONGEST_CJK, ""],
    ["idéogrammes aux bornes, jugé match nul", LONGEST_CJK, ".n"],
    ["U+FDFD forgé aux bornes", FORGED_WIDE, ""],
  ] as const;
  for (const [label, deed, suffix] of TOUR1_FAILURES) {
    test(`CA-6 · ${label} : une seule page, pied d'acte dans l'acte et dans la marge, numéro présent`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
      await openDeed(page, hashOf(deed, suffix));
      const pdf = await printedPdf(page);
      const pages = pdfPageTexts(pdf);
      expect(pageObjects(pdf)).toBe(1);
      expect(pages).toHaveLength(1);
      const [text = ""] = pages;
      expect(countIgnoringSpaces(text, FOOTER)).toBe(2);
      expect(countIgnoringSpaces(text, expectedNumber(deed))).toBe(1);
      expect(countIgnoringSpaces(text, "Acte de pari")).toBeGreaterThanOrEqual(1);
    });
  }

  test("CA-6 · l'oracle du PDF voit la coupure : un lien forgé en U+FDFD n'imprime pas ses 1 199 glyphes", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
    // Témoin : prouve que le PDF ne contient que ce qui est visible (sinon le test suivant,
    // « idéogrammes imprimés en entier », ne prouverait rien).
    await openDeed(page, hashOf(FORGED_WIDE));
    const [text = ""] = pdfPageTexts(await printedPdf(page));
    const printed = Array.from(text).filter((char) => char === FDFD).length;
    expect(printed).toBeGreaterThan(0);
    expect(printed).toBeLessThan(freeTexts(FORGED_WIDE).join("").length);
  });

  for (const [label, deed, suffix, unsealed] of [
    ["idéogrammes aux bornes", LONGEST_CJK, "", false],
    ["idéogrammes aux bornes, VAINQUEUR", LONGEST_CJK, ".p", false],
    ["idéogrammes aux bornes, non scellé, VAINQUEUR", LONGEST_CJK, ".p", true],
    ["idéogrammes aux bornes, non scellé, match nul", LONGEST_CJK, ".n", true],
    ["prose aux bornes, non scellé, VAINQUEUR", LONGEST_PROSE, ".c", true],
    ["emoji aux bornes", WIDE_EMOJI_AT_BOUNDS, "", false],
    ["emoji aux bornes, non scellé, VAINQUEUR", WIDE_EMOJI_AT_BOUNDS, ".p", true],
  ] as const) {
    test(`CA-6 · ${label} : une page, chaque texte libre imprimé en entier`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", PDF_ONLY_DESKTOP);
      if (unsealed) await withoutSubtle(page);
      await openDeed(page, hashOf(deed, suffix));
      const pdf = await printedPdf(page);
      expect(pageObjects(pdf)).toBe(1);
      const [text = ""] = pdfPageTexts(pdf);
      const missing = freeTexts(deed)
        .map((value, index) => ({ index, found: countIgnoringSpaces(text, value) }))
        .filter(({ found }) => found === 0)
        .map(({ index }) => `texte libre n° ${index + 1} incomplet sur le papier`);
      expect(missing).toEqual([]);
      expect(countIgnoringSpaces(text, FOOTER)).toBe(2);
    });

    test(`CA-6 · ${label} : rien de coupé ni de recouvert dans la mise en page imprimée`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "largeur A4 imposée par le test");
      if (unsealed) await withoutSubtle(page);
      await openDeed(page, hashOf(deed, suffix));
      await asPrinted(page);
      expect(await deedArticle(page).evaluate(layoutProblems)).toEqual([]);
    });
  }
});

test.describe("Tour 2 · CL-6 · non scellé, imprimé", () => {
  test("CL-6 · sur papier, « N° NON-SCELLÉ » est accompagné de son explication, sur une page", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "le PDF ne dépend pas de la fenêtre");
    await withoutSubtle(page);
    await openDeed(page, hashOf(BASE));
    await expect(deedNumber(page)).toHaveText(exactText("N° NON-SCELLÉ"));
    await page.emulateMedia({ media: "print" });
    const explanation = page.getByText(/Numéro non scellé/u);
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText(/empreinte/u);
    await expect(explanation).toContainText(/ne prouve rien/u);
    const pdf = await printedPdf(page);
    expect(pageObjects(pdf)).toBe(1);
    const [text = ""] = pdfPageTexts(pdf);
    expect(countIgnoringSpaces(text, "N° NON-SCELLÉ")).toBe(1);
    expect(countIgnoringSpaces(text, "Numéro non scellé")).toBe(1);
    expect(countIgnoringSpaces(text, "ne prouve rien")).toBe(1);
  });

  test("CL-6 · le bandeau imprimé reste lisible : contraste ≥ 4.5:1 en média print", async ({
    page,
  }) => {
    await withoutSubtle(page);
    await openDeed(page, hashOf(BASE));
    await page.emulateMedia({ media: "print" });
    const failures = contrastFailures(
      await page.getByText(/Numéro non scellé/u).evaluate(snapshotTextNodes),
    );
    expect(failures).toEqual([]);
  });
});

test.describe("Tour 2 · Écran 3 · « Verdict déclaré. Échéance du pari : <date> »", () => {
  const MONTHS =
    "janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre";
  const DATE = new RegExp(`\\b(?:1er|\\d{1,2})\\s(?:${MONTHS})\\s\\d{4}\\b`, "gu");

  async function datesIn(locator: Locator): Promise<string[]> {
    return [...normalizeSpaces((await locator.innerText()) ?? "").matchAll(DATE)].map(
      (match) => match[0],
    );
  }

  for (const suffix of [".p", ".c", ".n"] as const) {
    test(`Écran 3 · ${suffix} : la ligne dit exactement « Verdict déclaré. Échéance du pari : 17 octobre 2026 »`, async ({
      page,
    }) => {
      await openDeed(page, hashOf(BASE, suffix));
      const line = deedArticle(page).getByText(JUDGED_LINE);
      await expect(line).toHaveText(
        exactText("Verdict déclaré. Échéance du pari : 17 octobre 2026."),
      );
    });
  }

  test("Écran 3 · ouvert un mois après l'échéance : aucune date de verdict, seules la rédaction et l'échéance", async ({
    page,
  }) => {
    const later = NOW_MS + 30 * DAY;
    await openDeed(page, hashOf(BASE, ".p"), later);
    await expect(deedArticle(page).getByText(JUDGED_LINE)).toBeVisible();
    const dates = new Set(await datesIn(deedArticle(page)));
    expect([...dates].sort()).toEqual(["14 octobre 2026", "17 octobre 2026"].sort());
    // La date du jour (13 novembre 2026) n'apparaît nulle part.
    expect(normalizeSpaces(await page.locator("body").innerText())).not.toContain(
      "13 novembre 2026",
    );
    await expect(page.getByText(/Jugé le/u)).toHaveCount(0);
  });

  test("Écran 3 · verdict déclaré dans la boîte : même ligne, pas de date du jour", async ({
    page,
  }) => {
    const later = NOW_MS + 10 * DAY;
    await openDeed(page, hashOf(BASE), later);
    await declareButton(page).click();
    await verdictDialog(page)
      .getByRole("button", { name: /Match nul/u })
      .click();
    await expect(deedArticle(page).getByText(JUDGED_LINE)).toHaveText(
      exactText("Verdict déclaré. Échéance du pari : 17 octobre 2026."),
    );
    expect(normalizeSpaces(await page.locator("body").innerText())).not.toContain(
      "24 octobre 2026",
    );
  });

  test.describe("à Auckland", () => {
    test.use({ timezoneId: "Pacific/Auckland" });
    test("Écran 3 · l'échéance du 17 à 20 h (Paris) s'affiche le 18 octobre dans le fuseau de l'appareil", async ({
      page,
    }) => {
      const deed = deedWith({ d: Date.UTC(2026, 9, 17, 18, 0) });
      await openDeed(page, hashOf(deed, ".c"));
      await expect(deedArticle(page).getByText(JUDGED_LINE)).toHaveText(
        exactText("Verdict déclaré. Échéance du pari : 18 octobre 2026."),
      );
      await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(deed)));
    });
  });
});

test.describe("Tour 2 · CA-3 · numéro sur 128 bits (tour 3), année UTC", () => {
  test("CA-3 · rédigé le 31 décembre à 23 h 30 UTC, lu à Paris le 1er janvier : N° 2026-…", async ({
    page,
  }) => {
    const deed = deedWith({ t: Date.UTC(2026, 11, 31, 23, 30), d: Date.UTC(2027, 0, 10) });
    await openDeed(page, hashOf(deed), Date.UTC(2027, 0, 1, 1, 0));
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(deed)));
    expect(expectedNumber(deed)).toMatch(
      /^N° 2026(?:-[0-9A-HJKMNP-TV-Z]{4}){6}-[0-9A-HJKMNP-TV-Z]{2}$/u,
    );
  });

  test.describe("à Kiritimati (UTC+14)", () => {
    test.use({ timezoneId: "Pacific/Kiritimati" });
    test("CA-3 · même lien, même numéro qu'à Paris (année UTC de t)", async ({ page }) => {
      const deed = deedWith({ t: Date.UTC(2026, 11, 31, 23, 30), d: Date.UTC(2027, 0, 10) });
      await openDeed(page, hashOf(deed), Date.UTC(2027, 0, 1, 1, 0));
      await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(deed)));
    });
  });
});

test.describe("Tour 2 · acte d'emoji aux bornes", () => {
  test("Format d'URL · lien d'un acte d'emoji aux bornes (plus de 4 Ko en UTF-8) : acte affiché, numéro conforme", async ({
    page,
  }) => {
    expect(Buffer.byteLength(canonical(EMOJI_AT_BOUNDS))).toBeGreaterThan(4096);
    await openDeed(page, hashOf(EMOJI_AT_BOUNDS));
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(EMOJI_AT_BOUNDS)));
    await expect(clause(page, "Objet du pari")).toContainText(EMOJI_AT_BOUNDS.o);
    await expect(clause(page, "Articles").getByRole("listitem")).toHaveCount(5);
  });

  test("CA-1 · acte d'emoji aux bornes tapé dans le formulaire : scellé, relu à l'identique après rechargement", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillDraft(page, {
      p: EMOJI_AT_BOUNDS.p,
      c: EMOJI_AT_BOUNDS.c,
      o: EMOJI_AT_BOUNDS.o,
      e: EMOJI_AT_BOUNDS.e,
    });
    await page.getByRole("button", { name: "Ajouter un article" }).click();
    await page.getByRole("button", { name: "Ajouter un article" }).click();
    for (const [index, text] of EMOJI_AT_BOUNDS.a.entries()) {
      await field(page, `Article ${index + 1}`).fill(text);
    }
    await sealButton(page).click();
    await expect(deedNumber(page)).toBeVisible();
    const sealed = decodeHash(currentHash(page));
    expect({ ...sealed, d: 0, t: 0 }).toEqual({ ...EMOJI_AT_BOUNDS, d: 0, t: 0 });
    const number = normalizeSpaces((await deedNumber(page).textContent()) ?? "");
    expect(number).toBe(expectedNumber(sealed));
    await page.reload();
    await expect(deedNumber(page)).toHaveText(exactText(number));
  });

  for (const size of [
    { width: 360, height: 780 },
    { width: 1280, height: 720 },
  ]) {
    test(`CA-11 · acte d'emoji aux bornes à ${size.width} px : rien de coupé ni de recouvert`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "tailles imposées par le test");
      await page.setViewportSize(size);
      await openDeed(page, hashOf(EMOJI_AT_BOUNDS, ".n"));
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      expect(await deedArticle(page).evaluate(layoutProblems)).toEqual([]);
    });
  }
});

/** Idéogrammes tous différents (lien long, bornes respectées). Même suite que les tests unitaires. */
function distinctIdeographs() {
  let bmpNext = 1;
  let astralNext = 1;
  return {
    bmp: (length: number) =>
      Array.from({ length }, () =>
        String.fromCodePoint(0x4e00 + ((bmpNext++ * 7919) % 20_000)),
      ).join(""),
    astral: (length: number) =>
      Array.from({ length }, () =>
        String.fromCodePoint(0x20000 + ((astralNext++ * 7919) % 40_000)),
      ).join(""),
  };
}

test.describe("Tour 2 · CA-1 · acte trop long pour tenir dans un lien", () => {
  /** Bornes respectées, lien > 4 Ko ; l'article 2 (hors plan de base) est de loin le plus lourd. */
  async function fillHeavy(page: Page) {
    const gen = distinctIdeographs();
    await fillDraft(page, { p: gen.bmp(40), c: gen.bmp(40), o: gen.bmp(200), e: gen.bmp(120) });
    await page.getByRole("button", { name: "Ajouter un article" }).click();
    await field(page, "Article 1").fill(gen.bmp(160));
    await field(page, "Article 2").fill(gen.astral(160));
    await field(page, "Article 3").fill(gen.bmp(150));
    await field(page, "Article 4").fill(gen.bmp(100));
  }

  test("CL-9 · CA-1 · erreur reliée à l'article 2 (le texte le plus lourd) par aria-describedby, focus dessus, résumé, pas de hash", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillHeavy(page);
    await sealButton(page).click();

    const heavy = field(page, "Article 2");
    await expect(heavy).toBeFocused();
    await expect(heavy).toHaveAttribute("aria-invalid", "true");
    expect(await describedErrors(heavy)).toMatch(/lien/u);
    for (const label of [
      "Le parieur",
      "Le contre-parieur",
      "Objet du pari",
      "Enjeu",
      "Article 1",
      "Article 3",
      "Article 4",
      "Échéance du pari",
    ]) {
      await expect(field(page, label), label).not.toHaveAttribute("aria-invalid", "true");
    }
    await expect(
      page.getByText(
        exactText("Acte trop long pour tenir dans un lien : raccourcissez le texte signalé."),
      ),
    ).toBeVisible();
    expect(currentHash(page)).toBe("");
    await expectAxeClean(page);
  });

  test("CA-1 · raccourcir le seul texte signalé suffit : l'acte se scelle et se recharge", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillHeavy(page);
    await sealButton(page).click();
    await expect(field(page, "Article 2")).toBeFocused();
    await field(page, "Article 2").fill("Court.");
    await expect(page.getByText(/Acte trop long/u)).toHaveCount(0);
    await sealButton(page).click();
    await expect(deedNumber(page)).toBeVisible();
    const hash = currentHash(page);
    expect(hash.length).toBeLessThanOrEqual(4097);
    await page.reload();
    await expect(deedNumber(page)).toHaveText(exactText(expectedNumber(decodeHash(hash))));
  });
});

test.describe("Tour 2 · échéance à une heure qui n'existe pas", () => {
  test("Échéance · Paris, 28 mars 2027 à 02:30 (heure sautée) : erreur sur l'échéance, focus, pas de hash", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillDraft(page, {
      p: "Théo",
      c: "Inès",
      o: "Kevin sera en retard.",
      e: "Un kebab.",
      deadline: "2027-03-28T02:30",
    });
    await sealButton(page).click();
    const control = field(page, "Échéance du pari");
    await expect(control).toBeFocused();
    await expect(control).toHaveAttribute("aria-invalid", "true");
    const message = await describedErrors(control);
    expect(message).toMatch(/heure/u);
    expect(message).not.toMatch(/passée/u);
    expect(currentHash(page)).toBe("");
    await expectAxeClean(page);
    await expectFrenchTypography(page);
  });

  test("Échéance · Paris, 25 octobre 2026 à 02:30 (heure qui existe deux fois) : acceptée, affichée à 02:30", async ({
    page,
  }) => {
    await openAt(page, "");
    await fillDraft(page, {
      p: "Théo",
      c: "Inès",
      o: "Kevin sera en retard.",
      e: "Un kebab.",
      deadline: "2026-10-25T02:30",
    });
    await sealButton(page).click();
    await expect(deedNumber(page)).toBeVisible();
    await expect(clause(page, "Échéance du pari")).toContainText("25 octobre 2026 à 02:30");
  });

  test.describe("à New York", () => {
    test.use({ timezoneId: "America/New_York" });
    test("Échéance · New York, 14 mars 2027 à 02:30 refusée ; 28 mars 2027 à 02:30 acceptée (fuseau de l'appareil)", async ({
      page,
    }) => {
      await openAt(page, "");
      await fillDraft(page, {
        p: "Théo",
        c: "Inès",
        o: "Kevin sera en retard.",
        e: "Un kebab.",
        deadline: "2027-03-14T02:30",
      });
      await sealButton(page).click();
      await expect(field(page, "Échéance du pari")).toHaveAttribute("aria-invalid", "true");
      expect(currentHash(page)).toBe("");
      await field(page, "Échéance du pari").fill("2027-03-28T02:30");
      await sealButton(page).click();
      await expect(deedNumber(page)).toBeVisible();
      expect(decodeHash(currentHash(page)).d).toBe(Date.UTC(2027, 2, 28, 6, 30));
    });
  });

  test.describe("à Tokyo", () => {
    test.use({ timezoneId: "Asia/Tokyo" });
    test("Échéance · Tokyo (pas d'heure d'été), 28 mars 2027 à 02:30 : acceptée", async ({
      page,
    }) => {
      await openAt(page, "");
      await fillDraft(page, {
        p: "Théo",
        c: "Inès",
        o: "Kevin sera en retard.",
        e: "Un kebab.",
        deadline: "2027-03-28T02:30",
      });
      await sealButton(page).click();
      await expect(deedNumber(page)).toBeVisible();
      expect(decodeHash(currentHash(page)).d).toBe(Date.UTC(2027, 2, 27, 17, 30));
    });
  });
});

test.describe("Tour 2 · écrans de refus : un seul bouton pour recommencer", () => {
  function newDeedButtons(page: Page): Locator {
    return page.getByRole("button", { name: /nouvel acte/iu });
  }

  const REFUSED = [
    ["lien abîmé", "#1.!!!", "Acte illisible"],
    ["clé inconnue", hashOf(JSON.stringify({ ...BASE, x: 1 })), "Acte illisible"],
    ["hash de plus de 4 Ko", `#1.${"A".repeat(4100)}`, "Acte illisible"],
    ["version inconnue", "#2.xxx", "Acte d'une version inconnue"],
  ] as const;
  for (const [label, hash, title] of REFUSED) {
    test(`Écrans · ${label} : « Nouvel acte » absent, seul « Rédiger un nouvel acte » reste`, async ({
      page,
    }) => {
      await openAt(page, hash);
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(newDeedButtons(page)).toHaveCount(1);
      await expect(newDeedButtons(page)).toHaveAccessibleName("Rédiger un nouvel acte");
      await expect(page.getByRole("button", { name: "Nouvel acte", exact: true })).toHaveCount(0);
    });
  }

  test("Écrans · acte → lien abîmé (hashchange) : « Nouvel acte » disparaît ; retour à l'acte : il revient", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE));
    await expect(page.getByRole("button", { name: "Nouvel acte", exact: true })).toBeVisible();
    await setHash(page, "#1.!!!");
    await expect(unreadableHeading(page)).toBeVisible();
    await expect(newDeedButtons(page)).toHaveCount(1);
    await setHash(page, hashOf(BASE));
    await expect(deedNumber(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Nouvel acte", exact: true })).toBeVisible();
  });

  test("Écrans · Rédaction : pas de « Nouvel acte » (on y est déjà)", async ({ page }) => {
    await openAt(page, "");
    await expect(draftHeading(page)).toBeVisible();
    await expect(newDeedButtons(page)).toHaveCount(0);
  });
});

test.describe("Tour 2 · axe à 360 px sur les nouveaux écrans", () => {
  const NEW_SCREENS: [string, (page: Page) => Promise<void>][] = [
    [
      "Rédaction, heure inexistante",
      async (page) => {
        await openAt(page, "");
        await fillDraft(page, {
          p: "Théo",
          c: "Inès",
          o: "Kevin.",
          e: "Kebab.",
          deadline: "2027-03-28T02:30",
        });
        await sealButton(page).click();
        await expect(field(page, "Échéance du pari")).toBeFocused();
      },
    ],
    ["Acte d'emoji aux bornes", (page) => openDeed(page, hashOf(EMOJI_AT_BOUNDS))],
    [
      "Acte jugé, match nul, non scellé",
      async (page) => {
        await withoutSubtle(page);
        await openDeed(page, hashOf(BASE, ".n"));
      },
    ],
  ];
  for (const [label, open] of NEW_SCREENS) {
    for (const width of [360, 1280]) {
      test(`axe · ${label} · ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await open(page);
        await expectAxeClean(page);
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});

test.describe("Tour 2 · Rédaction : échéance proposée à J+7, 20 h (décision du tour 1)", () => {
  for (const [label, at, expected] of [
    ["mercredi 14 octobre 2026, 10 h", NOW_MS, "2026-10-21T20:00"],
    // Le passage à l'heure d'hiver (25 octobre) tombe dans la semaine : toujours 20 h locales.
    ["mardi 20 octobre 2026, 23 h 30", Date.UTC(2026, 9, 20, 21, 30), "2026-10-27T20:00"],
  ] as const) {
    test(`Rédaction · ouvert le ${label} : échéance proposée ${expected}`, async ({ page }) => {
      await openAt(page, "", at);
      await expect(field(page, "Échéance du pari")).toHaveValue(expected);
    });
  }

  test("Rédaction · « Nouvel acte » depuis un acte : formulaire vierge, échéance à J+7 20 h, 3 articles", async ({
    page,
  }) => {
    await openDeed(page, hashOf(BASE));
    await page.getByRole("button", { name: "Nouvel acte", exact: true }).click();
    await expect(draftHeading(page)).toBeVisible();
    await expect(field(page, "Le parieur")).toHaveValue("");
    await expect(field(page, "Échéance du pari")).toHaveValue("2026-10-21T20:00");
    await expect(page.getByRole("group", { name: /Articles/u }).getByRole("textbox")).toHaveCount(
      3,
    );
    expect(currentHash(page)).toBe("");
  });
});
