// Tests du Réunion-mètre écrits par l'agent tester à partir de specs/reunion-metre.md et des
// règles de CLAUDE.md, avant lecture de l'implémentation. Les garde-fous communs (axe sur
// l'écran par défaut, requêtes tierces, tour des étiquettes, CSP) sont dans
// tests/e2e/collection.spec.ts et tests/e2e/csp.spec.ts ; ici, chaque écran et chaque lien
// forgé de la spec.
//
// Le temps est toujours contrôlé par page.clock :
// - `openFixed` : Date figée (setFixedTime), les minuteurs tournent ; le montant ne bouge pas.
// - `openTicking` : horloge installée puis mise en pause à NOW ; on avance avec runFor.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { NBSP, normalizeSpaces, perceivedTexts, typographyIssues } from "../support/text";

/** Mercredi 14 octobre 2026, 10:00 à Paris. */
const NOW_MS = Date.UTC(2026, 9, 14, 8, 0, 0);
const NOW = NOW_MS / 1000;
const DAY = 86_400;

const FIXED_VIEWPORT_PROJECT = "desktop";
/** « javascript: », écrit en deux morceaux pour ESLint (no-script-url) : c'est une charge hostile. */
const SCRIPT_SCHEME = ["java", "script:"].join("");

const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const MULTIPLIER = { A: 1, B: 1.5, C: 2 } as const;
type Rate = keyof typeof MULTIPLIER;

/** Les 5 premières suggestions (ROLES) : pré-remplissage de CA-1. */
const DEFAULT_TEAM = [
  { label: "Cheffe de projet", rate: 68 },
  { label: "Dev qui code sous la table", rate: 48 },
  { label: "Responsable « transverse »", rate: 72 },
  { label: "Celui qui a la caméra coupée", rate: 51 },
  { label: "Stagiaire qui prend les notes", rate: 6 },
];

const ROLES = [
  ...DEFAULT_TEAM,
  { label: "Quelqu'un du juridique, au cas où", rate: 80 },
  { label: "Le N+2 qui « passe juste »", rate: 95 },
  { label: "Consultant externe", rate: 120 },
  { label: "Patrick", rate: 55 },
];

/** L'équipe de l'exemple d'URL de la spec. */
const SPEC_TEAM = [
  { label: "Cheffe de projet", rate: 68 },
  { label: "Kevin du marketing", rate: 48 },
  { label: "Stagiaire", rate: 6 },
];

type Member = { label: string; rate: number };

function cost(seconds: number, team: readonly Member[], rate: Rate): number {
  return (seconds / 3600) * team.reduce((sum, member) => sum + member.rate, 0) * MULTIPLIER[rate];
}

/** Montant tel que la spec l'exige, espaces normalisées (U+00A0 / U+202F → espace). */
function euros(value: number): string {
  return normalizeSpaces(EUR.format(value));
}

function participant(member: Member): string {
  return `p=${member.rate}|${encodeURIComponent(member.label)}`;
}

type Link = {
  v?: string | null;
  t?: string;
  team?: readonly Member[];
  raw?: readonly string[];
  s?: number | string;
  e?: number | string;
  n?: string;
};

/** Construit une query à la main, pour garder la main sur l'ordre et l'encodage. */
function query({ v = "1", t = "B", team = SPEC_TEAM, raw = [], s, e, n }: Link = {}): string {
  const parts: string[] = [];
  if (v !== null) parts.push(`v=${v}`);
  parts.push(`t=${t}`);
  for (const member of team) parts.push(participant(member));
  parts.push(...raw);
  if (s !== undefined) parts.push(`s=${s}`);
  if (e !== undefined) parts.push(`e=${e}`);
  if (n !== undefined) parts.push(`n=${encodeURIComponent(n)}`);
  return parts.join("&");
}

/** Date figée : le montant affiché est celui de `at`, quel que soit le temps réel écoulé. */
async function openFixed(page: Page, search: string, at = NOW_MS) {
  await page.clock.setFixedTime(at);
  await page.goto(`reunion-metre/?${search}`);
  await page.evaluate(() => document.fonts.ready);
}

/** Horloge installée 10 s avant `at`, puis mise en pause à `at` (minuteurs déclenchés). */
async function openTicking(page: Page, search: string, at = NOW_MS) {
  await page.clock.install({ time: at - 10_000 });
  await page.goto(`reunion-metre/?${search}`);
  await page.clock.pauseAt(at);
}

/** Texte de la spec → regex tolérant aux insécables et à l'apostrophe typographique. */
function specText(text: string): RegExp {
  const escaped = text
    .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/'/gu, "['’]")
    .replace(/ /gu, "\\s+");
  return new RegExp(escaped, "u");
}

// --- Écrans ----------------------------------------------------------------------------------

function launchButton(page: Page) {
  return page.getByRole("button", { name: /Lancer le compteur/u });
}
function finishButton(page: Page) {
  return page.getByRole("button", { name: /Terminer/u });
}
function copyTicketButton(page: Page) {
  return page.getByRole("button", { name: /Copier le lien du ticket/u });
}
function newMeetingButton(page: Page) {
  return page.getByRole("button", { name: /Nouvelle réunion/u });
}

async function expectConfiguration(page: Page) {
  await expect(launchButton(page)).toBeVisible();
  await expect(finishButton(page)).toHaveCount(0);
  await expect(page.getByRole("timer")).toHaveCount(0);
}
async function expectCounter(page: Page) {
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(finishButton(page)).toBeVisible();
  await expect(launchButton(page)).toHaveCount(0);
  await expect(copyTicketButton(page)).toHaveCount(0);
}
async function expectTicket(page: Page) {
  await expect(copyTicketButton(page)).toBeVisible();
  await expect(newMeetingButton(page)).toBeVisible();
  await expect(finishButton(page)).toHaveCount(0);
}

function timer(page: Page): Locator {
  return page.getByRole("timer");
}

/**
 * Montant visible de l'afficheur, remis au format « 12,34 € » pour comparer à la spec.
 * L'afficheur écrit le symbole à part, en petit, devant les chiffres (façon taximètre).
 */
async function shownAmount(page: Page): Promise<string> {
  const text = normalizeSpaces(await timer(page).innerText());
  const digits = normalizeSpaces(text.replace("€", ""));
  return `${digits} €`;
}

/** L'afficheur : les chiffres n'ont pas de rôle (aria-hidden), le timer les porte. */
function amountLocator(page: Page): Locator {
  return timer(page);
}

/** Chiffres allumés et « 8 » fantômes (pseudo-élément ::before d'un descendant du timer). */
async function ledLayers(
  page: Page,
): Promise<{ lit: string; ghost: string; ghostHidden: boolean }> {
  return timer(page).evaluate((root) => {
    for (const element of root.querySelectorAll("*")) {
      const content = getComputedStyle(element, "::before").content;
      if (content !== "none" && content !== "normal" && content !== '""') {
        return {
          lit: element.textContent ?? "",
          ghost: content.replace(/^"|"$/gu, ""),
          ghostHidden: element.closest('[aria-hidden="true"]') !== null,
        };
      }
    }
    return { lit: "", ghost: "", ghostHidden: false };
  });
}

/** Le ticket de caisse (complémentaire nommé « Ticket de réunion »). */
function ticket(page: Page): Locator {
  return page.getByRole("complementary", { name: /Ticket/u });
}

function messages(page: Page): Locator {
  return page.getByRole("status").or(page.getByRole("alert"));
}

/** Champs « Qui » / « €/heure » et boutons « Retirer » de la liste éditable. */
function whoFields(page: Page) {
  return page
    .getByRole("combobox", { name: /^Qui/u })
    .or(page.getByRole("textbox", { name: /^Qui/u }));
}
function rateFields(page: Page) {
  return page.getByRole("spinbutton", { name: /€\s*\/\s*heure/u });
}
function removeButtons(page: Page) {
  return page.getByRole("button", { name: /^Retirer/u });
}
function addButton(page: Page) {
  return page.getByRole("button", { name: /quelqu.un qui n.a rien à faire là/u });
}

function rateRadio(page: Page, name: RegExp) {
  return page.getByRole("radio", { name });
}

function urlParams(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}

/** Dernier montant « 1 234,56 € » d'une ligne → centimes (signe compris). */
function cents(text: string): number {
  const match = /(-?)(\d{1,3}(?:\s\d{3})*),(\d{2})\s*€\s*$/u.exec(normalizeSpaces(text));
  if (match === null) throw new Error(`pas de montant en fin de « ${text} »`);
  const whole = Number((match[2] ?? "").replace(/\s/gu, ""));
  return (match[1] === "-" ? -1 : 1) * (whole * 100 + Number(match[3]));
}

/** Ancre un texte de la spec (voir specText). */
function exactText(text: string): RegExp {
  return new RegExp(`^${specText(text).source}$`, "u");
}

/** Lignes visibles du ticket : chaque paire terme/définition sur une ligne, puis les paragraphes. */
async function ticketLines(page: Page): Promise<string[]> {
  const lines = await ticket(page).evaluate((root) => {
    const visible = (element: Element) => element.checkVisibility();
    const result: string[] = [];
    for (const element of root.querySelectorAll("dt, p, h2")) {
      if (!visible(element) || !(element instanceof HTMLElement)) continue;
      if (element.nodeName === "DT") {
        const definition = element.nextElementSibling;
        const value = definition instanceof HTMLElement ? definition.innerText : "";
        result.push(`${element.innerText} ${value}`);
      } else {
        result.push(element.innerText);
      }
    }
    return result;
  });
  return lines.map((line) => normalizeSpaces(line)).filter(Boolean);
}

async function axeViolations(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe("reunion-metre · tester", () => {
  // -------------------------------------------------------------------------------------------
  // CA-1 · Écran Configuration
  // -------------------------------------------------------------------------------------------

  test("CA-1 · sans paramètre : Configuration, 5 participants pré-remplis, tarif B", async ({
    page,
  }) => {
    await openFixed(page, "");
    await expectConfiguration(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(whoFields(page)).toHaveCount(5);
    await expect(rateFields(page)).toHaveCount(5);
    await expect(removeButtons(page)).toHaveCount(5);
    for (const [index, member] of DEFAULT_TEAM.entries()) {
      await expect(whoFields(page).nth(index)).toHaveValue(exactText(member.label));
      await expect(rateFields(page).nth(index)).toHaveValue(String(member.rate));
    }
    await expect(rateRadio(page, /Sans ordre du jour/u)).toBeChecked();
    await expect(rateRadio(page, /Point rapide/u)).not.toBeChecked();
    await expect(rateRadio(page, /Aurait pu être un mail/u)).not.toBeChecked();
    // Titre optionnel, étiqueté.
    await expect(page.getByRole("textbox", { name: /titre/iu })).toHaveValue("");
    // Aucun message d'erreur sur un écran vierge.
    await expect(messages(page).filter({ hasText: /\S/u })).toHaveCount(0);
  });

  test("CA-1 · chaque champ « Qui » propose les 9 suggestions ROLES (datalist)", async ({
    page,
  }) => {
    await openFixed(page, "");
    const listId = await whoFields(page).first().getAttribute("list");
    expect(listId, "le champ Qui doit être relié à un <datalist>").toBeTruthy();
    const options = await page
      .locator(`datalist[id="${listId}"] option`)
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    expect(options.map((value) => normalizeSpaces(value))).toEqual(
      ROLES.map((role) => normalizeSpaces(role.label)),
    );
    for (const field of await whoFields(page).all()) {
      await expect(field).toHaveAttribute("list", listId ?? "");
    }
  });

  test("CA-1 · une suggestion pré-remplit le taux s'il est vide, jamais s'il est rempli", async ({
    page,
  }) => {
    await openFixed(page, "");
    await addButton(page).click();
    await expect(whoFields(page)).toHaveCount(6);
    const who = whoFields(page).nth(5);
    const rate = rateFields(page).nth(5);
    await rate.fill("");
    await who.fill("Patrick");
    await expect(rate).toHaveValue("55");

    // Taux déjà rempli : la suggestion ne l'écrase pas.
    await rate.fill("12");
    await who.fill("Consultant externe");
    await expect(rate).toHaveValue("12");
  });

  test("CA-1 · « Retirer » retire le bon participant", async ({ page }) => {
    await openFixed(page, "");
    await removeButtons(page).nth(1).click();
    await expect(whoFields(page)).toHaveCount(4);
    await expect(whoFields(page).nth(1)).toHaveValue(exactText(DEFAULT_TEAM[2]?.label ?? ""));
  });

  test("CA-1 · chaque bouton « Retirer » a un nom qui dit qui il retire", async ({ page }) => {
    await openFixed(page, "");
    const names = await removeButtons(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") ?? node.textContent ?? ""),
    );
    // Cinq boutons nommés juste « Retirer » sont indiscernables au lecteur d'écran.
    expect(new Set(names).size).toBe(5);
  });

  // -------------------------------------------------------------------------------------------
  // CA-2 · Lancer le compteur
  // -------------------------------------------------------------------------------------------

  test("CA-2 · « Lancer le compteur » met s = maintenant via replaceState et affiche le Compteur", async ({
    page,
  }) => {
    await openTicking(page, "");
    const historyBefore = await page.evaluate(() => history.length);
    await launchButton(page).click();
    await expectCounter(page);
    const params = urlParams(page);
    expect(params.get("s")).toBe(String(NOW));
    expect(params.get("v")).toBe("1");
    expect(params.get("t")).toBe("B");
    expect(params.getAll("p").map(normalizeSpaces)).toEqual(
      DEFAULT_TEAM.map((member) => `${member.rate}|${member.label}`),
    );
    expect(params.get("e")).toBeNull();
    // replaceState : pas d'entrée d'historique en plus.
    expect(await page.evaluate(() => history.length)).toBe(historyBefore);
    expect(await shownAmount(page)).toBe(euros(0));
  });

  test("CA-2 · le lien produit rouvre le même Compteur dans un autre onglet", async ({
    page,
    context,
  }) => {
    await openFixed(page, "");
    await whoFields(page).nth(0).fill("Kevin | « ops »");
    await rateFields(page).nth(0).fill("40");
    await page.getByRole("textbox", { name: /titre/iu }).fill("Point : budget ?");
    await rateRadio(page, /Aurait pu être un mail/u).check();
    await launchButton(page).click();
    await expectCounter(page);
    const link = page.url();
    const params = urlParams(page);
    expect(params.get("t")).toBe("C");
    expect(params.get("n")).toBe("Point : budget ?");
    expect(params.getAll("p")[0]).toBe("40|Kevin | « ops »");

    const other = await context.newPage();
    await other.clock.setFixedTime(NOW_MS + 60_000);
    await other.goto(link);
    await expectCounter(other);
    await expect(whoFields(other).first()).toHaveValue("Kevin | « ops »");
    await expect(other.getByText("Point : budget ?", { exact: true }).first()).toBeVisible();
    const team = [{ label: "x", rate: 40 }, ...DEFAULT_TEAM.slice(1)];
    expect(await shownAmount(other)).toBe(euros(cost(60, team, "C")));
  });

  // -------------------------------------------------------------------------------------------
  // CA-3 · Deux navigateurs, même montant
  // -------------------------------------------------------------------------------------------

  test("CA-3 · deux navigateurs sur la même URL affichent le même montant (±0,01 €)", async ({
    browser,
  }) => {
    const search = query({ s: NOW - 2537, n: "Point rapide" });
    const expected = euros(cost(2537, SPEC_TEAM, "B"));
    const amounts: string[] = [];
    for (const zone of ["Europe/Paris", "America/Los_Angeles"]) {
      const context = await browser.newContext({ timezoneId: zone, locale: "fr-FR" });
      const page = await context.newPage();
      await openFixed(page, search);
      await expectCounter(page);
      amounts.push(await shownAmount(page));
      await context.close();
    }
    expect(amounts[0]).toBe(expected);
    expect(Math.abs(cents(amounts[0] ?? "") - cents(amounts[1] ?? ""))).toBeLessThanOrEqual(1);
  });

  test("CA-3 · le montant ne dépend que de s, pas de l'heure d'ouverture de la page", async ({
    browser,
  }) => {
    const search = query({ s: NOW - 600 });
    // Le premier ouvre le lien à NOW − 5 min, le second à NOW ; à NOW, même montant.
    const first = await (await browser.newContext()).newPage();
    await first.clock.install({ time: NOW_MS - 300_000 });
    await first.goto(`reunion-metre/?${search}`);
    await first.clock.pauseAt(NOW_MS - 290_000);
    await first.clock.runFor(290_000);

    const second = await (await browser.newContext()).newPage();
    await openTicking(second, search);

    const expected = euros(cost(600, SPEC_TEAM, "B"));
    expect(await shownAmount(first)).toBe(expected);
    expect(await shownAmount(second)).toBe(expected);
  });

  // -------------------------------------------------------------------------------------------
  // CA-4 · Mise à jour chaque seconde, reduced-motion
  // -------------------------------------------------------------------------------------------

  test("CA-4 · le montant se met à jour chaque seconde", async ({ page }) => {
    // 3600 €/h × 1 = 1 € par seconde : chaque seconde se voit.
    const team = [
      { label: "Board", rate: 1000 },
      { label: "Board bis", rate: 1000 },
      { label: "Board ter", rate: 1000 },
      { label: "Patrick", rate: 600 },
    ];
    await openTicking(page, query({ t: "A", team, s: NOW - 100 }));
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(100));
    for (let second = 1; second <= 5; second += 1) {
      await page.clock.runFor(1000);
      expect(await shownAmount(page)).toBe(euros(100 + second));
    }
  });

  test("CA-4 · reduced-motion : aucune animation ni lueur, le chiffre continue", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const team = [1, 2, 3].map((index) => ({ label: `Board ${index}`, rate: 800 }));
    await openTicking(page, query({ t: "B", team, s: NOW - 100 }));
    await expectCounter(page);
    const before = await shownAmount(page);
    await page.clock.runFor(1000);
    const after = await shownAmount(page);
    expect(after).not.toBe(before);
    // Ni animation ni transition en cours, nulle part dans la page.
    const running = await page.evaluate(() =>
      document.getAnimations().map((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return `${animation.constructor.name} sur ${target?.nodeName ?? "?"}.${target instanceof Element ? target.className : ""}`;
      }),
    );
    expect(running).toEqual([]);
    // Pas de lueur (text-shadow, box-shadow, filtre) sur l'afficheur ni sur l'enseigne.
    const glows = await page.evaluate(() => {
      const found: string[] = [];
      const roots = [
        document.querySelector('[role="timer"]'),
        ...document.querySelectorAll("button"),
      ];
      for (const root of roots) {
        if (root === null) continue;
        for (const element of [root, ...root.querySelectorAll("*")]) {
          for (const pseudo of [null, "::before", "::after"]) {
            const style = getComputedStyle(element, pseudo);
            if (style.textShadow !== "none")
              found.push(`${element.nodeName}${pseudo ?? ""} text-shadow ${style.textShadow}`);
            if (style.filter !== "none" && style.filter.includes("drop-shadow"))
              found.push(`${element.nodeName}${pseudo ?? ""} filter ${style.filter}`);
            if (/rgba?\(255,\s*176,\s*0/u.test(style.boxShadow))
              found.push(`${element.nodeName}${pseudo ?? ""} box-shadow ${style.boxShadow}`);
          }
        }
      }
      return found;
    });
    expect(glows).toEqual([]);
  });

  test("CA-4 · sans reduced-motion, l'afficheur a bien une lueur (le contraste du test précédent est réel)", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openFixed(page, query({ s: NOW - 100 }));
    const glow = await amountLocator(page).evaluate((element) => {
      const shadows = [element, ...element.querySelectorAll("*")].map(
        (node) => getComputedStyle(node).textShadow,
      );
      return shadows.some((shadow) => shadow !== "none");
    });
    expect(glow).toBe(true);
  });

  // -------------------------------------------------------------------------------------------
  // CA-5 · Modifications pendant le Compteur : URL + recalcul depuis s
  // -------------------------------------------------------------------------------------------

  test("CA-5 · changer le tarif pendant le Compteur met l'URL à jour et recalcule depuis s", async ({
    page,
  }) => {
    const s = NOW - 1800;
    await openFixed(page, query({ s }));
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(cost(1800, SPEC_TEAM, "B")));
    await rateRadio(page, /Aurait pu être un mail/u).check();
    await expect.poll(() => urlParams(page).get("t")).toBe("C");
    expect(urlParams(page).get("s")).toBe(String(s));
    await expect.poll(() => shownAmount(page)).toBe(euros(cost(1800, SPEC_TEAM, "C")));
    await expectCounter(page);
  });

  test("CA-5 · ajouter, retirer, renommer, changer un taux pendant le Compteur", async ({
    page,
  }) => {
    const s = NOW - 3600;
    await openFixed(page, query({ s }));
    await expectCounter(page);

    // Renommer le 2e participant.
    await whoFields(page).nth(1).fill("Kevin du juridique");
    await whoFields(page).nth(1).press("Tab");
    await expect
      .poll(() => urlParams(page).getAll("p"))
      .toEqual(["68|Cheffe de projet", "48|Kevin du juridique", "6|Stagiaire"]);

    // Changer un taux : recalcul rétroactif.
    await rateFields(page).nth(2).fill("106");
    await rateFields(page).nth(2).press("Tab");
    const team = [
      { label: "Cheffe de projet", rate: 68 },
      { label: "Kevin du juridique", rate: 48 },
      { label: "Stagiaire", rate: 106 },
    ];
    await expect.poll(() => urlParams(page).getAll("p")[2]).toBe("106|Stagiaire");
    await expect.poll(() => shownAmount(page)).toBe(euros(cost(3600, team, "B")));

    // Ajouter.
    await addButton(page).click();
    await expect(whoFields(page)).toHaveCount(4);
    await whoFields(page).nth(3).fill("Patrick");
    await rateFields(page).nth(3).fill("55");
    await rateFields(page).nth(3).press("Tab");
    await expect.poll(() => urlParams(page).getAll("p")).toHaveLength(4);
    await expect.poll(() => urlParams(page).getAll("p")[3]).toBe("55|Patrick");
    await expect
      .poll(() => shownAmount(page))
      .toBe(euros(cost(3600, [...team, { label: "Patrick", rate: 55 }], "B")));

    // Retirer le premier.
    await removeButtons(page).first().click();
    await expect
      .poll(() => urlParams(page).getAll("p"))
      .toEqual(["48|Kevin du juridique", "106|Stagiaire", "55|Patrick"]);
    await expect
      .poll(() => shownAmount(page))
      .toBe(euros(cost(3600, [...team.slice(1), { label: "Patrick", rate: 55 }], "B")));

    expect(urlParams(page).get("s")).toBe(String(s));
    await expectCounter(page);
  });

  test("CA-5 · une modification pendant le Compteur ne crée pas d'entrée d'historique", async ({
    page,
  }) => {
    await openFixed(page, query({ s: NOW - 60 }));
    const before = await page.evaluate(() => history.length);
    await rateRadio(page, /Point rapide/u).check();
    await expect.poll(() => urlParams(page).get("t")).toBe("A");
    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  // -------------------------------------------------------------------------------------------
  // CA-6 · Terminer
  // -------------------------------------------------------------------------------------------

  test("CA-6 · « Terminer » ajoute e = maintenant, affiche le Ticket, le montant ne bouge plus", async ({
    page,
  }) => {
    const s = NOW - 1200;
    await openTicking(page, query({ s }));
    await expectCounter(page);
    await page.clock.runFor(3000);
    await finishButton(page).click();
    await expectTicket(page);
    const params = urlParams(page);
    expect(params.get("e")).toBe(String(NOW + 3));
    expect(params.get("s")).toBe(String(s));
    const frozen = euros(cost(1203, SPEC_TEAM, "B"));
    expect(await shownAmount(page)).toBe(frozen);
    await page.clock.runFor(120_000);
    expect(await shownAmount(page)).toBe(frozen);
  });

  test("CA-6 · un lien de Ticket ouvert plus tard donne le même montant figé", async ({ page }) => {
    const s = NOW - 3 * DAY;
    const e = s + 2537;
    await openFixed(page, query({ s, e, t: "C" }));
    await expectTicket(page);
    expect(await shownAmount(page)).toBe(euros(cost(2537, SPEC_TEAM, "C")));
  });

  test("CA-6 · ticket : café à 0,00 €, 4 lignes réparties, somme = total, décisions, mail", async ({
    page,
  }) => {
    const s = NOW - DAY;
    const e = s + 2537;
    await openFixed(page, query({ s, e, n: "Point rapide" }));
    await expectTicket(page);
    const lines = await ticketLines(page);
    const all = lines.join("\n");
    const total = cost(2537, SPEC_TEAM, "B");

    const coffee = lines.find((line) => /Café tiède\s×\s3\b/u.test(line));
    expect(coffee, all).toBeDefined();
    expect(cents(coffee ?? "")).toBe(0);

    const shares = [
      ["Tour de table", 0.32],
      ["Tu m'entends, là ?", 0.14],
      ["Digression sur le parking", 0.28],
      ["Récap de ce qui vient d'être dit", 0.26],
    ] as const;
    let sum = 0;
    for (const [label] of shares) {
      const line = lines.find((candidate) => specText(label).test(candidate));
      expect(line, `ligne « ${label} » dans\n${all}`).toBeDefined();
      sum += cents(line ?? "");
    }
    const totalLine = lines.find((line) => /total/iu.test(line));
    expect(totalLine, all).toBeDefined();
    expect(cents(totalLine ?? "")).toBe(Math.round(total * 100));
    expect(sum).toBe(Math.round(total * 100));
    expect(all).toMatch(specText("Décisions prises : 0"));
    expect(all).toMatch(specText("Aurait pu être un mail : PEUT-ÊTRE"));
    expect(all).toMatch(/Point rapide/u);
  });

  test("CA-6 · tarif C : « Aurait pu être un mail : OUI »", async ({ page }) => {
    await openFixed(page, query({ t: "C", s: NOW - 600, e: NOW - 60 }));
    await expectTicket(page);
    const all = (await ticketLines(page)).join("\n");
    expect(all).toMatch(specText("Aurait pu être un mail : OUI"));
    expect(all).not.toMatch(/PEUT-ÊTRE/u);
  });

  test("CA-6 · tarif A : « Aurait pu être un mail : PEUT-ÊTRE »", async ({ page }) => {
    await openFixed(page, query({ t: "A", s: NOW - 600, e: NOW - 60 }));
    await expectTicket(page);
    expect((await ticketLines(page)).join("\n")).toMatch(
      specText("Aurait pu être un mail : PEUT-ÊTRE"),
    );
  });

  // Durées choisies pour que l'arrondi naïf de chaque ligne ne tombe pas juste sur le total.
  for (const seconds of [1, 7, 13, 61, 333, 1001, 4999, 86_399, 86_400]) {
    test(`CA-6 · somme des lignes = total affiché (durée ${seconds} s)`, async ({ page }) => {
      const s = NOW - 2 * DAY;
      const team = [
        { label: "Taux premier", rate: 17 },
        { label: "Autre", rate: 3 },
      ];
      await openFixed(page, query({ t: "B", team, s, e: s + seconds }));
      await expectTicket(page);
      const lines = await ticketLines(page);
      const labels = [
        "Tour de table",
        "Tu m'entends, là ?",
        "Digression sur le parking",
        "Récap de ce qui vient d'être dit",
      ];
      let sum = 0;
      for (const label of labels) {
        const line = lines.find((candidate) => specText(label).test(candidate));
        expect(line, lines.join("\n")).toBeDefined();
        const value = cents(line ?? "");
        expect(value, `ligne négative : ${line}`).toBeGreaterThanOrEqual(0);
        sum += value;
      }
      expect(sum).toBe(cents(await shownAmount(page)));
      expect(cents(await shownAmount(page))).toBe(Math.round(cost(seconds, team, "B") * 100));
    });
  }

  // -------------------------------------------------------------------------------------------
  // CA-7 · Copier le lien
  // -------------------------------------------------------------------------------------------

  test("CA-7 · « Copier le lien du ticket » copie l'URL complète, confirmation polie", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openFixed(page, query({ s: NOW - 600, e: NOW - 60, n: "Rétro" }));
    await expectTicket(page);
    await copyTicketButton(page).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(page.url());
    expect(new URL(copied).searchParams.get("e")).toBe(String(NOW - 60));
    const confirmation = page.locator('[aria-live="polite"]').filter({ hasText: /copi/iu });
    await expect(confirmation).toBeVisible();
  });

  test("CA-7 · presse-papiers refusé : le lien s'affiche dans un champ sélectionné", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new DOMException("refusé", "NotAllowedError")),
          readText: () => Promise.reject(new DOMException("refusé", "NotAllowedError")),
        },
      });
    });
    await openFixed(page, query({ s: NOW - 600, e: NOW - 60 }));
    await copyTicketButton(page).click();
    const field = page.getByRole("textbox", { name: /lien/iu });
    await expect(field).toBeVisible();
    await expect(field).toHaveValue(page.url());
    await expect(field).toBeFocused();
    const selection = await field.evaluate((element) => {
      const input = element as HTMLInputElement;
      return [input.selectionStart, input.selectionEnd, input.value.length];
    });
    expect(selection[0]).toBe(0);
    expect(selection[1]).toBe(selection[2]);
  });

  test("CA-7 · presse-papiers absent (contexte non sécurisé) : même repli", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    await openFixed(page, query({ s: NOW - 600, e: NOW - 60 }));
    await copyTicketButton(page).click();
    const field = page.getByRole("textbox", { name: /lien/iu });
    await expect(field).toHaveValue(page.url());
    await expect(field).toBeFocused();
  });

  // -------------------------------------------------------------------------------------------
  // CA-8 · role="timer", aria-live="off", résumé au plus toutes les 30 s
  // -------------------------------------------------------------------------------------------

  test("CA-8 · compteur role=timer, aria-live=off, résumé « 247 euros et 80 centimes, 42 minutes »", async ({
    page,
  }) => {
    // 354 €/h × 42 min = 247,80 €.
    await openFixed(
      page,
      query({ t: "A", team: [{ label: "Comité", rate: 354 }], s: NOW - 42 * 60 }),
    );
    await expect(timer(page)).toHaveAttribute("aria-live", "off");
    await expect(timer(page)).toHaveAccessibleName(/247 euros et 80 centimes, 42 minutes/u);
  });

  test("CA-8 · le résumé accessible change au plus toutes les 30 s, et finit par changer", async ({
    page,
  }) => {
    await openTicking(page, query({ s: NOW - 600 }));
    const readSummary = async () => (await timer(page).getAttribute("aria-label")) ?? "";
    const changes: number[] = [];
    let previous = await readSummary();
    expect(previous).not.toBe("");
    for (let second = 1; second <= 125; second += 1) {
      await page.clock.runFor(1000);
      const current = await readSummary();
      if (current !== previous) {
        changes.push(second);
        previous = current;
      }
    }
    expect(changes.length, `changements à ${changes.join(", ")} s`).toBeGreaterThanOrEqual(3);
    for (let index = 1; index < changes.length; index += 1) {
      expect((changes[index] ?? 0) - (changes[index - 1] ?? 0)).toBeGreaterThanOrEqual(30);
    }
  });

  test("CA-8 · aucune région live ne répète le montant à chaque seconde", async ({ page }) => {
    await openTicking(page, query({ s: NOW - 600 }));
    const liveTexts = async () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"]',
          ),
        ]
          .map((node) => node.textContent ?? "")
          .join(" | "),
      );
    const seen = new Set<string>([await liveTexts()]);
    for (let second = 1; second <= 29; second += 1) {
      await page.clock.runFor(1000);
      seen.add(await liveTexts());
    }
    expect(seen.size, [...seen].join("\n")).toBeLessThanOrEqual(2);
  });

  // -------------------------------------------------------------------------------------------
  // CA-9 · « 8 » fantômes
  // -------------------------------------------------------------------------------------------

  for (const { label, seconds, team } of [
    { label: "0,00 €", seconds: 0, team: [{ label: "Bénévole", rate: 0 }] },
    { label: "quelques euros", seconds: 600, team: SPEC_TEAM },
    { label: "plus de 1 000 €", seconds: 20 * 3600, team: [{ label: "Board", rate: 1000 }] },
  ]) {
    test(`CA-9 · « 8 » fantômes du même nombre de caractères que le montant (${label})`, async ({
      page,
    }) => {
      await openFixed(page, query({ t: "A", team, s: NOW - seconds }));
      await expectCounter(page);
      const { lit: amount, ghost, ghostHidden } = await ledLayers(page);
      expect(amount).toMatch(/\d,\d\d$/u);
      expect([...ghost].length).toBe([...amount].length);
      // Chaque chiffre du montant a un « 8 » derrière lui, à la même position.
      [...amount].forEach((char, index) => {
        if (/\d/u.test(char)) expect([...ghost][index]).toBe("8");
      });
      expect(ghost).toMatch(/8/u);
      expect(ghostHidden, "les fantômes sont décoratifs").toBe(true);
    });
  }

  // -------------------------------------------------------------------------------------------
  // CA-10 · CollectionTag
  // -------------------------------------------------------------------------------------------

  for (const [screen, search] of [
    ["Configuration", ""],
    ["Compteur", query({ s: NOW - 60 })],
    ["Ticket", query({ s: NOW - 600, e: NOW - 60 })],
  ] as const) {
    test(`CA-10 · ${screen} : le CollectionTag affiche « Look 01/03 » et mène à Juré Craché`, async ({
      page,
    }) => {
      await openFixed(page, search);
      const tag = page.getByRole("navigation", { name: "Collection" });
      await expect(tag).toContainText(/LOOK 01\/03/iu);
      await expect(tag).toBeVisible();
      const next = tag.getByRole("link", { name: /Juré Craché/u });
      await expect(next).toHaveAttribute("href", "/collection-paperasse/jure-crache/");
    });
  }

  // -------------------------------------------------------------------------------------------
  // CA-11 · 1280×720 sans défilement jusqu'à 8 participants
  // -------------------------------------------------------------------------------------------

  function team(count: number, long = false): Member[] {
    return Array.from({ length: count }, (_, index) => ({
      label: long
        ? `Responsable « transverse » numéro ${String(index + 1).padStart(2, "0")}…`.slice(0, 40)
        : `Participant ${index + 1}`,
      rate: 40 + index,
    }));
  }

  /** Ce qui dépasse 720 px ou reste caché dans un cadre qui défile, dans <main> (le tag est après). */
  async function hiddenParts(page: Page) {
    return page.evaluate(() => {
      const main = document.querySelector("main");
      if (main === null) return ["pas de <main>"];
      const found: string[] = [];
      const mainBox = main.getBoundingClientRect();
      if (mainBox.bottom > window.innerHeight + 0.5) {
        found.push(`<main> finit à ${Math.round(mainBox.bottom)} px`);
      }
      for (const element of [main, ...main.querySelectorAll("*")]) {
        if (!(element instanceof HTMLElement) || !element.checkVisibility()) continue;
        const style = getComputedStyle(element);
        if (
          /(auto|scroll|hidden)/u.test(style.overflowY) &&
          // Les textes visuellement masqués (1 px, pour les lecteurs d'écran) ne comptent pas.
          element.clientHeight > 1 &&
          element.scrollHeight > element.clientHeight + 1
        ) {
          const label = element.getAttribute("aria-label") ?? element.id ?? element.nodeName;
          found.push(
            `${element.nodeName}#${label} défile : ${element.scrollHeight} > ${element.clientHeight}`,
          );
        }
      }
      return found;
    });
  }

  for (const long of [false, true]) {
    test(`CA-11 · 1280×720, 8 participants${long ? " à libellé de 40 caractères" : ""} : Compteur sans défilement vertical`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width: 1280, height: 720 });
      await openFixed(
        page,
        query({ team: team(8, long), s: NOW - 600, n: "Comité de pilotage du comité" }),
      );
      await expectCounter(page);
      // Tout l'écran Compteur est au-dessus de 720 px ; seul le CollectionTag peut dépasser.
      for (const target of [
        timer(page),
        finishButton(page),
        whoFields(page).last(),
        removeButtons(page).last(),
        rateRadio(page, /Aurait pu être un mail/u),
      ]) {
        const box = await target.boundingBox();
        expect(box, "élément invisible").not.toBeNull();
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(720);
      }
      const ticketBox = await ticket(page).boundingBox();
      expect((ticketBox?.y ?? 0) + (ticketBox?.height ?? 0)).toBeLessThanOrEqual(720);
      // Les 8 participants sont visibles sans faire défiler leur liste.
      for (const field of await whoFields(page).all()) {
        await expect(field).toBeInViewport({ ratio: 1 });
      }
      expect(await hiddenParts(page)).toEqual([]);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  }

  // Les messages de la spec (CL-2, CL-6) et ceux du lien font partie de l'écran Compteur :
  // avec 8 participants, il doit tenir quand même (CA-11).
  for (const [label, members, extra, s, expected] of [
    ["CL-6 « Réunion bénévole »", "zero", [], NOW - 600, 1],
    ["CL-2 « plus de 24 h »", "paid", [], NOW - 2 * DAY, 1],
    ["un participant illisible dans le lien", "paid", ["p=12.5|Décimal"], NOW - 600, 1],
  ] as const) {
    test(`CA-11 · 1280×720, 8 participants + ${label} : le Compteur tient sans défilement`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width: 1280, height: 720 });
      const members8 = team(8).map((member) =>
        members === "zero" ? { ...member, rate: 0 } : member,
      );
      // `t=Z` et `n=` en premier : on garde le premier paramètre (CL-7).
      const leading = extra.filter((part) => !part.startsWith("p=")).join("&");
      const search = `${leading === "" ? "" : `${leading}&`}${query({ team: members8, raw: extra.filter((part) => part.startsWith("p=")), s })}`;
      await openFixed(page, search);
      await expectCounter(page);
      await expect(page.getByRole("status").getByRole("listitem")).toHaveCount(expected);
      await expect(amountLocator(page)).toBeInViewport({ ratio: 1 });
      for (const field of await whoFields(page).all()) {
        await expect(
          field,
          "les 8 participants visibles sans faire défiler leur liste",
        ).toBeInViewport({ ratio: 1 });
      }
      expect(await hiddenParts(page)).toEqual([]);
    });
  }

  test("CA-11 · 1280×720, 12 participants : la liste défile dans son cadre, le montant reste visible", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    await openFixed(page, query({ team: team(12), s: NOW - 600 }));
    await expectCounter(page);
    await expect(timer(page)).toBeInViewport({ ratio: 1 });
    await expect(finishButton(page)).toBeInViewport({ ratio: 1 });
    // Le dernier participant est hors du cadre, mais atteignable en faisant défiler la liste.
    const last = whoFields(page).last();
    const scroller = await last.evaluate((element) => {
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/u.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
          return {
            tag: node.nodeName,
            isPage: node === document.scrollingElement || node === document.body,
          };
        }
      }
      return null;
    });
    expect(scroller, "la liste des participants doit défiler dans son propre cadre").not.toBeNull();
    expect(scroller?.isPage).toBe(false);
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expect(amountLocator(page)).toBeInViewport({ ratio: 1 });
    // La page elle-même ne défile pas pour autant.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("CA-11 · 1280×720, 30 participants : montant et « Terminer » toujours visibles", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    await openFixed(page, query({ team: team(30, true), s: NOW - 600 }));
    await expectCounter(page);
    await whoFields(page).last().scrollIntoViewIfNeeded();
    await expect(amountLocator(page)).toBeInViewport({ ratio: 1 });
    await expect(finishButton(page)).toBeInViewport({ ratio: 1 });
  });

  // -------------------------------------------------------------------------------------------
  // Paramètre v
  // -------------------------------------------------------------------------------------------

  for (const [label, v] of [
    ["absent", null],
    ["vide", ""],
    ["2", "2"],
    ["0", "0"],
    ["texte", "abc"],
    ["décimal", "1.0"],
    ["signé", "+1"],
    ["avec HTML", encodeURIComponent("<img src=x onerror=alert(1)>")],
    ["énorme", "9".repeat(400)],
  ] as const) {
    test(`v ${label} → Configuration + « Lien d'une version inconnue »`, async ({ page }) => {
      await openFixed(page, query({ v, s: NOW - 60 }));
      await expectConfiguration(page);
      await expect(page.getByText(specText("Lien d'une version inconnue"))).toBeVisible();
    });
  }

  test("CL-7 · v=1&v=2 : le premier gagne, Compteur", async ({ page }) => {
    await openFixed(page, `v=1&v=2&${query({ v: null, s: NOW - 60 })}`);
    await expectCounter(page);
  });

  test("CL-7 · v=2&v=1 : le premier gagne, version inconnue", async ({ page }) => {
    await openFixed(page, `v=2&v=1&${query({ v: null, s: NOW - 60 })}`);
    await expectConfiguration(page);
    await expect(page.getByText(specText("Lien d'une version inconnue"))).toBeVisible();
  });

  // -------------------------------------------------------------------------------------------
  // Paramètre t
  // -------------------------------------------------------------------------------------------

  for (const [label, t] of [
    ["vide", ""],
    ["minuscule", "c"],
    ["inconnu", "D"],
    ["répété dans la valeur", "CC"],
    ["avec HTML", encodeURIComponent("<b>C</b>")],
    ["emoji", encodeURIComponent("🅲")],
  ] as const) {
    test(`t ${label} → tarif A (×1)`, async ({ page }) => {
      await openFixed(page, query({ t, s: NOW - 3600 }));
      await expectCounter(page);
      expect(await shownAmount(page)).toBe(euros(cost(3600, SPEC_TEAM, "A")));
      await expect(rateRadio(page, /Point rapide/u)).toBeChecked();
    });
  }

  test("t absent → tarif A", async ({ page }) => {
    await openFixed(page, query({ s: NOW - 3600 }).replace("t=B&", ""));
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(cost(3600, SPEC_TEAM, "A")));
  });

  test("CL-7 · ?t=A&t=C → tarif A", async ({ page }) => {
    await openFixed(page, `${query({ t: "A", s: NOW - 3600 })}&t=C`);
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(cost(3600, SPEC_TEAM, "A")));
  });

  test("CL-7 · s, e et n en double : le premier gagne", async ({ page }) => {
    const s = NOW - 7200;
    await openFixed(
      page,
      `${query({ s, e: s + 3600, n: "Premier" })}&s=${NOW - 60}&e=${s + 60}&n=Second`,
    );
    await expectTicket(page);
    expect(await shownAmount(page)).toBe(euros(cost(3600, SPEC_TEAM, "B")));
    await expect(page.getByText("Premier", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Second", { exact: true })).toHaveCount(0);
  });

  // -------------------------------------------------------------------------------------------
  // Paramètre s (CL-1 et validation)
  // -------------------------------------------------------------------------------------------

  test("CL-1 · s > maintenant + 60 s → Configuration + « Cette réunion n'a pas encore commencé. Profitez-en. »", async ({
    page,
  }) => {
    await openFixed(page, query({ s: NOW + 61 }));
    await expectConfiguration(page);
    await expect(
      page.getByText(specText("Cette réunion n'a pas encore commencé. Profitez-en.")),
    ).toBeVisible();
  });

  test("CL-1 · s = maintenant + 60 s (borne incluse) → Compteur", async ({ page }) => {
    await openFixed(page, query({ s: NOW + 60 }));
    await expectCounter(page);
  });

  test("CL-1 · s dans un futur lointain → Configuration, la page ne gèle pas", async ({ page }) => {
    await openFixed(page, query({ s: "999999999999999" }));
    await expectConfiguration(page);
  });

  test("s = 2020-01-01 00:00:00 UTC (borne basse incluse) → Compteur", async ({ page }) => {
    await openFixed(page, query({ s: 1_577_836_800 }));
    await expectCounter(page);
  });

  for (const [label, s] of [
    ["vide", ""],
    ["avant 2020", "1577836799"],
    ["zéro", "0"],
    ["négatif", "-1760425200"],
    ["décimal", "1760425200.5"],
    ["exposant", "1.7e9"],
    ["hexadécimal", "0x68E00000"],
    ["avec espace", "%201760425200"],
    ["texte", "maintenant"],
    ["schéma java-script", encodeURIComponent(`${SCRIPT_SCHEME}alert(1)`)],
    ["HTML", encodeURIComponent("<img src=x onerror=alert(1)>")],
    ["chiffres arabes", encodeURIComponent("١٧٦٠٤٢٥٢٠٠")],
    ["caractère nul", "1760425200%00"],
  ] as const) {
    test(`s ${label} → Configuration`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("dialog", (dialog) => {
        errors.push(`dialog ${dialog.message()}`);
        void dialog.dismiss();
      });
      await openFixed(page, query({ s }));
      await expectConfiguration(page);
      expect(errors).toEqual([]);
    });
  }

  // -------------------------------------------------------------------------------------------
  // CL-2 · plus de 24 h sans e
  // -------------------------------------------------------------------------------------------

  test("CL-2 · durée > 24 h sans e : compteur arrêté à 24 h + « Réunion de plus de 24 h. Respirez. »", async ({
    page,
  }) => {
    await openTicking(page, query({ s: NOW - DAY - 3600 }));
    await expectCounter(page);
    const capped = euros(cost(DAY, SPEC_TEAM, "B"));
    expect(await shownAmount(page)).toBe(capped);
    await expect(page.getByText(specText("Réunion de plus de 24 h. Respirez."))).toBeVisible();
    await page.clock.runFor(5000);
    expect(await shownAmount(page)).toBe(capped);
  });

  test("CL-2 · le compteur s'arrête pile en passant les 24 h", async ({ page }) => {
    await openTicking(page, query({ s: NOW - DAY + 2 }));
    await expect(page.getByText(specText("Réunion de plus de 24 h. Respirez."))).toHaveCount(0);
    await page.clock.runFor(5000);
    expect(await shownAmount(page)).toBe(euros(cost(DAY, SPEC_TEAM, "B")));
    await expect(page.getByText(specText("Réunion de plus de 24 h. Respirez."))).toBeVisible();
  });

  test("CL-2 · s en 2020 : le montant reste celui de 24 h", async ({ page }) => {
    await openFixed(page, query({ s: 1_577_836_800 }));
    expect(await shownAmount(page)).toBe(euros(cost(DAY, SPEC_TEAM, "B")));
  });

  // -------------------------------------------------------------------------------------------
  // Paramètre e (CL-3 et bornes)
  // -------------------------------------------------------------------------------------------

  for (const [label, offset] of [
    ["e = s", 0],
    ["e < s", -1],
    ["e très antérieur à s", -DAY * 400],
    ["e > s + 86 400", DAY + 1],
  ] as const) {
    test(`CL-3 · ${label} → e ignoré, retour au Compteur`, async ({ page }) => {
      const s = NOW - 600;
      await openFixed(page, query({ s, e: s + offset }));
      await expectCounter(page);
      expect(await shownAmount(page)).toBe(euros(cost(600, SPEC_TEAM, "B")));
    });
  }

  test("e = s + 1 (borne basse) → Ticket", async ({ page }) => {
    const s = NOW - 600;
    await openFixed(page, query({ s, e: s + 1 }));
    await expectTicket(page);
  });

  test("e = s + 86 400 (borne haute incluse) → Ticket figé à 24 h", async ({ page }) => {
    const s = NOW - 3 * DAY;
    await openFixed(page, query({ s, e: s + DAY }));
    await expectTicket(page);
    expect(await shownAmount(page)).toBe(euros(cost(DAY, SPEC_TEAM, "B")));
  });

  // Spec mise à jour après le tour 1 (CL-3) : un e plus de 60 s dans le futur est ignoré, avec
  // message. Ce test attendait un Ticket quand la spec ne bornait pas e par maintenant.
  test("CL-3 · e > maintenant + 60 s (fin dans le futur) → e ignoré, Compteur + message", async ({
    page,
  }) => {
    const s = NOW - 600;
    await openFixed(page, query({ s, e: s + 3600 }));
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(cost(600, SPEC_TEAM, "B")));
    await expect(messages(page).filter({ hasText: /fin/iu })).toHaveCount(1);
  });

  test("CL-3 · e = maintenant + 60 s (borne incluse) → Ticket", async ({ page }) => {
    const s = NOW - 600;
    await openFixed(page, query({ s, e: NOW + 60 }));
    await expectTicket(page);
    expect(await shownAmount(page)).toBe(euros(cost(660, SPEC_TEAM, "B")));
  });

  for (const [label, e] of [
    ["vide", ""],
    ["décimal", `${NOW - 60}.5`],
    ["texte", "fin"],
    ["HTML", encodeURIComponent("<script>alert(1)</script>")],
  ] as const) {
    test(`e ${label} → ignoré, Compteur`, async ({ page }) => {
      await openFixed(page, query({ s: NOW - 600, e }));
      await expectCounter(page);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Paramètre p (CL-4, CL-5, CL-11, modèle de menace)
  // -------------------------------------------------------------------------------------------

  test("CL-4 · 31 participants → les 30 premiers + message", async ({ page }) => {
    const thirty = Array.from({ length: 30 }, (_, index) => ({ label: `P${index + 1}`, rate: 10 }));
    await openFixed(
      page,
      query({ t: "A", team: [...thirty, { label: "Intrus", rate: 1000 }], s: NOW - 3600 }),
    );
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(300));
    await expect(page.getByText("Intrus", { exact: true })).toHaveCount(0);
    await expect(
      page
        .getByText(/30/u)
        .filter({ hasText: /participant/iu })
        .first(),
    ).toBeVisible();
  });

  test("CL-4 · 30 participants pile : aucun message, tous comptés", async ({ page }) => {
    const thirty = Array.from({ length: 30 }, (_, index) => ({ label: `P${index + 1}`, rate: 10 }));
    await openFixed(page, query({ t: "A", team: thirty, s: NOW - 3600 }));
    expect(await shownAmount(page)).toBe(euros(300));
    await expect(messages(page).filter({ hasText: /\S/u })).toHaveCount(0);
  });

  test("CL-4 · 500 paramètres p dans 4 Ko : 30 gardés, la page répond", async ({ page }) => {
    const raw = Array.from({ length: 500 }, () => "p=1|a");
    await openFixed(page, query({ t: "A", team: [], raw, s: NOW - 3600 }));
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(30));
  });

  test("CL-4 · on ne peut pas dépasser 30 participants depuis l'interface", async ({ page }) => {
    const thirty = Array.from({ length: 30 }, (_, index) => ({ label: `P${index + 1}`, rate: 10 }));
    await openFixed(page, query({ t: "A", team: thirty, s: NOW - 3600 }));
    const add = addButton(page);
    if ((await add.count()) > 0 && (await add.isEnabled())) {
      await add.click();
    }
    await expect.poll(() => urlParams(page).getAll("p").length).toBeLessThanOrEqual(30);
  });

  for (const [label, raw] of [
    ["taux décimal", "p=12.5|Décimal"],
    ["taux négatif", "p=-5|Négatif"],
    ["taux 1e3", "p=1e3|Exposant"],
    ["taux NaN", "p=NaN|PasUnNombre"],
    ["taux vide", "p=|SansTaux"],
    ["taux > 1000", "p=1001|TropCher"],
    ["taux hexadécimal", "p=0x10|Hexa"],
    ["taux signé +", "p=%2B5|Signé"],
    ["taux avec espace", "p=%205|Espacé"],
    ["taux Infinity", "p=Infinity|Infini"],
    ["taux énorme", `p=${"9".repeat(30)}|Milliardaire`],
    ["sans |", "p=48"],
    ["sans | (texte)", "p=Kevin"],
    ["libellé vide", "p=10|"],
    ["libellé d'espaces", "p=10|%20%20%20"],
    ["libellé de caractères de contrôle", "p=10|%00%01%1F%7F"],
    ["libellé bidi seul", "p=10|%E2%80%AE%E2%81%A6"],
    ["libellé de 41 caractères", `p=10|${"K".repeat(41)}`],
    ["libellé de 41 emoji", `p=10|${encodeURIComponent("🎉".repeat(41))}`],
    ["p vide", "p="],
  ] as const) {
    test(`CL-5 · ${label} → participant ignoré`, async ({ page }) => {
      await openFixed(
        page,
        query({ t: "A", team: [{ label: "Témoin", rate: 100 }], raw: [raw], s: NOW - 3600 }),
      );
      await expectCounter(page);
      expect(await shownAmount(page)).toBe(euros(100));
      const decoded = decodeURIComponent(raw.slice(2).split("|")[1] ?? "").trim();
      if (decoded !== "" && /\p{L}/u.test(decoded)) {
        await expect(page.getByText(decoded, { exact: true })).toHaveCount(0);
      }
      await expect(whoFields(page)).toHaveCount(1);
    });
  }

  test("CL-5 · libellé de 40 caractères pile → accepté", async ({ page }) => {
    const label = "K".repeat(40);
    await openFixed(page, query({ t: "A", team: [{ label, rate: 100 }], s: NOW - 3600 }));
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(100));
    await expect(whoFields(page).first()).toHaveValue(label);
  });

  test("CL-5 · 40 emoji (40 caractères) → accepté", async ({ page }) => {
    const label = "🎉".repeat(40);
    await openFixed(page, query({ t: "A", team: [{ label, rate: 100 }], s: NOW - 3600 }));
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(100));
  });

  test("CL-5 · taux 0 et 1000 (bornes) → acceptés", async ({ page }) => {
    await openFixed(
      page,
      query({
        t: "A",
        team: [
          { label: "Zéro", rate: 0 },
          { label: "Mille", rate: 1000 },
        ],
        s: NOW - 3600,
      }),
    );
    expect(await shownAmount(page)).toBe(euros(1000));
  });

  test("CL-5 · tous les participants invalides → Configuration", async ({ page }) => {
    await openFixed(page, query({ team: [], raw: ["p=-1|A", "p=Kevin", "p=10|"], s: NOW - 60 }));
    await expectConfiguration(page);
  });

  test("CL-5 · aucun p → Configuration", async ({ page }) => {
    await openFixed(page, query({ team: [], s: NOW - 60 }));
    await expectConfiguration(page);
  });

  test("CL-5 · le séparateur est le premier | : « 48|a|b » → libellé « a|b »", async ({ page }) => {
    await openFixed(page, query({ t: "A", team: [], raw: ["p=48|a|b"], s: NOW - 3600 }));
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(48));
    await expect(whoFields(page).first()).toHaveValue("a|b");
  });

  test("CL-5 · « | » encodé %7C est équivalent", async ({ page }) => {
    await openFixed(page, query({ t: "A", team: [], raw: ["p=48%7CKevin"], s: NOW - 3600 }));
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(48));
  });

  const HOSTILE = [
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    `${SCRIPT_SCHEME}alert(1)`,
    '"><svg onload=alert(1)>',
    "{{constructor.constructor('alert(1)')()}}",
  ];

  for (const label of HOSTILE) {
    test(`CL-5 · libellé hostile « ${label} » → affiché tel quel, en texte, jamais exécuté`, async ({
      page,
    }) => {
      const dialogs: string[] = [];
      page.on("dialog", (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
      await openFixed(
        page,
        query({
          t: "A",
          team: [{ label: label.slice(0, 40), rate: 100 }],
          s: NOW - 600,
          n: label.slice(0, 60),
        }),
      );
      await expectCounter(page);
      await expect(whoFields(page).first()).toHaveValue(label.slice(0, 40));
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
      await expect(page.locator("main img, main svg[onload], main script:not([src])")).toHaveCount(
        0,
      );
      expect(dialogs).toEqual([]);
      // Jamais transformé en lien, jamais dans un href, src ou style.
      const leaks = await page.evaluate(
        (needle) => {
          const found: string[] = [];
          for (const element of document.querySelectorAll("*")) {
            for (const attribute of [
              "href",
              "src",
              "srcset",
              "style",
              "action",
              "formaction",
              "xlink:href",
            ]) {
              const value = element.getAttribute(attribute);
              if (
                value !== null &&
                (value.includes(needle) ||
                  value.includes(encodeURIComponent(needle)) ||
                  value.includes("alert"))
              ) {
                found.push(`${element.nodeName}@${attribute}=${value}`);
              }
            }
          }
          for (const link of document.querySelectorAll("a")) {
            if ((link.textContent ?? "").includes(needle)) found.push(`lien : ${link.textContent}`);
          }
          return found;
        },
        label.slice(0, 20),
      );
      expect(leaks).toEqual([]);
    });
  }

  test("Menace · libellé « Cliquez sur ce lien https://evil.example » : du texte, pas de lien", async ({
    page,
  }) => {
    const label = "Cliquez ici https://evil.example/x";
    await openFixed(page, query({ team: [{ label, rate: 10 }], s: NOW - 60 }));
    await expect(page.getByRole("link", { name: /evil/u })).toHaveCount(0);
    await expect(page.locator('a[href*="evil"]')).toHaveCount(0);
  });

  test("Menace · caractères bidi et de contrôle retirés du libellé et du titre", async ({
    page,
  }) => {
    const bidi = [
      0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
    ]
      .map((code) => String.fromCodePoint(code))
      .join("");
    const label = `Kev${bidi}in\u0000\u0007`;
    const title = `Rétro${bidi}\u0001 ${String.fromCodePoint(0x202e)}txt.exe`;
    await openFixed(page, query({ t: "A", team: [{ label, rate: 100 }], s: NOW - 600, n: title }));
    await expectCounter(page);
    await expect(page.getByText("Rétro txt.exe", { exact: true }).first()).toBeVisible();
    const body = await page.evaluate(() => document.body.textContent ?? "");
    const forbidden = [...body].filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (
        (code <= 0x1f && code !== 0x0a && code !== 0x09 && code !== 0x0d) ||
        (code >= 0x7f && code <= 0x9f) ||
        code === 0x200e ||
        code === 0x200f ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
      );
    });
    expect(forbidden.map((char) => (char.codePointAt(0) ?? 0).toString(16))).toEqual([]);
    await expect(whoFields(page).first()).toHaveValue("Kevin");
  });

  test("Menace · libellé en arabe (RTL) et emoji : accepté et affiché", async ({ page }) => {
    const arabic = "مدير المشروع";
    const emoji = `Kevin 🎉${String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)}`;
    await openFixed(
      page,
      query({
        t: "A",
        team: [
          { label: arabic, rate: 10 },
          { label: emoji, rate: 20 },
        ],
        s: NOW - 3600,
      }),
    );
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(30));
    await expect(whoFields(page).nth(0)).toHaveValue(arabic);
    await expect(whoFields(page).nth(1)).toHaveValue(emoji);
  });

  test("CL-11 · deux participants au même libellé : tous deux affichés et comptés", async ({
    page,
  }) => {
    await openFixed(
      page,
      query({
        t: "A",
        team: [
          { label: "Kevin", rate: 30 },
          { label: "Kevin", rate: 20 },
        ],
        s: NOW - 3600,
      }),
    );
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(50));
    await expect(whoFields(page)).toHaveCount(2);
    await expect(whoFields(page).nth(0)).toHaveValue("Kevin");
    await expect(whoFields(page).nth(1)).toHaveValue("Kevin");
  });

  test("CL-11 · deux Kevin sur le Ticket : deux lignes, nombre de cafés = 2", async ({ page }) => {
    await openFixed(
      page,
      query({
        t: "A",
        team: [
          { label: "Kevin", rate: 30 },
          { label: "Kevin", rate: 20 },
        ],
        s: NOW - 3600,
        e: NOW - 60,
      }),
    );
    await expectTicket(page);
    expect((await ticketLines(page)).join("\n")).toMatch(/Café tiède\s×\s2\b/u);
  });

  test("CL-11 · ajouter un 2e « Kevin » depuis l'interface : accepté", async ({ page }) => {
    await openFixed(page, query({ t: "A", team: [{ label: "Kevin", rate: 30 }], s: NOW - 3600 }));
    await addButton(page).click();
    await whoFields(page).nth(1).fill("Kevin");
    await rateFields(page).nth(1).fill("20");
    await rateFields(page).nth(1).press("Tab");
    await expect.poll(() => urlParams(page).getAll("p")).toEqual(["30|Kevin", "20|Kevin"]);
  });

  // -------------------------------------------------------------------------------------------
  // Paramètre n
  // -------------------------------------------------------------------------------------------

  test("n de 60 caractères après trim → affiché", async ({ page }) => {
    const title = "T".repeat(60);
    await openFixed(page, query({ s: NOW - 60, n: `   ${title}   ` }));
    await expectCounter(page);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  });

  test("n de 61 caractères → vide (pas tronqué)", async ({ page }) => {
    const title = "T".repeat(61);
    await openFixed(page, query({ s: NOW - 60, n: title }));
    await expectCounter(page);
    await expect(page.getByText("T".repeat(60))).toHaveCount(0);
  });

  test("n vide ou absent → Compteur sans titre libre", async ({ page }) => {
    await openFixed(page, query({ s: NOW - 60, n: "" }));
    await expectCounter(page);
  });

  // -------------------------------------------------------------------------------------------
  // CL-6 · tous les taux à 0
  // -------------------------------------------------------------------------------------------

  test("CL-6 · tous les taux à 0 → 0,00 € + « Réunion bénévole. Suspect. »", async ({ page }) => {
    await openFixed(
      page,
      query({
        team: [
          { label: "Bénévole", rate: 0 },
          { label: "Autre", rate: 0 },
        ],
        s: NOW - 3600,
      }),
    );
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(0));
    await expect(page.getByText(specText("Réunion bénévole. Suspect."))).toBeVisible();
  });

  test("CL-6 · passer le dernier taux non nul à 0 pendant le Compteur → message", async ({
    page,
  }) => {
    await openFixed(
      page,
      query({
        team: [
          { label: "Bénévole", rate: 0 },
          { label: "Payé", rate: 10 },
        ],
        s: NOW - 3600,
      }),
    );
    await expect(page.getByText(specText("Réunion bénévole. Suspect."))).toHaveCount(0);
    await rateFields(page).nth(1).fill("0");
    await rateFields(page).nth(1).press("Tab");
    await expect.poll(() => shownAmount(page)).toBe(euros(0));
    await expect(page.getByText(specText("Réunion bénévole. Suspect."))).toBeVisible();
  });

  // -------------------------------------------------------------------------------------------
  // CL-8 · query > 4 Ko
  // -------------------------------------------------------------------------------------------

  test("CL-8 · query de plus de 4 Ko → Configuration + « Lien trop long »", async ({ page }) => {
    const padding = `x=${"a".repeat(4200)}`;
    await openFixed(page, `${query({ s: NOW - 60 })}&${padding}`);
    await expectConfiguration(page);
    await expect(page.getByText(specText("Lien trop long"))).toBeVisible();
  });

  // 12 Ko : sous la limite d'en-tête du serveur de test (16 Ko), bien au-delà des 4 Ko.
  test("CL-8 · 2 000 paramètres p (12 Ko) → refus propre, la page répond", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const padding = `p=${"1|a&p=".repeat(2000)}1|a`;
    await openFixed(page, `${query({ s: NOW - 60 })}&${padding}`);
    await expectConfiguration(page);
    await expect(page.getByText(specText("Lien trop long"))).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("CL-8 · query légitime juste sous 4 Ko (30 participants à 40 caractères) → Compteur", async ({
    page,
  }) => {
    const team = Array.from({ length: 30 }, (_, index) => ({
      label: `${"X".repeat(37)}${String(index).padStart(3, "0")}`,
      rate: 10,
    }));
    const search = query({ t: "A", team, s: NOW - 3600, n: "N".repeat(60) });
    expect(search.length).toBeLessThan(4096);
    await openFixed(page, search);
    await expectCounter(page);
    expect(await shownAmount(page)).toBe(euros(300));
  });

  // -------------------------------------------------------------------------------------------
  // CL-9 · arrière-plan
  // -------------------------------------------------------------------------------------------

  test("CL-9 · après 10 min sans tick (onglet en arrière-plan), le montant est juste dès le retour", async ({
    page,
  }) => {
    await openTicking(page, query({ s: NOW - 60 }));
    await expectCounter(page);
    // L'horloge saute sans déclencher de minuteur, comme un onglet gelé en arrière-plan.
    await page.clock.setSystemTime(NOW_MS + 600_000);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Aucun minuteur n'a tourné : seul le retour au premier plan peut avoir corrigé l'affichage.
    expect(await shownAmount(page)).toBe(euros(cost(660, SPEC_TEAM, "B")));
  });

  test("CL-9 · au tick suivant, montant calculé depuis l'heure (jamais par incrément)", async ({
    page,
  }) => {
    await openTicking(page, query({ s: NOW - 60 }));
    await page.clock.setSystemTime(NOW_MS + 600_000);
    await page.clock.runFor(1000);
    expect(await shownAmount(page)).toBe(euros(cost(661, SPEC_TEAM, "B")));
  });

  // -------------------------------------------------------------------------------------------
  // CL-10 · heure de l'appareil
  // -------------------------------------------------------------------------------------------

  test("CL-10 · le ticket indique « heure de votre appareil »", async ({ page }) => {
    await openFixed(page, query({ s: NOW - 600, e: NOW - 60 }));
    await expectTicket(page);
    expect((await ticketLines(page)).join("\n")).toMatch(/heure de votre appareil/iu);
  });

  // -------------------------------------------------------------------------------------------
  // Nouvelle réunion
  // -------------------------------------------------------------------------------------------

  test("Ticket · « Nouvelle réunion » ramène à la Configuration, sans s ni e", async ({ page }) => {
    await openFixed(page, query({ s: NOW - 600, e: NOW - 60 }));
    await newMeetingButton(page).click();
    await expectConfiguration(page);
    expect(urlParams(page).get("s")).toBeNull();
    expect(urlParams(page).get("e")).toBeNull();
  });

  // -------------------------------------------------------------------------------------------
  // Écran Compteur : contenu listé par la spec
  // -------------------------------------------------------------------------------------------

  test("Compteur · montant, durée, personnes, €/heure, tarif, participants, ticket en cours", async ({
    page,
  }) => {
    await openFixed(page, query({ s: NOW - 42 * 60 }));
    await expectCounter(page);
    const main = normalizeSpaces(await page.locator("main").innerText());
    expect(await shownAmount(page)).toBe(euros(cost(42 * 60, SPEC_TEAM, "B")));
    expect(main).toMatch(/00:42:00/u);
    expect(main).toMatch(/Personnes\s+03\b/iu);
    // 122 €/h × 1,5 = 183 €/h.
    expect(main).toMatch(/€ \/ heure\s+183 €/iu);
    await expect(rateRadio(page, /Sans ordre du jour/u)).toBeChecked();
    for (const [index, member] of SPEC_TEAM.entries()) {
      await expect(whoFields(page).nth(index)).toHaveValue(member.label);
      await expect(rateFields(page).nth(index)).toHaveValue(String(member.rate));
    }
    await expect(ticket(page)).toBeVisible();
    expect(cents((await ticketLines(page)).find((line) => /^Total/iu.test(line)) ?? "")).toBe(
      cents(await shownAmount(page)),
    );
  });

  // -------------------------------------------------------------------------------------------
  // Accessibilité : axe sur chaque écran (1280 px et 360 px via les projets)
  // -------------------------------------------------------------------------------------------

  for (const [screen, search] of [
    ["Configuration", ""],
    ["Configuration + message", query({ v: "2", s: NOW - 60 })],
    ["Compteur", query({ s: NOW - 600, n: "Point rapide" })],
    ["Compteur 12 participants", query({ team: team(12, true), s: NOW - 600 })],
    ["Compteur 24 h", query({ s: NOW - 2 * DAY })],
    ["Ticket", query({ s: NOW - 600, e: NOW - 60, n: "Point rapide" })],
    [
      "Ticket tarif C bénévole",
      query({ t: "C", team: [{ label: "Bénévole", rate: 0 }], s: NOW - 600, e: NOW - 60 }),
    ],
  ] as const) {
    test(`a11y · ${screen} : aucune violation axe`, async ({ page }) => {
      await openFixed(page, search);
      expect(await axeViolations(page)).toEqual([]);
    });

    test(`a11y · ${screen} : pas de défilement horizontal`, async ({ page }) => {
      await openFixed(page, search);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test(`typo · ${screen} : insécables et pas de tiret cadratin`, async ({ page }) => {
      await openFixed(page, search);
      const issues = (await perceivedTexts(page, page.locator("body"))).flatMap(({ where, text }) =>
        typographyIssues(text).map((issue) => `${where} : ${issue}`),
      );
      expect(issues).toEqual([]);
    });
  }

  test("a11y · repli presse-papiers : aucune violation axe", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    await openFixed(page, query({ s: NOW - 600, e: NOW - 60 }));
    await copyTicketButton(page).click();
    await expect(page.getByRole("textbox", { name: /lien/iu })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test("a11y · libellé de 40 caractères sans espace à 360 px : pas de défilement horizontal", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 360, height: 780 });
    await openFixed(
      page,
      query({ team: [{ label: "W".repeat(40), rate: 10 }], s: NOW - 600, n: "M".repeat(60) }),
    );
    await expectCounter(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await finishButton(page).click();
    await expectTicket(page);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("a11y · cibles tactiles ≥ 44 px sur chaque écran", async ({ page }) => {
    const small: string[] = [];
    for (const [screen, search] of [
      ["config", ""],
      ["compteur", query({ s: NOW - 600 })],
      ["ticket", query({ s: NOW - 600, e: NOW - 60 })],
    ] as const) {
      await openFixed(page, search);
      const found = await page.evaluate(() => {
        const targets = [
          ...document.querySelectorAll(
            "main button, main input:not([type=radio]), main label:has(input[type=radio]), a[href]",
          ),
        ];
        return targets
          .filter((element) => element.checkVisibility())
          .map((element) => {
            const box = element.getBoundingClientRect();
            const name = (element.getAttribute("aria-label") ?? element.textContent ?? element.id)
              .trim()
              .slice(0, 30);
            return { name: `${element.nodeName} ${name}`, width: box.width, height: box.height };
          })
          .filter((box) => box.height < 44 || box.width < 44)
          .map((box) => `${box.name} ${Math.round(box.width)}×${Math.round(box.height)}`);
      });
      small.push(...found.map((item) => `${screen} : ${item}`));
    }
    expect(small).toEqual([]);
  });

  test("Montant · ticket au format Intl fr-FR exact, afficheur sans espace sécable", async ({
    page,
  }) => {
    // 1000 €/h × 5 h 30 = 5 500,00 €.
    await openFixed(
      page,
      query({ t: "A", team: [{ label: "Board", rate: 1000 }], s: NOW - 5 * 3600 - 1800 }),
    );
    const total = await ticket(page)
      .getByRole("definition")
      .filter({ hasText: /€/u })
      .last()
      .innerText();
    expect(total).toBe(EUR.format(5500));
    const led = await timer(page).innerText();
    // Une espace sécable couperait le montant en deux lignes.
    expect(led).not.toMatch(/\d \d/u);
    expect(await shownAmount(page)).toBe(euros(5500));
    expect(normalizeSpaces(led)).toContain("€");
    expect(NBSP).toBe("\u00a0");
  });

  // -------------------------------------------------------------------------------------------
  // Lisibilité du montant, budget, réseau
  // -------------------------------------------------------------------------------------------

  for (const width of [360, 1280]) {
    test(`CA-9 · montant maximal (30 × 1000 €/h, tarif C, 24 h) entier et lisible à ${width} px`, async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
      await page.setViewportSize({ width, height: 800 });
      const board = Array.from({ length: 30 }, (_, index) => ({
        label: `CA ${index + 1}`,
        rate: 1000,
      }));
      await openFixed(page, query({ t: "C", team: board, s: NOW - DAY, e: NOW }));
      await expectTicket(page);
      expect(await shownAmount(page)).toBe(euros(1_440_000));
      // Aucun chiffre rogné par le cadre de l'afficheur.
      const clipped = await timer(page).evaluate((root) => {
        const frame = root.parentElement?.getBoundingClientRect();
        if (frame === undefined) return ["pas de cadre"];
        return [root, ...root.querySelectorAll("*")]
          .map((element) => ({ element, box: element.getBoundingClientRect() }))
          .filter(({ box }) => box.left < frame.left - 0.5 || box.right > frame.right + 0.5)
          .map(
            ({ element, box }) =>
              `${element.textContent ?? ""} ${Math.round(box.left)}-${Math.round(box.right)} hors de ${Math.round(frame.left)}-${Math.round(frame.right)}`,
          );
      });
      expect(clipped).toEqual([]);
      const fontSize = await timer(page).evaluate((root) =>
        parseFloat(getComputedStyle(root).fontSize),
      );
      expect(fontSize, "chiffres de l'afficheur trop petits").toBeGreaterThanOrEqual(24);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("Budget · moins de 50 Ko de JS (gzip) sur la page", async ({ page, request }) => {
    const scripts: string[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "script") scripts.push(response.url());
    });
    await openFixed(page, query({ s: NOW - 600 }));
    await page.waitForLoadState("networkidle");
    let total = 0;
    for (const url of scripts) {
      total += gzipSync(await (await request.get(url)).body()).length;
    }
    expect(scripts.length).toBeGreaterThan(0);
    expect(total).toBeLessThan(50 * 1024);
  });

  for (const [screen, search] of [
    ["Compteur", query({ s: NOW - 600 })],
    ["Ticket", query({ s: NOW - 600, e: NOW - 60 })],
    [
      "lien hostile",
      query({
        team: [{ label: "<img src=x onerror=alert(1)>", rate: 10 }],
        raw: ["p=1e3|x"],
        s: "abc",
        n: "<svg/onload=alert(1)>",
      }),
    ],
  ] as const) {
    test(`Règle 1 · ${screen} : aucune requête vers un tiers, aucune erreur JS`, async ({
      page,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? "http://localhost").origin;
      const problems: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.protocol.startsWith("http") && url.origin !== origin) problems.push(request.url());
      });
      page.on("pageerror", (error) => problems.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(message.text());
      });
      await openFixed(page, search);
      await page.waitForLoadState("networkidle");
      expect(problems).toEqual([]);
      expect(await page.context().cookies()).toEqual([]);
      expect(await page.evaluate(() => localStorage.length)).toBe(0);
    });
  }
});

// =============================================================================================
// Tour 2 : décisions de l'orchestrateur après le tour 1 (spec et CLAUDE.md, commit 059efe7).
// Écrits depuis la spec ; les sélecteurs passent par les rôles et les noms accessibles.
// =============================================================================================

function copyMeterButton(page: Page) {
  return page.getByRole("button", { name: /Copier le lien du compteur/u });
}

function titleField(page: Page) {
  return page.getByRole("textbox", { name: /titre/iu });
}

/** Le bloc de l'afficheur (montant, durée, personnes, €/heure). */
function board(page: Page): Locator {
  return page.getByRole("region", { name: /Montant/u });
}

function crew(count: number, rate: (index: number) => number, long = false): Member[] {
  return Array.from({ length: count }, (_, index) => ({
    label: long
      ? `Responsable « transverse » numéro ${String(index + 1).padStart(2, "0")}…`.slice(0, 40)
      : `Participant ${index + 1}`,
    rate: rate(index),
  }));
}

/** Qui recouvre l'élément (centre et deux bords, à mi-hauteur) ; `null` s'il est au premier plan. */
async function coveredBy(locator: Locator): Promise<string | null> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return "boîte vide";
    const y = box.top + box.height / 2;
    for (const x of [box.left + 3, box.left + box.width / 2, box.right - 3]) {
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
        return "hors de la fenêtre";
      }
      const top = document.elementFromPoint(x, y);
      if (top === null) return "rien au point";
      if (!element.contains(top)) {
        const name = top.id === "" ? top.nodeName : `${top.nodeName}#${top.id}`;
        return `${name} « ${(top.textContent ?? "").trim().slice(0, 40)} »`;
      }
    }
    return null;
  });
}

/** Cadres qui défilent ou débordent dans <main> (même règle que les tests CA-11 du tour 1). */
async function scrollingParts(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (main === null) return ["pas de <main>"];
    const found: string[] = [];
    if (main.getBoundingClientRect().bottom > window.innerHeight + 0.5) {
      found.push(`<main> finit à ${Math.round(main.getBoundingClientRect().bottom)} px`);
    }
    for (const element of [main, ...main.querySelectorAll("*")]) {
      if (!(element instanceof HTMLElement) || !element.checkVisibility()) continue;
      const style = getComputedStyle(element);
      if (
        /(auto|scroll|hidden)/u.test(style.overflowY) &&
        element.clientHeight > 1 &&
        element.scrollHeight > element.clientHeight + 1
      ) {
        found.push(
          `${element.nodeName}#${element.id} : ${element.scrollHeight} > ${element.clientHeight}`,
        );
      }
    }
    return found;
  });
}

/** Clique tout bouton visible qui referme un message (« Fermer », « Masquer »). */
async function closeEveryMessage(page: Page) {
  for (const button of await page.getByRole("button", { name: /^(Fermer|Masquer)/u }).all()) {
    if (await button.isVisible()) await button.click();
  }
}

function refuseClipboard(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
}

/** Points de code interdits (contrôles, \p{Bidi_Control}) ou invisibles présents dans un texte. */
function hostileCodePoints(text: string): string[] {
  return [...text]
    .filter((char) => /[\p{Cc}\p{Bidi_Control}\u200b\u3164\u2800\uffa0\u115f\u1160]/u.test(char))
    .filter((char) => char !== "\n" && char !== "\t")
    .map((char) => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`);
}

test.describe("reunion-metre · tester · tour 2", () => {
  // -------------------------------------------------------------------------------------------
  // CA-11 avec les messages (Design : « CA-11 vaut avec les messages affichés »)
  // -------------------------------------------------------------------------------------------

  test("CA-11 · 1280×720, 8 participants + tout ce qui peut s'afficher en même temps (CL-2, CL-6, 4 notices, titre de 60 emoji, repli de copie) : rien ne défile ni ne recouvre la liste", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    await refuseClipboard(page);
    // 8 participants valides à 0 €/h (CL-6), 22 illisibles, puis un 31e (CL-4), tarif inconnu,
    // fin illisible, lancée il y a deux jours (CL-2), titre valide le plus haut possible.
    const search = query({
      t: "Z",
      team: crew(8, () => 0, true),
      raw: [...Array.from({ length: 22 }, () => "p=x|y"), "p=1|Intrus"],
      s: NOW - 2 * DAY,
      e: 1,
      n: "😀".repeat(60),
    });
    await openFixed(page, search);
    await expectCounter(page);
    await expect(page.getByText(specText("Réunion bénévole. Suspect."))).toBeVisible();
    await expect(page.getByText(specText("Réunion de plus de 24 h. Respirez."))).toBeVisible();
    await expect(page.getByRole("status").getByRole("listitem")).toHaveCount(6);
    await copyMeterButton(page).click();
    await expect(page.getByRole("textbox", { name: /lien/iu })).toBeVisible();

    const problems: string[] = [];
    const check = async (what: string, target: Locator) => {
      const cover = await coveredBy(target);
      if (cover !== null) problems.push(`${what} recouvert par ${cover}`);
    };
    await check("montant", timer(page));
    await check("Terminer", finishButton(page));
    for (const [index, item] of (
      await page.getByRole("status").getByRole("listitem").all()
    ).entries()) {
      await check(`message ${index + 1}`, item);
    }
    for (let index = 0; index < 8; index += 1) {
      await expect(whoFields(page).nth(index)).toBeInViewport({ ratio: 1 });
      await check(`Qui ${index + 1}`, whoFields(page).nth(index));
      await check(`€/heure ${index + 1}`, rateFields(page).nth(index));
      await check(`Retirer ${index + 1}`, removeButtons(page).nth(index));
    }
    await check("champ du lien", page.getByRole("textbox", { name: /lien/iu }));
    expect(problems).toEqual([]);
    expect(await scrollingParts(page)).toEqual([]);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  // -------------------------------------------------------------------------------------------
  // Pile de messages flottante sur la colonne du ticket (Compteur, grand écran)
  // -------------------------------------------------------------------------------------------

  // 1093×614 : un écran 1366×768 à 125 % (réglage par défaut de Windows sur ces portables) ;
  // 960×600 : le plus petit écran où le Compteur se met en page sans défilement.
  for (const [width, height] of [
    [1280, 720],
    [1093, 614],
    [960, 600],
  ] as const) {
    for (const cause of ["notices du lien", "repli de copie (CA-7)"] as const) {
      test(`Compteur ${width}×${height} · ${cause} : aucune ligne du ticket en cours ne reste masquée sans moyen de la retrouver`, async ({
        page,
      }, testInfo) => {
        test.skip(testInfo.project.name !== FIXED_VIEWPORT_PROJECT, "viewport fixé par le test");
        await page.setViewportSize({ width, height });
        await refuseClipboard(page);
        const title = "Point hebdo de l'équipe produit, marketing et support client";
        const search =
          cause === "notices du lien"
            ? query({ t: "Z", raw: ["p=12.5|x", "p=-1|y"], s: NOW - 600, e: "fin", n: title })
            : query({ s: NOW - 600, n: title });
        await openFixed(page, search);
        await expectCounter(page);
        if (cause === "repli de copie (CA-7)") {
          await copyMeterButton(page).click();
          await expect(page.getByRole("textbox", { name: /lien/iu })).toBeVisible();
        }

        const masked = async () => {
          const found: string[] = [];
          const lines = [
            ...(await ticket(page).getByRole("term").all()),
            ...(await ticket(page).getByRole("definition").all()),
          ];
          for (const line of lines) {
            if (!(await line.isVisible())) continue;
            // Si le ticket défile dans son cadre, on amène la ligne en vue avant de juger.
            await line.evaluate((element) => element.scrollIntoView({ block: "nearest" }));
            const cover = await coveredBy(line);
            if (cover !== null)
              found.push(`« ${normalizeSpaces(await line.innerText())} » sous ${cover}`);
          }
          return found;
        };
        if ((await masked()).length > 0) await closeEveryMessage(page);
        expect(await masked()).toEqual([]);
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // CA-6 · e borné à [s + 1, s + 86 400]
  // -------------------------------------------------------------------------------------------

  test("CA-6 · « Terminer » dans la seconde du lancement : e = s + 1, et le lien du ticket rouvre ce Ticket", async ({
    page,
    context,
  }) => {
    await openTicking(page, "");
    await launchButton(page).click();
    await expectCounter(page);
    await finishButton(page).click();
    await expectTicket(page);
    expect(urlParams(page).get("s")).toBe(String(NOW));
    expect(urlParams(page).get("e")).toBe(String(NOW + 1));
    const amount = await shownAmount(page);
    expect(amount).toBe(euros(cost(1, DEFAULT_TEAM, "B")));

    const other = await context.newPage();
    await other.clock.setFixedTime(NOW_MS);
    await other.goto(page.url());
    await expectTicket(other);
    expect(await shownAmount(other)).toBe(amount);
  });

  test("CA-6 · « Terminer » après plus de 24 h : e = s + 86 400, Ticket figé à 24 h, lien valide", async ({
    page,
    context,
  }) => {
    const s = NOW - 2 * DAY;
    await openFixed(page, query({ s }));
    await expectCounter(page);
    await finishButton(page).click();
    await expectTicket(page);
    expect(urlParams(page).get("e")).toBe(String(s + DAY));
    expect(await shownAmount(page)).toBe(euros(cost(DAY, SPEC_TEAM, "B")));

    const other = await context.newPage();
    await other.clock.setFixedTime(NOW_MS + 3600_000);
    await other.goto(page.url());
    await expectTicket(other);
    expect(await shownAmount(other)).toBe(euros(cost(DAY, SPEC_TEAM, "B")));
  });

  // -------------------------------------------------------------------------------------------
  // CL-3 · e ignoré, avec message
  // -------------------------------------------------------------------------------------------

  for (const [label, e] of [
    ["e = s", NOW - 600],
    ["e < s", NOW - 601],
    ["e > s + 86 400", NOW - 600 + DAY + 1],
    ["e = maintenant + 61 s", NOW + 61],
    ["e très loin dans le futur", "99999999999999"],
    ["e illisible", "demain"],
    ["e avec du HTML", encodeURIComponent("<img src=x onerror=alert(1)>")],
  ] as const) {
    test(`CL-3 · ${label} → e ignoré, Compteur, message visible, e retiré du lien`, async ({
      page,
    }) => {
      await openFixed(page, query({ s: NOW - 600, e }));
      await expectCounter(page);
      expect(await shownAmount(page)).toBe(euros(cost(600, SPEC_TEAM, "B")));
      await expect(messages(page).filter({ hasText: /fin/iu }).first()).toBeVisible();
      expect(urlParams(page).has("e")).toBe(false);
    });
  }

  test("CL-3 · lien avec une fin dans le futur : le lien copié rouvre le même Compteur, même après cette fin (règle 2)", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const s = NOW - 600;
    await openFixed(page, query({ s, e: NOW + 3600 }));
    await expectCounter(page);
    await copyMeterButton(page).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());

    const other = await context.newPage();
    await other.clock.setFixedTime(NOW_MS + 2 * 3600_000);
    await other.goto(copied);
    await expectCounter(other);
    expect(await shownAmount(other)).toBe(euros(cost(600 + 7200, SPEC_TEAM, "B")));
  });

  // -------------------------------------------------------------------------------------------
  // URL réécrite sous sa forme propre (spec, « Écrans »)
  // -------------------------------------------------------------------------------------------

  const S2 = NOW - 600;
  const MESSY = [
    "utm_source=chat",
    `n=${encodeURIComponent("Revue d'équipe")}`,
    "t=C",
    "t=A",
    "p=12.5|D%C3%A9cimal",
    participant(SPEC_TEAM[0] ?? { label: "", rate: 0 }),
    "p=sans-barre",
    participant(SPEC_TEAM[1] ?? { label: "", rate: 0 }),
    `p=5|${encodeURIComponent("\u200b\u3164")}`,
    "v=1",
    "v=2",
    `s=${S2}`,
    `s=${S2 + 5}`,
    `x=${encodeURIComponent("<img src=x onerror=alert(1)>")}`,
    `y=${SCRIPT_SCHEME}alert(1)`,
    "n=Second",
  ].join("&");
  const MESSY_HASH = "#%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E";

  function expectCleanMeter(url: string) {
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/collection-paperasse/reunion-metre/");
    expect(parsed.hash).toBe("");
    // Ordre de l'exemple de la spec : v, t, p…, s, (e), n ; chaque paramètre une fois, sauf p.
    expect([...parsed.searchParams.keys()]).toEqual(["v", "t", "p", "p", "s", "n"]);
    expect(parsed.searchParams.get("v")).toBe("1");
    expect(parsed.searchParams.get("t")).toBe("C");
    expect(parsed.searchParams.getAll("p")).toEqual([
      "68|Cheffe de projet",
      "48|Kevin du marketing",
    ]);
    expect(parsed.searchParams.get("s")).toBe(String(S2));
    expect(parsed.searchParams.get("n")).toBe("Revue d'équipe");
    expect(url).not.toMatch(/[<>"]|script:/iu);
  }

  test("URL propre · inconnus, doublons, participants invalides et hash retirés après lecture", async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openFixed(page, `${MESSY}${MESSY_HASH}`);
    await expectCounter(page);
    expectCleanMeter(page.url());
    expect(await shownAmount(page)).toBe(euros(cost(600, SPEC_TEAM.slice(0, 2), "C")));
    expect(dialogs).toEqual([]);
  });

  test("URL propre · réécrite sur place (replaceState) : Précédent ne ramène pas au lien sale, Suivant rend la forme propre", async ({
    page,
  }) => {
    await openFixed(page, "");
    await expectConfiguration(page);
    const lengthBefore = await page.evaluate(() => history.length);
    await page.goto(`reunion-metre/?${MESSY}${MESSY_HASH}`);
    await expectCounter(page);
    expect(await page.evaluate(() => history.length)).toBe(lengthBefore + 1);
    await page.goBack();
    await expectConfiguration(page);
    expect(new URL(page.url()).searchParams.has("utm_source")).toBe(false);
    await page.goForward();
    await expectCounter(page);
    expectCleanMeter(page.url());
  });

  test("URL propre · « Copier le lien du compteur » copie la forme propre, qui se rouvre à l'identique", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openFixed(page, `${MESSY}${MESSY_HASH}`);
    await copyMeterButton(page).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expectCleanMeter(copied);

    const other = await context.newPage();
    await other.clock.setFixedTime(NOW_MS + 120_000);
    await other.goto(copied);
    await expectCounter(other);
    // Déjà propre : la réécriture ne change plus rien, et aucune notice ne s'affiche.
    expect(other.url()).toBe(copied);
    await expect(messages(other).getByRole("listitem")).toHaveCount(0);
    expect(await shownAmount(other)).toBe(euros(cost(720, SPEC_TEAM.slice(0, 2), "C")));
  });

  test("URL propre · « Copier le lien du ticket » copie la forme propre du ticket", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openFixed(
      page,
      `${query({ s: NOW - 600, e: NOW - 60 })}&e=${NOW - 300}&utm_medium=x#frag`,
    );
    await expectTicket(page);
    await copyTicketButton(page).click();
    const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect([...copied.searchParams.keys()]).toEqual(["v", "t", "p", "p", "p", "s", "e"]);
    expect(copied.searchParams.get("e")).toBe(String(NOW - 60));
    expect(copied.hash).toBe("");
  });

  test("URL propre · texte libre unicode (RTL, emoji, insécables) : la forme propre garde chaque caractère", async ({
    page,
    context,
  }) => {
    const team: Member[] = [
      { label: "مدير المشروع", rate: 10 },
      {
        label: `Kevin ${String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)}`,
        rate: 20,
      },
      { label: "A|B & C=D ?#%", rate: 30 },
    ];
    const title = "Point\u00a0: «\u00a0budget\u00a0» ?";
    await openFixed(page, query({ t: "A", team, s: NOW - 3600, n: title }));
    await expectCounter(page);
    const params = urlParams(page);
    expect(params.getAll("p")).toEqual(team.map((member) => `${member.rate}|${member.label}`));
    expect(params.get("n")).toBe(title);

    const other = await context.newPage();
    await other.clock.setFixedTime(NOW_MS);
    await other.goto(page.url());
    expect(other.url()).toBe(page.url());
    for (const [index, member] of team.entries()) {
      await expect(whoFields(other).nth(index)).toHaveValue(member.label);
    }
    expect(await shownAmount(other)).toBe(euros(60));
  });

  test("URL propre · s illisible : Configuration, et ni s ni e ne restent dans le lien", async ({
    page,
  }) => {
    await openFixed(page, query({ s: "1.7e9", e: NOW - 60 }));
    await expectConfiguration(page);
    const params = urlParams(page);
    expect(params.has("s")).toBe(false);
    expect(params.has("e")).toBe(false);
    expect(params.getAll("p")).toHaveLength(SPEC_TEAM.length);
  });

  test("URL propre · lien de plus de 4 Ko : refusé, l'adresse ne garde pas les 4 Ko", async ({
    page,
  }) => {
    await openFixed(page, `${query({ s: NOW - 60 })}&x=${"a".repeat(4200)}`);
    await expectConfiguration(page);
    await expect(page.getByText(specText("Lien trop long"))).toBeVisible();
    expect(page.url().length).toBeLessThan(200);
  });

  test("URL propre · hash seul sur l'adresse nue (HTML dedans) : retiré, rien ne s'exécute", async ({
    page,
  }) => {
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.clock.setFixedTime(NOW_MS);
    await page.goto(`reunion-metre/${MESSY_HASH}`);
    await expectConfiguration(page);
    expect(new URL(page.url()).hash).toBe("");
    expect(dialogs).toEqual([]);
  });

  // -------------------------------------------------------------------------------------------
  // « Nouvelle réunion » (spec, « Écrans » 3)
  // -------------------------------------------------------------------------------------------

  test("Nouvelle réunion · même équipe, tarif et titre ; pushState (Précédent rend le ticket) puis replaceState en Configuration", async ({
    page,
  }) => {
    await openFixed(page, query({ t: "C", s: NOW - 3600, e: NOW - 600, n: "Rétro" }));
    await expectTicket(page);
    const ticketUrl = page.url();
    const ticketAmount = await shownAmount(page);
    const before = await page.evaluate(() => history.length);

    await newMeetingButton(page).click();
    await expectConfiguration(page);
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    let params = urlParams(page);
    expect(params.has("s")).toBe(false);
    expect(params.has("e")).toBe(false);
    expect(params.get("t")).toBe("C");
    expect(params.get("n")).toBe("Rétro");
    expect(params.getAll("p")).toEqual(SPEC_TEAM.map((member) => `${member.rate}|${member.label}`));
    for (const [index, member] of SPEC_TEAM.entries()) {
      await expect(whoFields(page).nth(index)).toHaveValue(member.label);
      await expect(rateFields(page).nth(index)).toHaveValue(String(member.rate));
    }
    await expect(rateRadio(page, /Aurait pu être un mail/u)).toBeChecked();
    await expect(titleField(page)).toHaveValue("Rétro");

    // Les modifications de la Configuration réécrivent cette entrée, sans en créer.
    await rateFields(page).nth(2).fill("12");
    await rateRadio(page, /Point rapide/u).check();
    await titleField(page).fill("Rétro bis");
    await expect.poll(() => urlParams(page).get("n")).toBe("Rétro bis");
    params = urlParams(page);
    expect(params.get("t")).toBe("A");
    expect(params.getAll("p")[2]).toBe("12|Stagiaire");
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    const setupUrl = page.url();

    await page.goBack();
    await expectTicket(page);
    expect(page.url()).toBe(ticketUrl);
    expect(await shownAmount(page)).toBe(ticketAmount);

    await page.goForward();
    await expectConfiguration(page);
    expect(page.url()).toBe(setupUrl);
    await expect(titleField(page)).toHaveValue("Rétro bis");

    // Lancer depuis cette Configuration : s = maintenant, toujours sans nouvelle entrée (CA-2).
    await launchButton(page).click();
    await expectCounter(page);
    expect(urlParams(page).get("s")).toBe(String(NOW));
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
    await page.goBack();
    await expectTicket(page);
    expect(page.url()).toBe(ticketUrl);
  });

  // -------------------------------------------------------------------------------------------
  // Modèle de menace · texte sans caractère visible refusé, \p{Bidi_Control} retiré
  // -------------------------------------------------------------------------------------------

  for (const [label, invisible] of [
    ["U+200B ×3", "\u200b\u200b\u200b"],
    ["U+3164", "\u3164"],
    ["U+2800 ×5", "\u2800\u2800\u2800\u2800\u2800"],
    ["U+FFA0", "\uffa0"],
    ["U+115F U+1160", "\u115f\u1160"],
    ["U+2060 U+FEFF", "\u2060\ufeff"],
    ["U+00AD", "\u00ad"],
    ["U+200D seul", "\u200d"],
    ["espaces, insécable, U+3000 et U+200B", " \u00a0\u3000\u200b "],
    ["U+061C U+200F (bidi seuls)", "\u061c\u200f"],
  ] as const) {
    test(`Menace · libellé invisible (${label}) dans le lien → participant ignoré, avec message, retiré du lien`, async ({
      page,
    }) => {
      await openFixed(
        page,
        query({
          t: "A",
          team: [
            { label: "Kevin", rate: 10 },
            { label: invisible, rate: 1000 },
          ],
          s: NOW - 3600,
        }),
      );
      await expectCounter(page);
      await expect(whoFields(page)).toHaveCount(1);
      expect(await shownAmount(page)).toBe(euros(10));
      await expect(
        messages(page)
          .filter({ hasText: /1 participant/u })
          .first(),
      ).toBeVisible();
      expect(urlParams(page).getAll("p")).toEqual(["10|Kevin"]);
    });
  }

  test("Menace · seuls des libellés invisibles → Configuration avec message", async ({ page }) => {
    await openFixed(
      page,
      query({
        team: [
          { label: "\u200b", rate: 10 },
          { label: "\u3164\u3164", rate: 20 },
        ],
        s: NOW - 60,
      }),
    );
    await expectConfiguration(page);
    await expect(
      messages(page)
        .filter({ hasText: /participant/iu })
        .first(),
    ).toBeVisible();
  });

  test("Menace · invisibles mêlés à du visible : accepté (seul le texte sans rien de visible est refusé)", async ({
    page,
  }) => {
    await openFixed(
      page,
      query({
        t: "A",
        team: [
          { label: "Ke\u200bvin", rate: 10 },
          { label: "Ana", rate: 5 },
        ],
        s: NOW - 3600,
      }),
    );
    await expectCounter(page);
    await expect(whoFields(page)).toHaveCount(2);
    expect(await shownAmount(page)).toBe(euros(15));
  });

  test("Menace · titre invisible → aucun titre affiché sur le ticket, n retiré du lien", async ({
    page,
  }) => {
    await openFixed(page, query({ s: NOW - 600, e: NOW - 60, n: "\u200b\u3164\u2800\u2800" }));
    await expectTicket(page);
    expect(urlParams(page).has("n")).toBe(false);
    const text = await page.evaluate(() => document.body.innerText);
    expect(hostileCodePoints(text)).toEqual([]);
  });

  test("Menace · U+061C (ALM) retiré du libellé et du titre affichés (Ticket) et du lien réécrit", async ({
    page,
  }) => {
    const alm = "\u061c";
    await openFixed(
      page,
      query({
        t: "A",
        team: [{ label: `Ke${alm}vin`, rate: 10 }],
        s: NOW - 3600,
        e: NOW - 60,
        n: `Rap${alm}port ${alm}fdp.exe`,
      }),
    );
    await expectTicket(page);
    const lines = (await ticketLines(page)).join("\n");
    expect(lines).toContain("Kevin");
    expect(lines).toContain("Rapport fdp.exe");
    expect(hostileCodePoints(await page.evaluate(() => document.body.textContent ?? ""))).toEqual(
      [],
    );
    expect(page.url()).not.toMatch(/%D8%9C/iu);
  });

  test("Menace · tous les \\p{Bidi_Control} et les contrôles retirés, partout dans la page", async ({
    page,
  }) => {
    const bidi = [
      0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068,
      0x2069,
    ]
      .map((code) => String.fromCodePoint(code))
      .join("");
    await openFixed(
      page,
      query({
        t: "A",
        team: [{ label: `K${bidi}evin\u0000\u009f`, rate: 10 }],
        s: NOW - 600,
        n: `R${bidi}étro`,
      }),
    );
    await expectCounter(page);
    await expect(whoFields(page).first()).toHaveValue("Kevin");
    expect(hostileCodePoints(await page.evaluate(() => document.body.textContent ?? ""))).toEqual(
      [],
    );
    expect(urlParams(page).get("n")).toBe("Rétro");
  });

  test("Menace · saisie : libellé invisible signalé et hors du lien ; U+061C tapé n'entre pas dans le lien", async ({
    page,
  }) => {
    await openFixed(page, query({ s: NOW - 600 }));
    await expectCounter(page);
    await whoFields(page).nth(1).fill("\u200b\u3164");
    await expect(whoFields(page).nth(1)).toHaveAttribute("aria-invalid", "true");
    await expect
      .poll(() => urlParams(page).getAll("p"))
      .toEqual(["68|Cheffe de projet", "6|Stagiaire"]);
    await whoFields(page).nth(0).fill("Che\u061cffe");
    await expect.poll(() => urlParams(page).getAll("p")[0]).toBe("68|Cheffe");
    expect(page.url()).not.toMatch(/%D8%9C/iu);
  });

  // -------------------------------------------------------------------------------------------
  // Longueurs en points de code, pas de maxlength
  // -------------------------------------------------------------------------------------------

  test("Menace · aucun maxlength sur le titre ni sur les libellés (Configuration et Compteur)", async ({
    page,
  }) => {
    await openFixed(page, "");
    expect(await titleField(page).getAttribute("maxlength")).toBeNull();
    for (const field of await whoFields(page).all()) {
      expect(await field.getAttribute("maxlength")).toBeNull();
    }
    await openFixed(page, query({ s: NOW - 60 }));
    for (const field of await whoFields(page).all()) {
      expect(await field.getAttribute("maxlength")).toBeNull();
    }
  });

  test("Menace · titre tapé : 60 emoji (120 unités UTF-16) acceptés et lancés, 61 signalés", async ({
    page,
  }) => {
    await openTicking(page, "");
    const sixty = "😀".repeat(60);
    await titleField(page).fill(`${sixty}😀`);
    await expect(titleField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText(/60 caractères/u).first()).toBeVisible();
    await titleField(page).fill(sixty);
    await expect(titleField(page)).not.toHaveAttribute("aria-invalid", "true");
    await launchButton(page).click();
    await expectCounter(page);
    expect(urlParams(page).get("n")).toBe(sixty);
  });

  test("Menace · libellé tapé pendant le Compteur : 8 familles ZWJ (40 points de code) acceptées, 41 refusées", async ({
    page,
  }) => {
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    await openFixed(page, query({ s: NOW - 600 }));
    const who = whoFields(page).first();
    await who.fill(family.repeat(8));
    await expect(who).not.toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => urlParams(page).getAll("p")[0]).toBe(`68|${family.repeat(8)}`);
    await who.fill(`${family.repeat(8)}x`);
    await expect(who).toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => urlParams(page).getAll("p")).toHaveLength(2);
    expect(
      urlParams(page)
        .getAll("p")
        .some((value) => value.endsWith("x")),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------------------------
  // CL-8 · l'app refuse une modification qui produirait un lien trop long
  // -------------------------------------------------------------------------------------------

  test("CL-8 · pendant le Compteur, un libellé qui ferait dépasser 4 Ko au lien est refusé avec « Lien trop long », le lien ne change pas", async ({
    page,
  }) => {
    const emoji40 = "😀".repeat(40);
    const team = Array.from({ length: 30 }, (_, index) => ({
      label: index < 6 ? emoji40 : `${"a".repeat(37)}${String(index).padStart(3, "0")}`,
      rate: 10,
    }));
    const search = query({ t: "A", team, s: NOW - 3600 });
    // Un libellé de 40 emoji encodés pèse 440 caractères de plus qu'un libellé ASCII de 40.
    expect(search.length).toBeLessThanOrEqual(4096);
    expect(search.length + 440).toBeGreaterThan(4096);
    await openFixed(page, search);
    await expectCounter(page);
    const before = page.url();
    await whoFields(page).nth(29).fill(emoji40);
    await expect(page.getByText(specText("Lien trop long")).first()).toBeVisible();
    expect(page.url()).toBe(before);
    expect(await shownAmount(page)).toBe(euros(300));
  });

  // -------------------------------------------------------------------------------------------
  // Design · Doto 900 pour tous les chiffres hors ticket ; « € » avant le montant
  // -------------------------------------------------------------------------------------------

  async function fontOf(locator: Locator) {
    return locator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        family: (style.fontFamily.split(",")[0] ?? "").replace(/["']/gu, "").trim(),
        weight: style.fontWeight,
      };
    });
  }

  test("Design · Doto 900 chargée et utilisée pour montant, durée, personnes, €/heure et taux ; le ticket reste en JetBrains Mono", async ({
    page,
  }) => {
    await openFixed(page, query({ s: NOW - 600 }));
    await expectCounter(page);
    const digits = timer(page)
      .getByText(/\d,\d\d/u)
      .last();
    const targets: [string, Locator][] = [
      ["montant", digits],
      ...(await board(page).getByRole("definition").all()).map(
        (definition, index): [string, Locator] => [`stat ${index + 1}`, definition],
      ),
      ...(await rateFields(page).all()).map((field, index): [string, Locator] => [
        `taux ${index + 1}`,
        field,
      ]),
    ];
    expect(targets.length).toBeGreaterThanOrEqual(1 + 3 + SPEC_TEAM.length);
    const wrong: string[] = [];
    for (const [name, target] of targets) {
      const font = await fontOf(target);
      if (font.family !== "Doto" || font.weight !== "900") {
        wrong.push(`${name} : ${font.family} ${font.weight}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(
      await page.evaluate(() =>
        [...document.fonts].some(
          (face) => face.family.replace(/["']/gu, "") === "Doto" && face.status === "loaded",
        ),
      ),
    ).toBe(true);
    expect((await fontOf(ticket(page).getByRole("definition").last())).family).toBe(
      "JetBrains Mono",
    );

    // Configuration : taux et coût horaire.
    await openFixed(page, "");
    for (const field of await rateFields(page).all()) {
      expect((await fontOf(field)).family).toBe("Doto");
    }
    const preview = page
      .getByText(/Coût horaire/u)
      .getByText(/\d/u)
      .last();
    expect((await fontOf(preview)).family).toBe("Doto");
  });

  test("Design · afficheur « € » en petit avant le montant, milliers en U+00A0 (jamais U+202F)", async ({
    page,
  }) => {
    // 1000 €/h × 2 h = 2 000,00 €.
    await openFixed(page, query({ t: "A", team: [{ label: "Board", rate: 1000 }], s: NOW - 7200 }));
    const text = await timer(page).innerText();
    const euro = text.indexOf("€");
    const firstDigit = text.search(/\d/u);
    expect(euro).toBeGreaterThanOrEqual(0);
    expect(euro).toBeLessThan(firstDigit);
    expect(text).toContain("2\u00a0000,00");
    expect(text).not.toContain("\u202f");
  });

  // -------------------------------------------------------------------------------------------
  // Accessibilité et typographie des écrans ajoutés au tour 2 (1280 px et 360 px)
  // -------------------------------------------------------------------------------------------

  const ROUND2_SCREENS: [string, string, ((page: Page) => Promise<void>) | null][] = [
    [
      "Compteur + notices du lien + CL-2 + CL-6",
      query({
        t: "Z",
        team: crew(3, () => 0),
        raw: ["p=12.5|x"],
        s: NOW - 2 * DAY,
        e: "fin",
      }),
      null,
    ],
    [
      "Compteur + repli de copie",
      query({ s: NOW - 600, n: "Point rapide" }),
      async (page) => {
        await copyMeterButton(page).click();
        await expect(page.getByRole("textbox", { name: /lien/iu })).toBeVisible();
      },
    ],
    [
      "Configuration après « Nouvelle réunion »",
      query({ s: NOW - 600, e: NOW - 60, n: "Rétro" }),
      async (page) => {
        await newMeetingButton(page).click();
        await expectConfiguration(page);
      },
    ],
  ];

  for (const [screen, search, prepare] of ROUND2_SCREENS) {
    test(`a11y · ${screen} : aucune violation axe, pas de défilement horizontal, typographie`, async ({
      page,
    }) => {
      await refuseClipboard(page);
      await openFixed(page, search);
      if (prepare !== null) await prepare(page);
      expect(await axeViolations(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      const issues = (await perceivedTexts(page, page.locator("body"))).flatMap(({ where, text }) =>
        typographyIssues(text).map((issue) => `${where} : ${issue}`),
      );
      expect(issues).toEqual([]);
    });
  }
});
