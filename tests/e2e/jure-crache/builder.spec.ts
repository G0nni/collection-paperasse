// Tests e2e de Juré Craché écrits par le builder (tour 1), au moins un par CA et CL de
// specs/jure-crache.md. L'horloge est toujours contrôlée (page.clock) : aucun waitForTimeout.
// Les garde-fous communs (axe sur la page nue, CSP, étiquette) sont dans tests/e2e/*.spec.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { canonicalJson, type Deed } from "../../../apps/jure-crache/src/lib/deed";
import { DEFAULT_ARTICLES } from "../../../apps/jure-crache/src/lib/draft";
import { buildHash, compressPayload } from "../../../apps/jure-crache/src/lib/link";
import { TEXT } from "../../../apps/jure-crache/src/lib/messages";
import { WAX_PALETTE } from "../../../apps/jure-crache/src/lib/seal";
import { sanitizeText } from "../../../packages/shared/src/text";
import { DEED_NUMBER_SHAPE, expectedDeedNumber } from "../support/crockford";
import { countIgnoringSpaces, pdfPageTexts } from "../support/pdf";
import { NBSP, normalizeSpaces, perceivedTexts, typographyIssues } from "../support/text";

const BASE = "jure-crache/";
/** 14/10/2026 09:00 UTC (11:00 à Paris) : date de rédaction des actes de test. */
const T = Date.UTC(2026, 9, 14, 9, 0, 0);
/** 17/10/2026 18:00 UTC, soit 20:00 à Paris. */
const D = Date.UTC(2026, 9, 17, 18, 0, 0);
/** L'heure de l'appareil pendant les tests : une heure après la rédaction. */
const NOW = T + 3_600_000;

const DEED: Deed = {
  bettor: "Théo",
  opponent: "Sam",
  subject: "Kevin arrivera en retard à la soirée de samedi.",
  stake: "Un (1) kebab, sauce au choix du gagnant, frites incluses.",
  articles: [
    "Le retard est constaté au-delà de dix (10) minutes après l'heure convenue.",
    `Le message «${NBSP}j'suis en bas${NBSP}» ne vaut pas arrivée.`,
  ],
  deadline: D,
  draftedAt: T,
};

/** Acte le plus long possible : 40 caractères sans espace, textes au maximum (CA-11, CL-7). */
const LONGEST: Deed = {
  bettor: "Wolfeschlegelsteinhausenbergerdorffvoral",
  opponent: "MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM",
  subject: `${"Anticonstitutionnellementissimement".repeat(4)} ${"W".repeat(59)}`.slice(0, 200),
  stake: `${"Kebabfritessaucesamouraiincluse".repeat(3)} ${"m".repeat(26)}`.slice(0, 120),
  articles: Array.from({ length: 5 }, (_, index) =>
    `${index + 1} ${"Intergouvernementalisations".repeat(6)}`.slice(0, 160),
  ),
  deadline: T + 3652 * 86_400_000,
  draftedAt: T,
};

const hashOf = (deed: Deed, verdict: "p" | "c" | "n" | null = null) => buildHash(deed, verdict);
const linkOf = (deed: Deed, verdict: "p" | "c" | "n" | null = null) =>
  `${BASE}${hashOf(deed, verdict)}`;
/** Hash d'un JSON quelconque, compressé comme le ferait l'app. */
const rawLink = (json: string, suffix = "") => `${BASE}#1.${compressPayload(json)}${suffix}`;

/** Empreinte de l'acte, calculée par node:crypto (oracle indépendant de l'app). */
function fingerprintOf(deed: Deed): string {
  return createHash("sha256").update(canonicalJson(deed), "utf8").digest("hex");
}

/** Numéro attendu (spec ligne 49) : « N° AAAA- » et 128 bits de l'empreinte en base32 Crockford. */
function expectedNumber(deed: Deed): string {
  return expectedDeedNumber(fingerprintOf(deed), deed.draftedAt);
}

/** Ouvre `url` avec l'horloge figée à `atMs` (figée avant la navigation). */
async function openAt(page: Page, url: string, atMs: number = NOW) {
  await page.clock.install({ time: atMs - 1000 });
  await page.clock.pauseAt(atMs);
  await page.goto(url);
}

const deedArticle = (page: Page) => page.getByRole("article", { name: "Acte de pari" });
/** Ligne du numéro : « N° 2026-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX · enregistré le … ». */
const deedNumber = (page: Page) =>
  deedArticle(page).getByRole("paragraph").filter({ hasText: /^N°/u });
const timer = (page: Page) => page.getByRole("timer");
const draftForm = (page: Page) => page.getByRole("form", { name: "Rédiger un acte de pari" });
const sealButton = (page: Page) => page.getByRole("button", { name: "Sceller l'acte" });
const declareButton = (page: Page) => page.getByRole("button", { name: "Déclarer le vainqueur" });
const verdictDialog = (page: Page) => page.getByRole("dialog", { name: "Déclarer le vainqueur" });

/** axe attend ses propres setTimeout : l'horloge figée par openAt doit reprendre avant. */
async function expectNoAxeViolation(page: Page) {
  await page.clock.resume();
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(results.violations).toEqual([]);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("dialog", (dialog) => {
    errors.push(`dialog ${dialog.message()}`);
    void dialog.dismiss();
  });
  return errors;
}

/** Remplit le formulaire de rédaction avec un acte valide (échéance 17/10/2026 20:00, Paris). */
async function fillDraft(page: Page, values: Partial<Record<string, string>> = {}) {
  await draftForm(page)
    .getByLabel("Le parieur", { exact: true })
    .fill(values["bettor"] ?? "Théo");
  await draftForm(page)
    .getByLabel("Le contre-parieur", { exact: true })
    .fill(values["opponent"] ?? "Sam");
  await draftForm(page)
    .getByLabel("Objet du pari")
    .fill(values["subject"] ?? DEED.subject);
  await draftForm(page)
    .getByLabel("Enjeu")
    .fill(values["stake"] ?? DEED.stake);
  await draftForm(page)
    .getByLabel("Échéance du pari")
    .fill(values["deadline"] ?? "2026-10-17T20:00");
}

/** Texte rendu d'un élément, blancs normalisés (insécables comprises). */
async function textOf(locator: Locator): Promise<string> {
  return normalizeSpaces(await locator.innerText());
}

// ---------------------------------------------------------------------------------------------
// Rédaction
// ---------------------------------------------------------------------------------------------

test.describe("jure-crache · rédaction", () => {
  test("CA-1 · sans hash : écran Rédaction, champs étiquetés, bouton « Sceller l'acte »", async ({
    page,
  }) => {
    await openAt(page, BASE);
    await expect(page.getByRole("heading", { name: "Rédiger un acte de pari" })).toBeVisible();
    for (const label of ["Le parieur", "Le contre-parieur", "Objet du pari", "Enjeu"]) {
      await expect(draftForm(page).getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(draftForm(page).getByLabel("Échéance du pari")).toHaveAttribute(
      "type",
      "datetime-local",
    );
    await expect(sealButton(page)).toBeVisible();
    await expect(deedArticle(page)).toBeHidden();
    // Échéance proposée : dans 7 jours à 20 h, heure de l'appareil.
    await expect(draftForm(page).getByLabel("Échéance du pari")).toHaveValue("2026-10-21T20:00");
    expect(new URL(page.url()).hash).toBe("");
  });

  test("CA-10 · 3 articles par défaut, modifiables", async ({ page }) => {
    await openAt(page, BASE);
    const articles = page.getByRole("textbox", { name: /^Article \d$/u });
    await expect(articles).toHaveCount(3);
    await expect(articles.nth(0)).toHaveValue(/retard.*dix \(10\) minutes/u);
    await expect(articles.nth(1)).toHaveValue(
      `Le message «${NBSP}j'suis en bas${NBSP}» ne vaut pas arrivée.`,
    );
    await expect(articles.nth(2)).toHaveValue(/excuse impliquant la SNCF.*tribunal des potes/u);
    await articles.nth(1).fill("Le message « j'arrive » non plus.");
    await expect(articles.nth(1)).toHaveValue("Le message « j'arrive » non plus.");
  });

  test("CA-1 · « Sceller l'acte » met le hash et affiche l'Acte", async ({ page }) => {
    await openAt(page, BASE);
    const historyLength = await page.evaluate(() => history.length);
    await fillDraft(page);
    await sealButton(page).click();

    await expect(deedArticle(page)).toBeVisible();
    expect(new URL(page.url()).hash).toMatch(/^#1\.[A-Za-z0-9+$-]+$/u);
    await expect(deedArticle(page)).toContainText("Théo");
    await expect(deedArticle(page)).toContainText("Sam");
    await expect(deedArticle(page)).toContainText(DEED.subject);
    await expect(deedArticle(page).getByRole("listitem")).toHaveCount(3);
    await expect(deedNumber(page)).toHaveText(
      /^N°\u00a02026(?:-[0-9A-HJKMNP-TV-Z]{4}){6}-[0-9A-HJKMNP-TV-Z]{2} · /u,
    );
    await expect(page.getByRole("button", { name: "Copier le lien de l'acte" })).toBeFocused();
    expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);

    // Le même acte, reconstruit dans le test : même numéro (t = l'heure du clic).
    const sealed: Deed = { ...DEED, articles: [...DEFAULT_ARTICLES], draftedAt: NOW };
    await expect(deedNumber(page)).toContainText(expectedNumber(sealed));
  });

  test("CA-1 · erreurs reliées aux champs (aria-describedby), focus sur le premier en erreur", async ({
    page,
  }) => {
    await openAt(page, BASE);
    await sealButton(page).click();
    await expect(deedArticle(page)).toBeHidden();
    const bettor = draftForm(page).getByLabel("Le parieur", { exact: true });
    await expect(bettor).toBeFocused();
    for (const [label, message] of [
      ["Le parieur", "Indiquez qui parie."],
      ["Le contre-parieur", "Indiquez contre qui."],
      ["Objet du pari", "Dites sur quoi porte le pari."],
      ["Enjeu", "Dites ce qui est en jeu."],
    ] as const) {
      const field = draftForm(page).getByLabel(label, { exact: true });
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveAccessibleDescription(message);
    }
    await expect(page.getByText("4 champs à corriger.")).toBeVisible();

    // Le premier champ corrigé, le focus va au suivant en erreur.
    await bettor.fill("Théo");
    await expect(bettor).not.toHaveAttribute("aria-invalid", "true");
    await sealButton(page).click();
    await expect(draftForm(page).getByLabel("Le contre-parieur", { exact: true })).toBeFocused();
    expect(new URL(page.url()).hash).toBe("");
  });

  test("CA-1 · un article vide ou trop long est une erreur sur cet article", async ({ page }) => {
    await openAt(page, BASE);
    await fillDraft(page);
    const second = page.getByRole("textbox", { name: "Article 2", exact: true });
    await second.fill("   ");
    await page.getByRole("textbox", { name: "Article 3", exact: true }).fill("x".repeat(161));
    await sealButton(page).click();
    await expect(second).toBeFocused();
    await expect(second).toHaveAccessibleDescription(
      `Article vide${NBSP}: écrivez-le ou retirez-le.`,
    );
    await expect(
      page.getByRole("textbox", { name: "Article 3", exact: true }),
    ).toHaveAccessibleDescription("160 caractères au maximum.");
  });

  test("longueurs en points de code, sans maxlength : 40 emoji passent, 41 caractères non", async ({
    page,
  }) => {
    await openAt(page, BASE);
    await fillDraft(page, { bettor: "x".repeat(41) });
    const bettor = draftForm(page).getByLabel("Le parieur", { exact: true });
    expect(await bettor.getAttribute("maxlength")).toBeNull();
    await sealButton(page).click();
    await expect(bettor).toHaveAccessibleDescription("40 caractères au maximum.");
    await bettor.fill(String.fromCodePoint(0x1f600).repeat(40));
    await sealButton(page).click();
    await expect(deedArticle(page)).toBeVisible();
  });

  test("CL-9 · acte dans les bornes trop long pour un lien : erreur reliée au texte le plus lourd, focus dessus", async ({
    page,
  }) => {
    await openAt(page, BASE);
    // Des idéogrammes tous différents se compressent mal : bornes respectées, lien > 4 Ko.
    let next = 0;
    const rare = (length: number) =>
      Array.from({ length }, () => String.fromCodePoint(0x4e00 + ((next++ * 7919) % 20_000))).join(
        "",
      );
    await fillDraft(page, {
      bettor: rare(40),
      opponent: rare(40),
      subject: rare(200),
      stake: rare(120),
    });
    await page.getByRole("button", { name: "Ajouter un article" }).click();
    await page.getByRole("button", { name: "Ajouter un article" }).click();
    for (let position = 1; position <= 5; position += 1) {
      await page.getByRole("textbox", { name: `Article ${position}`, exact: true }).fill(rare(160));
    }
    await sealButton(page).click();

    const subject = draftForm(page).getByLabel("Objet du pari");
    await expect(subject).toBeFocused();
    await expect(subject).toHaveAttribute("aria-invalid", "true");
    await expect(subject).toHaveAccessibleDescription(
      `Ce texte prend trop de place dans le lien de l'acte${NBSP}: raccourcissez-le.`,
    );
    await expect(page.getByText(TEXT.linkTooLong)).toBeVisible();
    for (const label of ["Le parieur", "Le contre-parieur", "Enjeu"]) {
      await expect(draftForm(page).getByLabel(label, { exact: true })).not.toHaveAttribute(
        "aria-invalid",
      );
    }
    expect(new URL(page.url()).hash).toBe("");

    // Raccourci, l'acte tient : le message s'efface pendant la frappe, l'acte se scelle.
    await subject.fill("Court.");
    for (let position = 1; position <= 5; position += 1) {
      await page.getByRole("textbox", { name: `Article ${position}`, exact: true }).fill("Court.");
    }
    await expect(subject).not.toHaveAttribute("aria-invalid");
    await expect(page.getByText(TEXT.linkTooLong)).toBeHidden();
    await sealButton(page).click();
    await expect(deedArticle(page)).toBeVisible();
  });

  test("échéance à une heure qui n'existe pas (passage à l'heure d'été, Paris) : refusée avec un message", async ({
    page,
  }) => {
    await openAt(page, BASE);
    // Dimanche 28 mars 2027 : à Paris, les horloges passent de 1 h 59 à 3 h 00.
    await fillDraft(page, { deadline: "2027-03-28T02:30" });
    await sealButton(page).click();
    const deadline = draftForm(page).getByLabel("Échéance du pari");
    await expect(deadline).toBeFocused();
    await expect(deadline).toHaveAttribute("aria-invalid", "true");
    await expect(deadline).toHaveAccessibleDescription(
      new RegExp(`Cette heure n'existe pas sur cet appareil${NBSP}: .*heure d'été`, "u"),
    );
    expect(new URL(page.url()).hash).toBe("");
    // 3 h 00 le même jour existe : l'acte se scelle.
    await deadline.fill("2027-03-28T03:00");
    await sealButton(page).click();
    await expect(deedArticle(page)).toBeVisible();
    await expect(deedArticle(page)).toContainText("28 mars 2027 à 03:00");
  });

  test("CL-4 · « Théo » / « théo » : erreur sur le contre-parieur, rien n'est scellé", async ({
    page,
  }) => {
    await openAt(page, BASE);
    await fillDraft(page, { opponent: "théo" });
    await sealButton(page).click();
    const opponent = draftForm(page).getByLabel("Le contre-parieur", { exact: true });
    await expect(opponent).toBeFocused();
    await expect(opponent).toHaveAttribute("aria-invalid", "true");
    await expect(opponent).toHaveAccessibleDescription(
      /Le contre-parieur doit être une autre personne que le parieur/u,
    );
    expect(new URL(page.url()).hash).toBe("");
  });

  test("CL-5 · échéance déjà passée à la rédaction : erreur de formulaire", async ({ page }) => {
    await openAt(page, BASE);
    await fillDraft(page, { deadline: "2026-10-14T10:00" });
    await sealButton(page).click();
    const deadline = draftForm(page).getByLabel("Échéance du pari");
    await expect(deadline).toBeFocused();
    await expect(deadline).toHaveAttribute("aria-invalid", "true");
    await expect(deadline).toHaveAccessibleDescription(
      /Date et heure de votre appareil\. Cette échéance est déjà passée\./u,
    );
    expect(new URL(page.url()).hash).toBe("");
    // Échéance vide : erreur aussi.
    await deadline.fill("");
    await sealButton(page).click();
    await expect(deadline).toHaveAccessibleDescription(
      /Indiquez la date et l'heure de l'échéance/u,
    );
  });

  test("articles : 5 au maximum, renumérotés au retrait, 0 permis", async ({ page }) => {
    await openAt(page, BASE);
    const add = page.getByRole("button", { name: "Ajouter un article" });
    await add.click();
    await expect(page.getByRole("textbox", { name: "Article 4", exact: true })).toBeFocused();
    await add.click();
    await expect(add).toBeDisabled();
    await expect(page.getByText(/5 articles au maximum/u)).toBeVisible();

    await page.getByRole("button", { name: "Retirer l'article 1" }).click();
    await expect(page.getByRole("textbox", { name: /^Article \d$/u })).toHaveCount(4);
    await expect(page.getByRole("textbox", { name: "Article 1", exact: true })).toHaveValue(
      /^Le message/u,
    );
    await expect(page.getByRole("button", { name: "Retirer l'article 1" })).toBeFocused();
    await expect(add).toBeEnabled();

    for (let count = 4; count > 0; count -= 1) {
      await page.getByRole("button", { name: "Retirer l'article 1" }).click();
    }
    await expect(add).toBeFocused();
    await fillDraft(page);
    await sealButton(page).click();
    await expect(deedArticle(page)).toContainText(
      "Aucun article particulier. Le tribunal des potes jugera au bon sens.",
    );
  });

  test("Précédent après le scellé rend le formulaire tel qu'il était tapé", async ({ page }) => {
    await openAt(page, BASE);
    await fillDraft(page, { bettor: "Inès" });
    await sealButton(page).click();
    await expect(deedArticle(page)).toBeVisible();
    await page.goBack();
    await expect(draftForm(page).getByLabel("Le parieur", { exact: true })).toHaveValue("Inès");
    await expect(deedArticle(page)).toBeHidden();
  });

  test("« Nouvel acte » remet un formulaire vierge", async ({ page }) => {
    await openAt(page, linkOf(DEED));
    await page.getByRole("button", { name: "Nouvel acte" }).click();
    await expect(page.getByRole("heading", { name: "Rédiger un acte de pari" })).toBeFocused();
    await expect(draftForm(page).getByLabel("Le parieur", { exact: true })).toHaveValue("");
    await expect(page.getByRole("textbox", { name: /^Article \d$/u })).toHaveCount(3);
    expect(new URL(page.url()).hash).toBe("");
  });
});

// ---------------------------------------------------------------------------------------------
// Acte, numéro, compte à rebours
// ---------------------------------------------------------------------------------------------

test.describe("jure-crache · acte", () => {
  test("CA-2 · recharger ou ouvrir le lien ailleurs : même acte, même numéro", async ({
    page,
    browser,
  }) => {
    await openAt(page, linkOf(DEED));
    await expect(deedNumber(page)).toContainText(expectedNumber(DEED));
    const shown = await textOf(deedArticle(page));
    await page.reload();
    await expect(deedNumber(page)).toContainText(expectedNumber(DEED));
    expect(await textOf(deedArticle(page))).toBe(shown);

    // Un autre appareil, à Paris aussi : exactement le même écran.
    const other = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" });
    try {
      const second = await other.newPage();
      await openAt(second, linkOf(DEED));
      await expect(deedNumber(second)).toContainText(expectedNumber(DEED));
      expect(await textOf(deedArticle(second))).toBe(shown);
    } finally {
      await other.close();
    }
  });

  test("CA-2 · dans un autre fuseau : même numéro, dates à l'heure de l'appareil", async ({
    browser,
  }) => {
    const other = await browser.newContext({ locale: "fr-FR", timezoneId: "America/New_York" });
    try {
      const page = await other.newPage();
      await openAt(page, linkOf(DEED));
      await expect(deedNumber(page)).toContainText(expectedNumber(DEED));
      await expect(deedArticle(page)).toContainText(`Le 17 octobre 2026 à 14:00`);
    } finally {
      await other.close();
    }
  });

  test("CA-3 · un seul caractère modifié (payload recréé) change le numéro d'acte", async ({
    page,
  }) => {
    await openAt(page, linkOf(DEED));
    const original = expectedNumber(DEED);
    await expect(deedNumber(page)).toContainText(original);
    for (const variant of [
      { ...DEED, bettor: "Théa" },
      { ...DEED, stake: DEED.stake.replace("(1)", "(2)") },
      { ...DEED, deadline: DEED.deadline + 60_000 },
    ]) {
      await page.goto(linkOf(variant));
      const changed = expectedNumber(variant);
      expect(changed).not.toBe(original);
      await expect(deedNumber(page)).toContainText(changed);
    }
  });

  test("l'acte affiche chaque champ, enregistré le, échéance, signatures et sceau", async ({
    page,
  }) => {
    await openAt(page, linkOf(DEED));
    const article = deedArticle(page);
    await expect(article.getByRole("heading", { name: "Acte de pari" })).toBeVisible();
    await expect(article).toContainText("République des Potes");
    await expect(deedNumber(page)).toContainText("enregistré le 14 octobre 2026");
    await expect(article.getByRole("heading", { name: "Le parieur" })).toBeVisible();
    await expect(article.getByRole("listitem").first()).toHaveText(
      `Art.${NBSP}1. Le retard est constaté au-delà de dix (10) minutes après l'heure convenue.`,
    );
    await expect(article).toContainText("Le 17 octobre 2026 à 20:00");
    await expect(article.getByText("Signature du parieur", { exact: true })).toBeVisible();
    await expect(article.getByText("Signature du contre-parieur", { exact: true })).toBeVisible();
    await expect(
      article.getByRole("img", {
        name: `Sceau de cire${NBSP}: pas du tout légal mais très sérieux`,
      }),
    ).toBeVisible();
    await expect(article).toContainText("PAS DU TOUT LÉGAL · MAIS TRÈS SÉRIEUX ·");
  });

  test("signatures déterministes : même nom, même tracé ; noms différents, tracés différents", async ({
    page,
  }) => {
    const traces = () =>
      deedArticle(page)
        .locator("figure path")
        .evaluateAll((paths) => paths.map((path) => path.getAttribute("d") ?? ""));
    await openAt(page, linkOf(DEED));
    const first = await traces();
    expect(first).toHaveLength(2);
    expect(first[0]).not.toBe(first[1]);
    expect(first[0]).toMatch(/^M[\d. ]+( [MCQ][\d. ]+)+$/u);
    await page.goto(linkOf({ ...DEED, opponent: "Théo bis", subject: "Autre pari." }));
    await expect(deedArticle(page)).toContainText("Autre pari.");
    const second = await traces();
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  test("cire : data-wax vient du dernier octet de l'empreinte, et la teinte rendue est celle de la palette", async ({
    page,
  }) => {
    // La palette vit deux fois (WAX_PALETTE en TS, data-wax en CSS) : ce test les relie au rendu.
    const rgb = (hex: string) => {
      const value = Number.parseInt(hex.slice(1), 16);
      return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
    };
    const seen = new Set<number>();
    await openAt(page, linkOf(DEED));
    for (let index = 0; seen.size < WAX_PALETTE.length && index < 40; index += 1) {
      const deed = { ...DEED, bettor: `Théo ${index}` };
      const expected = Number.parseInt(fingerprintOf(deed).slice(-2), 16) % WAX_PALETTE.length;
      await page.goto(linkOf(deed));
      await expect(deedNumber(page)).toContainText(expectedNumber(deed));
      const seal = deedArticle(page).getByRole("img", { name: /Sceau de cire/u });
      await expect(seal).toHaveAttribute("data-wax", String(expected));
      const fill = await seal
        .locator("circle.wax")
        .evaluate((circle) => getComputedStyle(circle).fill);
      expect(fill, `acte ${index}, teinte ${expected}`).toBe(rgb(WAX_PALETTE[expected] ?? ""));
      seen.add(expected);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  test("CA-4 · compte à rebours jours/heures/min/sec, mis à jour chaque seconde", async ({
    page,
  }) => {
    const remaining = (3 * 86_400 + 11 * 3600 + 42 * 60 + 9) * 1000;
    await openAt(page, linkOf(DEED), D - remaining);
    const values = timer(page).locator(".stub-value");
    await expect(values).toHaveText(["03", "11", "42", "09"]);
    await expect(timer(page)).toContainText("jours");
    await expect(timer(page)).toContainText("heures");
    await expect(timer(page)).toContainText("min");
    await expect(timer(page)).toContainText("sec");
    for (const expected of ["08", "07", "06"]) {
      await page.clock.runFor(1000);
      await expect(values.nth(3)).toHaveText(expected);
    }
    await page.clock.runFor(7000);
    await expect(values).toHaveText(["03", "11", "41", "59"]);
  });

  test("CA-4 · compteur live : role=timer, aria-live=off, résumé au plus toutes les 30 s", async ({
    page,
  }) => {
    const remaining = (3 * 86_400 + 11 * 3600 + 42 * 60 + 9) * 1000;
    await openAt(page, linkOf(DEED), D - remaining);
    await expect(timer(page)).toHaveAttribute("aria-live", "off");
    await expect(timer(page)).toHaveAccessibleName(
      "Échéance dans 3 jours, 11 heures et 42 minutes.",
    );
    await page.clock.runFor(29_000);
    await expect(timer(page)).toHaveAccessibleName(
      "Échéance dans 3 jours, 11 heures et 42 minutes.",
    );
    await page.clock.runFor(1000);
    await expect(timer(page)).toHaveAccessibleName(
      "Échéance dans 3 jours, 11 heures et 41 minutes.",
    );
  });

  test("CA-4 · à l'échéance : « Échéance passée. Le tribunal des potes attend votre verdict. »", async ({
    page,
  }) => {
    await openAt(page, linkOf(DEED), D - 3000);
    await expect(timer(page).locator(".stub-value")).toHaveText(["00", "00", "00", "03"]);
    await page.clock.runFor(2000);
    await expect(timer(page).locator(".stub-value").nth(3)).toHaveText("01");
    await page.clock.runFor(1000);
    await expect(timer(page)).toBeHidden();
    const passed = page.getByText("Échéance passée. Le tribunal des potes attend votre verdict.");
    await expect(passed).toBeVisible();
    await expect(passed).toHaveAttribute("role", "status");
  });

  test("CA-4 · lien ouvert après l'échéance : message tout de suite, pas de compteur", async ({
    page,
  }) => {
    await openAt(page, linkOf(DEED), D + 86_400_000);
    await expect(
      page.getByText("Échéance passée. Le tribunal des potes attend votre verdict."),
    ).toBeVisible();
    await expect(timer(page)).toBeHidden();
  });

  test("CA-8 · pied d'acte permanent : « Acte sans aucune valeur juridique. Juré, craché. »", async ({
    page,
  }) => {
    for (const verdict of [null, "p"] as const) {
      await openAt(page, linkOf(DEED, verdict));
      await expect(
        deedArticle(page).getByText("Acte sans aucune valeur juridique. Juré, craché."),
      ).toBeVisible();
      await page.emulateMedia({ media: "print" });
      await expect(
        deedArticle(page).getByText("Acte sans aucune valeur juridique. Juré, craché."),
      ).toBeVisible();
      await page.emulateMedia({ media: "screen" });
      await page.close();
      page = await page.context().newPage();
    }
    // Le formulaire le rappelle aussi.
    await openAt(page, BASE);
    await expect(
      draftForm(page).getByText("Acte sans aucune valeur juridique. Juré, craché."),
    ).toBeVisible();
  });

  test("CA-9 · l'étiquette de collection affiche « Look 02/03 »", async ({ page }) => {
    await openAt(page, linkOf(DEED));
    const tag = page.getByRole("navigation", { name: "Collection", exact: true });
    await expect(tag).toContainText("Look 02/03", { ignoreCase: true });
    await expect(tag.getByRole("link").last()).toHaveAttribute(
      "href",
      "/collection-paperasse/sav-de-ta-vie/",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------------------------

test.describe("jure-crache · verdict", () => {
  test("CA-5 · <dialog> modal : parieur, contre-parieur, match nul ; Échap ferme sans rien changer", async ({
    page,
  }) => {
    await openAt(page, linkOf(DEED));
    const before = page.url();
    await declareButton(page).click();
    const dialog = verdictDialog(page);
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(dialog.getByRole("button", { name: "Le parieur Théo" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Le contre-parieur Sam" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Match nul" })).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(/Le verdict s'ajoute au lien de l'acte/u);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(declareButton(page)).toBeFocused();
    expect(page.url()).toBe(before);
    // « Annuler » aussi.
    await declareButton(page).click();
    await dialog.getByRole("button", { name: "Annuler" }).click();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(before);
  });

  test("CA-5 · focus piégé dans le dialogue", async ({ page }) => {
    await openAt(page, linkOf(DEED));
    await declareButton(page).click();
    await expect(verdictDialog(page)).toBeVisible();
    for (let press = 0; press < 10; press += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(
        () => document.activeElement?.closest("dialog")?.id ?? null,
      );
      expect(inside, `Tab n° ${press + 1}`).toBe("verdict-dialog");
    }
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press("Shift+Tab");
      const inside = await page.evaluate(
        () => document.activeElement?.closest("dialog")?.id ?? null,
      );
      expect(inside, `Maj+Tab n° ${press + 1}`).toBe("verdict-dialog");
    }
  });

  for (const [verdict, name] of [
    ["p", "Le parieur Théo"],
    ["c", "Le contre-parieur Sam"],
    ["n", "Match nul"],
  ] as const) {
    test(`CA-5 · « ${name} » ajoute .${verdict} au hash : écran Acte jugé, numéro inchangé`, async ({
      page,
    }) => {
      await openAt(page, linkOf(DEED));
      const number = expectedNumber(DEED);
      await declareButton(page).click();
      await verdictDialog(page).getByRole("button", { name }).click();
      await expect(verdictDialog(page)).toBeHidden();
      await expect.poll(() => new URL(page.url()).hash).toBe(hashOf(DEED, verdict));
      await expect(deedNumber(page)).toContainText(number);

      const article = deedArticle(page);
      const stamps = article.getByText(/^(VAINQUEUR|MATCH NUL)$/u);
      if (verdict === "n") {
        await expect(stamps).toHaveText(["MATCH NUL", "MATCH NUL"]);
        await expect(article).toContainText("Match nul déclaré.");
      } else {
        await expect(stamps).toHaveText(["VAINQUEUR"]);
        const winner = verdict === "p" ? "Le parieur" : "Le contre-parieur";
        const party = article.getByRole("region", { name: winner, exact: true });
        await expect(party.getByText("VAINQUEUR", { exact: true })).toBeVisible();
        await expect(article).toContainText(
          `Vainqueur déclaré${NBSP}: ${verdict === "p" ? "Théo" : "Sam"}.`,
        );
      }
      // Compte à rebours remplacé par « Verdict déclaré. Échéance du pari : … », sans date de
      // verdict ; verdict déclaratif dit honnêtement.
      await expect(timer(page)).toBeHidden();
      await expect(
        article.getByText(`Verdict déclaré. Échéance du pari${NBSP}: 17 octobre 2026.`),
      ).toBeVisible();
      await expect(article.getByText(/Jugé/u)).toHaveCount(0);
      await expect(
        article.getByText(
          "Verdict déclaré par la personne qui a envoyé ce lien. En cas de litige, le tribunal des potes statue en dernier ressort.",
        ),
      ).toBeVisible();
      await expect(page.locator("#judged")).toBeFocused();

      // Recharger : même écran jugé (CA-2).
      await page.reload();
      await expect(stamps.first()).toBeVisible();
      await expect(deedNumber(page)).toContainText(number);
    });
  }

  test("Acte jugé après l'échéance : même ligne, aucune date de verdict inventée", async ({
    page,
  }) => {
    await openAt(page, linkOf(DEED, "c"), D + 86_400_000);
    await expect(
      deedArticle(page).getByText(`Verdict déclaré. Échéance du pari${NBSP}: 17 octobre 2026.`),
    ).toBeVisible();
    await expect(page.getByText(/^Échéance passée/u)).toBeHidden();
    // Ni « Jugé le 18 octobre » (l'heure de l'appareil), ni « Jugé le 17 octobre ».
    await expect(deedArticle(page).getByText(/Jugé|18 octobre/u)).toHaveCount(0);
  });

  test("Acte jugé : « Modifier le verdict » rouvre le dialogue", async ({ page }) => {
    await openAt(page, linkOf(DEED, "p"));
    await page.getByRole("button", { name: "Modifier le verdict" }).click();
    await verdictDialog(page).getByRole("button", { name: "Match nul" }).click();
    await expect.poll(() => new URL(page.url()).hash).toBe(hashOf(DEED, "n"));
    await expect(deedArticle(page).getByText("MATCH NUL", { exact: true })).toHaveCount(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Impression et copie
// ---------------------------------------------------------------------------------------------

test.describe("jure-crache · impression et copie", () => {
  test("CA-6 · « Imprimer » ouvre l'impression du navigateur", async ({ page }) => {
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
    await openAt(page, linkOf(DEED));
    await page.getByRole("button", { name: "Imprimer" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-printed", "1");
  });

  test("CA-6 · feuille d'impression : l'acte seul, sans les boutons", async ({ page }) => {
    await openAt(page, linkOf(DEED));
    await page.emulateMedia({ media: "print" });
    await expect(deedArticle(page)).toBeVisible();
    for (const name of [
      "Copier le lien de l'acte",
      "Imprimer",
      "Déclarer le vainqueur",
      "Nouvel acte",
    ]) {
      await expect(page.getByRole("button", { name })).toBeHidden();
    }
    await expect(page.getByRole("navigation", { name: "Collection", exact: true })).toBeHidden();
    await expect(page.getByRole("heading", { name: "Juré Craché", level: 1 })).toBeHidden();
  });

  for (const [label, deed, verdict] of [
    ["acte ordinaire", DEED, null],
    ["acte le plus long, jugé", LONGEST, "n"],
    ["acte le plus long, échéance passée", LONGEST, null],
  ] as const) {
    test(`CA-6 · ${label} : une seule page A4`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "PDF : une fois suffit");
      const at = label.includes("passée") ? deed.deadline + 1000 : NOW;
      await openAt(page, linkOf(deed, verdict), at);
      await expect(deedArticle(page)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
      const pages = pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/gu) ?? [];
      expect(pages).toHaveLength(1);
    });
  }

  test("CA-7 · copie l'URL courante, confirmation annoncée à côté du bouton", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openAt(page, linkOf(DEED));
    await page.getByRole("button", { name: "Copier le lien de l'acte" }).click();
    const status = page.getByText("Lien copié.");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    expect(page.url()).toContain(hashOf(DEED));
    // Hors de l'acte : jamais par-dessus.
    const statusBox = await status.boundingBox();
    const articleBox = await deedArticle(page).boundingBox();
    if (statusBox === null || articleBox === null) throw new Error("boîtes");
    expect(statusBox.y).toBeGreaterThanOrEqual(articleBox.y + articleBox.height);
  });

  test("CA-7 · la confirmation s'efface quand le lien change (verdict déclaré)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openAt(page, linkOf(DEED));
    await page.getByRole("button", { name: "Copier le lien de l'acte" }).click();
    await expect(page.getByText("Lien copié.")).toBeVisible();
    await declareButton(page).click();
    await verdictDialog(page).getByRole("button", { name: "Match nul" }).click();
    await expect(page.getByText("Lien copié.")).toBeHidden();
    await page.getByRole("button", { name: "Copier le lien de l'acte" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(".n");
  });

  test("CA-7 · presse-papiers refusé : <dialog> modal, champ sélectionné", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("refusé")) },
      });
    });
    await openAt(page, linkOf(DEED));
    await page.getByRole("button", { name: "Copier le lien de l'acte" }).click();
    const dialog = page.getByRole("dialog", { name: "Copiez le lien à la main" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(dialog).toHaveAccessibleDescription(/Le navigateur refuse la copie/u);
    const field = page.getByLabel("Lien à copier");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(page.url());
    const selection = await field.evaluate((element) =>
      element instanceof HTMLInputElement ? [element.selectionStart, element.selectionEnd] : [],
    );
    expect(selection).toEqual([0, page.url().length]);
    await expectNoAxeViolation(page);
  });

  for (const how of ["Fermer", "Échap"] as const) {
    test(`CA-7 · repli de copie : ${how} referme et rend le focus au bouton`, async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
      });
      await openAt(page, linkOf(DEED));
      const copy = page.getByRole("button", { name: "Copier le lien de l'acte" });
      await copy.click();
      const dialog = page.getByRole("dialog", { name: "Copiez le lien à la main" });
      await expect(dialog).toBeVisible();
      if (how === "Fermer") await dialog.getByRole("button", { name: "Fermer" }).click();
      else await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(copy).toBeFocused();
    });
  }

  test("CA-7 · repli de copie : Tab et Maj+Tab bouclent dans le dialogue (copieur partagé)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    await openAt(page, linkOf(DEED));
    await page.getByRole("button", { name: "Copier le lien de l'acte" }).click();
    const dialog = page.getByRole("dialog", { name: "Copiez le lien à la main" });
    const field = page.getByLabel("Lien à copier");
    const close = dialog.getByRole("button", { name: "Fermer" });
    await expect(field).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    // Après le dernier élément, retour au premier (et non vers la barre d'adresse).
    await page.keyboard.press("Tab");
    await expect(field).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press(press % 2 === 0 ? "Tab" : "Shift+Tab");
      const inside = await page.evaluate(
        () => document.activeElement?.closest("dialog")?.id ?? null,
      );
      expect(inside, `touche n° ${press + 1}`).toBe("copy-dialog");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// CA-6 · une page A4 par construction (tour 2)
// ---------------------------------------------------------------------------------------------

/** Largeur imprimable d'une A4 aux marges de @page (210 − 2 × 10 mm), en px CSS. */
const A4_PRINT_WIDTH = Math.floor(((210 - 20) / 25.4) * 96);

const CJK = "契約書証人印鑑署名期限賭事裁判友達遅刻言訳鉄道";
const cjk = (length: number, seed: number) =>
  Array.from({ length }, (_, index) => CJK[(index * 5 + seed) % CJK.length] ?? "契").join("");

/** Actes légitimes les plus larges : prose (LONGEST), « W » sans espace, idéogrammes. */
const LEGIT_AT_BOUNDS: readonly (readonly [string, Deed])[] = [
  ["prose aux bornes", LONGEST],
  [
    "« W » sans espace aux bornes",
    {
      ...LONGEST,
      bettor: "W".repeat(40),
      opponent: "M".repeat(40),
      subject: "W".repeat(200),
      stake: "M".repeat(120),
      articles: Array.from({ length: 5 }, () => "W".repeat(160)),
    },
  ],
  [
    "idéogrammes aux bornes",
    {
      ...LONGEST,
      bettor: cjk(40, 1),
      opponent: cjk(40, 2),
      subject: cjk(200, 3),
      stake: cjk(120, 4),
      articles: [5, 6, 7, 8, 9].map((seed) => cjk(160, seed)),
    },
  ],
];

/** U+FDFD répété aux bornes : le lien le plus « large » qu'accepte le schéma (forgé). */
const WIDE = String.fromCodePoint(0xfdfd);
const FORGED_WIDE: Deed = {
  ...LONGEST,
  bettor: WIDE.repeat(40),
  opponent: `x${WIDE.repeat(39)}`,
  subject: WIDE.repeat(200),
  stake: WIDE.repeat(120),
  articles: Array.from({ length: 5 }, () => WIDE.repeat(160)),
};

/** Textes libres coupés par leur plafond d'impression ; vide si tout est lisible en entier. */
function clippedFreeTexts(): string[] {
  const texts = [...document.querySelectorAll("#deed .free-text, #deed .article-list li")].filter(
    (element) => element.getClientRects().length > 0,
  );
  if (texts.length < 9) return [`seulement ${texts.length} textes libres trouvés`];
  return texts.flatMap((element) => {
    const label = `${element.id || "article"} (${(element.textContent ?? "").slice(0, 12)})`;
    const problems: string[] = [];
    if (getComputedStyle(element).maxHeight === "none") problems.push(`${label} sans plafond`);
    // scrollHeight et clientHeight sont arrondis au pixel : une vraie coupure dépasse d'une ligne.
    if (element.scrollHeight > element.clientHeight + 1) {
      problems.push(`${label} coupé : ${element.scrollHeight} > ${element.clientHeight}`);
    }
    if (element.scrollWidth > element.clientWidth + 1) {
      problems.push(`${label} déborde : ${element.scrollWidth} > ${element.clientWidth}`);
    }
    return problems;
  });
}

/** Pages du PDF A4 de la page courante (taille et marges de @page). */
async function printPdf(page: Page): Promise<Buffer> {
  await page.evaluate(() => document.fonts.ready);
  return page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
}

function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/gu) ?? []).length;
}

/** Ajoute une feuille de style à la page (CSSOM : la CSP n'a rien à autoriser). */
async function addSheet(page: Page, css: string) {
  await page.evaluate((text) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, css);
}

test.describe("jure-crache · CA-6 · une page A4 par construction", () => {
  for (const [label, deed] of LEGIT_AT_BOUNDS) {
    for (const verdict of [null, "p", "n"] as const) {
      test(`CA-6 · ${label}${verdict ? `, jugé (${verdict})` : ""} : aucun texte libre coupé à l'impression`, async ({
        page,
      }, testInfo) => {
        test.skip(testInfo.project.name !== "desktop", "largeur A4 fixée par le test");
        await page.setViewportSize({ width: A4_PRINT_WIDTH, height: 1100 });
        await openAt(page, linkOf(deed, verdict));
        await expect(deedNumber(page)).toContainText(expectedNumber(deed));
        await page.emulateMedia({ media: "print" });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(clippedFreeTexts)).toEqual([]);
        expect(pdfPageCount(await printPdf(page))).toBe(1);
      });
    }
  }

  test("CA-6 · haut de page masqué à l'impression : ni en-tête, ni messages, ni espace avant l'acte", async ({
    page,
  }) => {
    await openAt(page, `${linkOf(DEED)}.z`);
    await expect(page.getByText(/Verdict inconnu/u)).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("main > .top")).toBeHidden();
    await expect(page.getByText(/Verdict inconnu/u)).toBeHidden();
    const [mainBox, articleBox] = [
      await page.locator("main").boundingBox(),
      await deedArticle(page).boundingBox(),
    ];
    if (mainBox === null || articleBox === null) throw new Error("boîtes");
    expect(articleBox.y - mainBox.y).toBeLessThanOrEqual(1);
  });

  for (const verdict of ["p", null] as const) {
    test(`CA-6 · pire cas forgé${verdict ? `, jugé (${verdict})` : ""} : chaque texte libre rempli jusqu'à son plafond, non scellé : une page`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "le PDF ne dépend pas de la fenêtre");
      await page.addInitScript(() => {
        Object.defineProperty(Crypto.prototype, "subtle", {
          configurable: true,
          get: () => undefined,
        });
      });
      await openAt(page, linkOf(FORGED_WIDE, verdict));
      await expect(deedNumber(page)).toContainText(`N°${NBSP}NON-SCELLÉ`);
      // Hauteur maximale de chaque texte libre, atteinte d'office : l'acte le plus haut possible.
      await addSheet(
        page,
        "@media print { .free-text, .article-list li { min-height: calc(var(--print-lines) * 1lh); } }",
      );
      expect(pdfPageCount(await printPdf(page))).toBe(1);
    });
  }

  test("CA-6 · lien forgé en U+FDFD : une page, le pied d'acte imprimé dans l'acte et dans la marge", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "le PDF ne dépend pas de la fenêtre");
    await openAt(page, linkOf(FORGED_WIDE));
    await expect(deedNumber(page)).toContainText(expectedNumber(FORGED_WIDE));
    const pages = pdfPageTexts(await printPdf(page));
    expect(pages).toHaveLength(1);
    // Une fois en bas de l'acte, une fois dans la marge basse (@page) : sur chaque page.
    expect(pages.map((text) => countIgnoringSpaces(text, TEXT.footer))).toEqual([2]);
  });

  test("CA-6 · si l'acte s'étale malgré tout sur plusieurs pages, le pied est sur chacune (@page)", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "le PDF ne dépend pas de la fenêtre");
    await openAt(page, linkOf(FORGED_WIDE));
    await expect(deedNumber(page)).toContainText(expectedNumber(FORGED_WIDE));
    // On force un débordement que la feuille d'impression empêche : plafonds levés, gros corps.
    await addSheet(
      page,
      "@media print { .free-text, .article-list li { max-height: none !important; font-size: 16pt !important; } }",
    );
    const pages = pdfPageTexts(await printPdf(page));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    const counts = pages.map((text) => countIgnoringSpaces(text, TEXT.footer));
    expect(
      counts.every((count) => count >= 1),
      `pied par page : ${counts.join(", ")}`,
    ).toBe(true);
    // Le pied de l'acte n'est qu'à la fin ; tous les autres viennent de la marge de @page.
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(pages.length + 1);
  });

  test("CL-6 · à l'impression, « N° NON-SCELLÉ » est accompagné de son explication", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, "subtle", {
        configurable: true,
        get: () => undefined,
      });
    });
    await openAt(page, linkOf(DEED));
    await expect(deedNumber(page)).toContainText(`N°${NBSP}NON-SCELLÉ`);
    await page.emulateMedia({ media: "print" });
    const explanation = page.getByText(/^Numéro non scellé/u);
    await expect(explanation).toBeVisible();
    await expect(explanation).toContainText("son numéro ne prouve rien");
    const [text = ""] = pdfPageTexts(await printPdf(page));
    expect(countIgnoringSpaces(text, `N°${NBSP}NON-SCELLÉ`)).toBe(1);
    expect(countIgnoringSpaces(text, TEXT.unsealed)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Tour 3 · numéro sur 128 bits (spec ligne 49), pied en marge sur les seules pages de l'acte
// ---------------------------------------------------------------------------------------------

/**
 * Problèmes de mise en page du numéro : il doit tenir dans son bloc et dans le cadre, sans
 * défilement horizontal, et ne passer à la ligne qu'après un tiret (chaque morceau « XXXX- »
 * sur une seule ligne).
 */
function numberLayoutProblems(): string[] {
  const number = document.getElementById("deed-number");
  const block = number?.closest(".title-block");
  const frame = number?.closest(".frame");
  if (!number || !block || !frame) return ["numéro, bloc ou cadre introuvable"];
  const problems: string[] = [];
  const blockBox = block.getBoundingClientRect();
  const frameBox = frame.getBoundingClientRect();
  for (const rect of number.getClientRects()) {
    if (rect.left < blockBox.left - 0.5 || rect.right > blockBox.right + 0.5) {
      problems.push(`ligne du numéro hors de son bloc : ${rect.left}–${rect.right}`);
    }
    if (rect.left < frameBox.left || rect.right > frameBox.right) {
      problems.push("ligne du numéro hors du cadre");
    }
  }
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth) {
    problems.push(`défilement horizontal : ${root.scrollWidth} > ${root.clientWidth}`);
  }
  for (const node of number.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    if (tops.size > 1) problems.push(`« ${node.textContent ?? ""} » coupé sur ${tops.size} lignes`);
  }
  return problems;
}

test.describe("jure-crache · tour 3 · numéro sur 128 bits", () => {
  test("CA-3 · N° AAAA- et 26 caractères base32 Crockford par 4 (oracle node:crypto)", async ({
    page,
  }) => {
    await openAt(page, linkOf(DEED));
    const number = page.locator("#deed-number");
    await expect(number).toHaveText(expectedNumber(DEED));
    const shown = (await number.textContent()) ?? "";
    expect(shown).toMatch(DEED_NUMBER_SHAPE);
    // Les points de coupure sont des <wbr>, sans texte : le numéro lu et copié est entier.
    expect(await number.locator("wbr").count()).toBe(7);
  });

  for (const [label, deed] of [
    ["acte ordinaire", DEED],
    ["acte le plus long", LONGEST],
    ["lien forgé en U+FDFD", FORGED_WIDE],
  ] as const) {
    test(`CA-11 · à 360 px, le numéro tient dans l'acte sans couper un groupe (${label})`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "viewport fixé par le test");
      await page.setViewportSize({ width: 360, height: 780 });
      await openAt(page, linkOf(deed));
      await expect(page.locator("#deed-number")).toHaveText(expectedNumber(deed));
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(numberLayoutProblems)).toEqual([]);
    });
  }

  test("CA-6 · à l'impression, le numéro tient dans l'acte et figure entier dans le PDF", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "largeur A4 fixée par le test");
    await page.setViewportSize({ width: A4_PRINT_WIDTH, height: 1100 });
    await openAt(page, linkOf(LONGEST, "p"));
    await expect(page.locator("#deed-number")).toHaveText(expectedNumber(LONGEST));
    await page.emulateMedia({ media: "print" });
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(numberLayoutProblems)).toEqual([]);
    const pages = pdfPageTexts(await printPdf(page));
    expect(pages).toHaveLength(1);
    expect(countIgnoringSpaces(pages[0] ?? "", expectedNumber(LONGEST))).toBe(1);
  });
});

test.describe("jure-crache · tour 3 · pied en marge sur les seules pages de l'acte", () => {
  test("CA-6 · imprimer la Rédaction : aucune page ne porte le pied d'acte", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "le PDF ne dépend pas de la fenêtre");
    await openAt(page, BASE);
    await expect(draftForm(page)).toBeVisible();
    const pages = pdfPageTexts(await printPdf(page));
    expect(pages.length).toBeGreaterThanOrEqual(1);
    expect(pages.map((text) => countIgnoringSpaces(text, TEXT.footer))).toEqual(pages.map(() => 0));
  });

  for (const [label, url] of [
    ["Acte illisible", rawLink("[]")],
    ["Acte d'une version inconnue", `${BASE}#2.xxx`],
  ] as const) {
    test(`CA-6 · imprimer un refus (${label}) : aucune page ne porte le pied d'acte`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "le PDF ne dépend pas de la fenêtre");
      await openAt(page, url);
      await expect(page.getByRole("heading", { name: label })).toBeVisible();
      const pages = pdfPageTexts(await printPdf(page));
      expect(pages.map((text) => countIgnoringSpaces(text, TEXT.footer))).toEqual(
        pages.map(() => 0),
      );
    });
  }

  test("CA-6 · l'acte, lui, garde son pied deux fois : dans l'acte et dans la marge", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "le PDF ne dépend pas de la fenêtre");
    await openAt(page, linkOf(DEED));
    await expect(deedNumber(page)).toContainText(expectedNumber(DEED));
    const pages = pdfPageTexts(await printPdf(page));
    expect(pages.map((text) => countIgnoringSpaces(text, TEXT.footer))).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------------------------
// CA-11 · lisible de 360 à 1280 px
// ---------------------------------------------------------------------------------------------

/**
 * Problèmes de lisibilité de l'acte, mesurés dans la page : défilement horizontal, texte coupé
 * dans sa boîte, texte hors du cadre, texte recouvert par le sceau, une signature ou un tampon,
 * et ces derniers qui se recouvrent entre eux. Autonome : sérialisée par Playwright.
 */
function readabilityProblems(): string[] {
  const problems: string[] = [];
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth) {
    problems.push(`défilement horizontal : ${root.scrollWidth} > ${root.clientWidth}`);
  }
  const article = document.querySelector("article");
  const frame = article?.querySelector(".frame");
  if (!article || !frame) return ["acte introuvable"];
  const frameBox = frame.getBoundingClientRect();
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    // Les éléments masqués visuellement (1 × 1 px, lus par les lecteurs d'écran) ne comptent pas.
    return (
      style.display !== "none" && style.visibility !== "hidden" && box.width > 1 && box.height > 1
    );
  };
  const blocks = [...article.querySelectorAll("p, li, h2, h3, figcaption")].filter(visible);
  for (const block of blocks) {
    if (!(block instanceof HTMLElement)) continue;
    const label = (block.textContent ?? "").trim().slice(0, 30);
    if (block.scrollWidth > block.clientWidth + 1 || block.scrollHeight > block.clientHeight + 1) {
      problems.push(
        `« ${label} » coupé (${block.scrollWidth}×${block.scrollHeight} > ${block.clientWidth}×${block.clientHeight})`,
      );
    }
    const box = block.getBoundingClientRect();
    if (box.left < frameBox.left - 1 || box.right > frameBox.right + 1) {
      problems.push(`« ${label} » sort du cadre`);
    }
  }
  const obstacles = [
    ...article.querySelectorAll(".seal, .signature-trace, .stamp:not([hidden])"),
  ].filter(visible);
  const rects: { label: string; rect: DOMRect }[] = [];
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || (node.textContent ?? "").trim() === "" || !visible(parent)) continue;
    if (parent.closest("svg, .stamp, .visually-hidden")) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      rects.push({ label: (node.textContent ?? "").trim().slice(0, 30), rect });
    }
  }
  const overlap = (a: DOMRect, b: DOMRect) =>
    a.left < b.right - 0.5 &&
    a.right > b.left + 0.5 &&
    a.top < b.bottom - 0.5 &&
    a.bottom > b.top + 0.5;
  for (const obstacle of obstacles) {
    const box = obstacle.getBoundingClientRect();
    for (const { label, rect } of rects) {
      if (overlap(box, rect))
        problems.push(`${obstacle.getAttribute("class")} recouvre « ${label} »`);
    }
    for (const other of obstacles) {
      if (other !== obstacle && overlap(box, other.getBoundingClientRect())) {
        problems.push(`${obstacle.getAttribute("class")} recouvre ${other.getAttribute("class")}`);
      }
    }
    if (box.left < frameBox.left - 1 || box.right > frameBox.right + 1) {
      problems.push(`${obstacle.getAttribute("class")} sort du cadre`);
    }
  }
  return problems;
}

test.describe("jure-crache · CA-11 · lisible de 360 à 1280 px", () => {
  const sizes = [
    [360, 780],
    [640, 900],
    [768, 1024],
    [960, 600],
    [1024, 768],
    [1093, 614],
    [1280, 720],
  ] as const;
  for (const [width, height] of sizes) {
    for (const verdict of [null, "p", "n"] as const) {
      test(`CA-11 · ${width}×${height}, acte le plus long${verdict ? `, jugé (${verdict})` : ""} : rien de coupé ni de recouvert`, async ({
        page,
      }, testInfo) => {
        test.skip(testInfo.project.name !== "desktop", "viewport fixé par le test");
        await page.setViewportSize({ width, height });
        await openAt(page, linkOf(LONGEST, verdict));
        await expect(deedArticle(page)).toContainText(LONGEST.bettor);
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(readabilityProblems)).toEqual([]);
      });
    }
  }

  test("CA-11 · acte ordinaire, échéance passée, à 360 px : rien de coupé ni de recouvert", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "viewport fixé par le test");
    await page.setViewportSize({ width: 360, height: 780 });
    await openAt(page, linkOf(DEED), D + 1000);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(readabilityProblems)).toEqual([]);
  });

  test("CA-11 · textes libres nettoyés par sanitizeText (bidi, contrôles, zalgo)", async ({
    page,
  }) => {
    const rlo = String.fromCodePoint(0x202e);
    const zalgo = `Z${String.fromCodePoint(0x301).repeat(30)}oé`;
    const json = canonicalJson({
      ...DEED,
      bettor: `${rlo}Théo${String.fromCodePoint(0)}`,
      stake: zalgo,
    });
    const cleaned = sanitizeText(zalgo, { min: 1, max: 120 });
    if (!cleaned.ok) throw new Error("texte de test refusé");
    // NFC compose « Ź », puis 4 marques au plus.
    expect(cleaned.value).toBe(`Ź${String.fromCodePoint(0x301).repeat(4)}oé`.normalize("NFC"));
    await openAt(page, rawLink(json));
    await expect(deedArticle(page).getByText("Théo", { exact: true })).toBeVisible();
    await expect(deedArticle(page).getByText(cleaned.value, { exact: true })).toBeVisible();
    // Forme propre : l'adresse ne contient plus que l'acte nettoyé.
    expect(new URL(page.url()).hash).toBe(hashOf({ ...DEED, stake: cleaned.value }));
  });
});

// ---------------------------------------------------------------------------------------------
// Cas limites
// ---------------------------------------------------------------------------------------------

test.describe("jure-crache · cas limites", () => {
  test("CL-1 · « #1. » vide → Rédaction", async ({ page }) => {
    await openAt(page, `${BASE}#1.`);
    await expect(page.getByRole("heading", { name: "Rédiger un acte de pari" })).toBeVisible();
  });

  test("CL-1 · « #2.xxx » → « Acte d'une version inconnue », adresse non réécrite", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await openAt(page, `${BASE}#2.xxx`);
    await expect(page.getByRole("heading", { name: "Acte d'une version inconnue" })).toBeVisible();
    expect(new URL(page.url()).hash).toBe("#2.xxx");
    await page.getByRole("button", { name: "Rédiger un nouvel acte" }).click();
    await expect(page.getByRole("heading", { name: "Rédiger un acte de pari" })).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("CL-1 · « #1.xxx.z » → acte sans verdict, message, verdict retiré du lien", async ({
    page,
  }) => {
    await openAt(page, `${linkOf(DEED)}.z`);
    await expect(deedArticle(page)).toBeVisible();
    await expect(timer(page)).toBeVisible();
    await expect(deedArticle(page).getByText(/^(VAINQUEUR|MATCH NUL)$/u)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Verdict inconnu" })).toContainText(
      `Verdict inconnu dans le lien${NBSP}: il est ignoré.`,
    );
    expect(new URL(page.url()).hash).toBe(hashOf(DEED));
    await page.getByRole("button", { name: "Fermer les messages du lien" }).click();
    await expect(page.getByText(/Verdict inconnu/u)).toBeHidden();
    await expect(page.getByRole("heading", { name: "Acte de pari" })).toBeFocused();
  });

  for (const [label, json] of [
    ["tableau", "[]"],
    ["nombre", "42"],
    ["null", "null"],
    ["objet avec __proto__", canonicalJson(DEED).replace("{", '{"__proto__":{"polluted":"oui"},')],
    ["clé inconnue", canonicalJson(DEED).replace("{", '{"v":1,')],
    ["clé manquante", JSON.stringify({ p: "Théo", c: "Sam", o: "x", e: "y", a: [], d: D })],
    ["JSON invalide", "{p:"],
  ] as const) {
    test(`CL-2 · payload ${label} → « Acte illisible », sans erreur de page`, async ({ page }) => {
      const errors = collectErrors(page);
      await openAt(page, rawLink(json));
      await expect(page.getByRole("heading", { name: "Acte illisible" })).toBeVisible();
      await expect(deedArticle(page)).toBeHidden();
      expect(await page.evaluate(() => Object.prototype.hasOwnProperty.call({}, "polluted"))).toBe(
        false,
      );
      expect(await page.evaluate(() => "polluted" in {})).toBe(false);
      await page.getByRole("button", { name: "Rédiger un nouvel acte" }).click();
      await expect(page.getByRole("heading", { name: "Rédiger un acte de pari" })).toBeVisible();
      expect(new URL(page.url()).hash).toBe("");
      expect(errors).toEqual([]);
    });
  }

  test("écrans de refus : un seul bouton pour recommencer (« Nouvel acte » masqué)", async ({
    page,
  }) => {
    for (const [url, heading] of [
      [rawLink("[]"), "Acte illisible"],
      [`${BASE}#2.xxx`, "Acte d'une version inconnue"],
    ] as const) {
      await openAt(page, url);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByRole("button", { name: "Nouvel acte", exact: true })).toBeHidden();
      await expect(page.getByRole("button", { name: /nouvel acte/iu })).toHaveCount(1);
      await page.close();
      page = await page.context().newPage();
    }
    // Sur l'acte, « Nouvel acte » reste là.
    await openAt(page, linkOf(DEED));
    await expect(page.getByRole("button", { name: "Nouvel acte", exact: true })).toBeVisible();
  });

  test('CL-2 · lz-string qui renvoie null ou "" → « Acte illisible »', async ({ page }) => {
    for (const payload of ["xxx", "A"]) {
      await openAt(page, `${BASE}#1.${payload}`);
      await expect(page.getByRole("heading", { name: "Acte illisible" })).toBeVisible();
      await page.close();
      page = await page.context().newPage();
    }
  });

  test("hash brut de plus de 4 Ko, ou décompressé de plus de 4 Ko → « Acte illisible »", async ({
    page,
  }) => {
    await openAt(page, `${BASE}#1.${"A".repeat(4100)}`);
    await expect(page.getByRole("heading", { name: "Acte illisible" })).toBeVisible();
    await expect(page.getByText("Lien trop long (plus de 4 Ko).")).toBeVisible();
    // Une bombe de décompression : quelques centaines de caractères, 200 000 une fois décodés.
    await page.goto(`${BASE}#1.${compressPayload("a".repeat(200_000))}`);
    await expect(page.getByText("Acte trop long une fois décodé (plus de 4 Ko).")).toBeVisible();
  });

  test("CL-3 · <script>, <img onerror>, une URL : affichés tels quels, en texte, sans lien", async ({
    page,
  }) => {
    const errors = collectErrors(page);
    const script = "<script>window.pwned = 1</script>";
    const image = '<img src=x onerror="window.pwned = 2">';
    const url = "https://evil.example/arnaque";
    const deed: Deed = {
      ...DEED,
      bettor: "<b>Théo</b>",
      subject: `${script} ${image}`,
      stake: url,
      articles: [`Voir ${url}`, ["java", "script:alert(1)"].join("")],
    };
    await openAt(page, linkOf(deed));
    const article = deedArticle(page);
    await expect(article.getByText(`${script} ${image}`, { exact: true })).toBeVisible();
    await expect(article.getByText(url, { exact: true })).toBeVisible();
    await expect(article.getByText("<b>Théo</b>", { exact: true })).toBeVisible();
    await expect(article.locator("a, img, script, b")).toHaveCount(0);
    await expect(page.getByRole("link").filter({ hasText: "evil" })).toHaveCount(0);
    expect(await page.evaluate(() => "pwned" in window)).toBe(false);
    expect(errors).toEqual([]);
  });

  test("CL-4 · noms identiques arrivés par l'URL : acte refusé", async ({ page }) => {
    await openAt(page, rawLink(canonicalJson({ ...DEED, opponent: "théo" })));
    await expect(page.getByRole("heading", { name: "Acte illisible" })).toBeVisible();
    await expect(page.getByText(/portent le même nom/u)).toBeVisible();
  });

  test("CL-6 · crypto.subtle indisponible : « N° NON-SCELLÉ », bandeau, acte lisible", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.crypto, "subtle", { configurable: true, get: () => undefined });
    });
    const errors = collectErrors(page);
    await openAt(page, linkOf(DEED));
    await expect(deedNumber(page)).toContainText(`N°${NBSP}NON-SCELLÉ`);
    await expect(page.getByText(/^Numéro non scellé/u)).toBeVisible();
    await expect(deedArticle(page)).toContainText(DEED.subject);
    await expect(timer(page)).toBeVisible();
    // Le formulaire scelle toujours (le lien ne dépend pas de l'empreinte).
    await page.getByRole("button", { name: "Nouvel acte" }).click();
    await fillDraft(page);
    await sealButton(page).click();
    await expect(deedNumber(page)).toContainText(`N°${NBSP}NON-SCELLÉ`);
    expect(errors).toEqual([]);
  });

  test("CL-7 · noms de 40 caractères sans espace à 360 px : coupure propre, pas de débordement", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await openAt(page, linkOf(LONGEST, "p"));
    const name = deedArticle(page).getByText(LONGEST.bettor, { exact: true });
    await expect(name).toBeVisible();
    expect(await name.evaluate((element) => getComputedStyle(element).overflowWrap)).toBe(
      "anywhere",
    );
    const [nameBox, articleBox] = [await name.boundingBox(), await deedArticle(page).boundingBox()];
    if (nameBox === null || articleBox === null) throw new Error("boîtes");
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(articleBox.x + articleBox.width);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });

  test("CL-8 · hash modifié pendant que la page est ouverte : l'acte se recharge", async ({
    page,
  }) => {
    await openAt(page, linkOf(DEED));
    await expect(deedNumber(page)).toContainText(expectedNumber(DEED));
    const other: Deed = { ...DEED, bettor: "Lou", opponent: "Max" };
    await page.evaluate(
      (hash) => {
        location.hash = hash;
      },
      hashOf(other, "c"),
    );
    await expect(deedArticle(page)).toContainText("Lou");
    await expect(deedNumber(page)).toContainText(expectedNumber(other));
    await expect(deedArticle(page).getByText("VAINQUEUR", { exact: true })).toBeVisible();
    // Vers une version inconnue, puis vers rien du tout.
    await page.evaluate(() => {
      location.hash = "#2.abc";
    });
    await expect(page.getByRole("heading", { name: "Acte d'une version inconnue" })).toBeVisible();
    await page.evaluate(() => {
      location.hash = "";
    });
    await expect(page.getByRole("heading", { name: "Rédiger un acte de pari" })).toBeVisible();
  });

  test("CL-8 · hashchange pendant que le dialogue du verdict est ouvert : il se ferme", async ({
    page,
  }) => {
    await openAt(page, linkOf(DEED));
    await declareButton(page).click();
    await expect(verdictDialog(page)).toBeVisible();
    await page.evaluate(
      (hash) => {
        location.hash = hash;
      },
      hashOf({ ...DEED, bettor: "Lou" }),
    );
    await expect(verdictDialog(page)).toBeHidden();
    await expect(deedArticle(page)).toContainText("Lou");
    expect(new URL(page.url()).hash).toBe(hashOf({ ...DEED, bettor: "Lou" }));
  });
});

// ---------------------------------------------------------------------------------------------
// Qualité sur chaque écran
// ---------------------------------------------------------------------------------------------

test.describe("jure-crache · qualité sur chaque écran", () => {
  const screens = [
    { name: "Rédaction", url: BASE, at: NOW },
    { name: "Rédaction en erreur", url: BASE, at: NOW, submit: true },
    { name: "Acte", url: linkOf(DEED), at: NOW },
    { name: "Acte, échéance passée", url: linkOf(DEED), at: D + 1000 },
    { name: "Acte jugé", url: linkOf(DEED, "p"), at: NOW },
    { name: "Acte jugé, match nul", url: linkOf(DEED, "n"), at: D + 1000 },
    { name: "Acte, verdict inconnu", url: `${linkOf(DEED)}.z`, at: NOW },
    { name: "Acte illisible", url: rawLink("[]"), at: NOW },
    { name: "Acte d'une version inconnue", url: `${BASE}#2.xxx`, at: NOW },
  ];
  for (const screen of screens) {
    test(`${screen.name} · axe sans violation, sans défilement horizontal, sans erreur`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await openAt(page, screen.url, screen.at);
      await expect(page.locator("main")).toHaveAttribute(
        "data-screen",
        /^(draft|deed|unreadable|unknown-version)$/u,
      );
      if (screen.submit === true) await sealButton(page).click();
      await expectNoAxeViolation(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });

    test(`${screen.name} · typographie française (insécables, pas de tiret cadratin)`, async ({
      page,
    }) => {
      await openAt(page, screen.url, screen.at);
      await expect(page.locator("main")).toHaveAttribute(
        "data-screen",
        /^(draft|deed|unreadable|unknown-version)$/u,
      );
      if (screen.submit === true) await sealButton(page).click();
      const texts = await perceivedTexts(page, page.locator("body"));
      const issues = texts.flatMap(({ where, text }) =>
        typographyIssues(text).map((issue) => `${where} : ${issue}`),
      );
      expect(issues).toEqual([]);
    });
  }

  test("dialogue du verdict ouvert : axe sans violation", async ({ page }) => {
    await openAt(page, linkOf(DEED));
    await declareButton(page).click();
    await expect(verdictDialog(page)).toBeVisible();
    await expectNoAxeViolation(page);
  });

  test("boutons et champs font au moins 44 px", async ({ page }) => {
    for (const url of [BASE, linkOf(DEED)]) {
      await openAt(page, url);
      await expect(page.locator("main")).not.toHaveAttribute("data-screen", "loading");
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("main button, main input, main textarea")]
          .filter((element) => element.getBoundingClientRect().width > 0)
          .map((element) => {
            const box = element.getBoundingClientRect();
            return {
              name: element.id || (element.textContent ?? "").trim(),
              width: box.width,
              height: box.height,
            };
          })
          .filter((box) => box.width < 44 || box.height < 44),
      );
      expect(small).toEqual([]);
      await page.close();
      page = await page.context().newPage();
    }
  });

  test("prefers-reduced-motion : pas de coup de tampon animé", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openAt(page, linkOf(DEED));
    await declareButton(page).click();
    await verdictDialog(page).getByRole("button", { name: "Le parieur Théo" }).click();
    const stamp = deedArticle(page).getByText("VAINQUEUR", { exact: true });
    await expect(stamp).toBeVisible();
    expect(await stamp.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await stamp.evaluate((element) => getComputedStyle(element).animationName)).toBe(
      "stamp-in",
    );
  });
});
