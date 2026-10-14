// Tests e2e du Réunion-mètre écrits par le builder (tour 1), un par CA et CL de
// specs/reunion-metre.md. L'horloge est toujours contrôlée (page.clock) : aucun waitForTimeout.
// Les garde-fous communs (axe sur la page nue, CSP, étiquette) sont dans tests/e2e/*.spec.ts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { NBSP, normalizeSpaces, perceivedTexts, typographyIssues } from "../support/text";

const BASE = "reunion-metre/";
/** 14/10/2025 09:00:00 à Paris (fuseau des tests). */
const S = 1_760_425_200;

const DEFAULT_PEOPLE = [
  ["Cheffe de projet", "68"],
  ["Dev qui code sous la table", "48"],
  [`Responsable «${NBSP}transverse${NBSP}»`, "72"],
  ["Celui qui a la caméra coupée", "51"],
  ["Stagiaire qui prend les notes", "6"],
];

const p = (rate: number, label: string) => `p=${rate}|${encodeURIComponent(label)}`;
const link = (...parts: string[]) => `${BASE}?${parts.join("&")}`;
/** Un participant à 354 €/h, tarif A : 42 minutes coûtent 247,80 € (exemple de CA-8). */
const SOLO = [p(354, "Kevin"), "t=A"];

/** « 247,80 » : montant attendu, calculé à la main (centimes arrondis, pas de demi-centime). */
function euros(seconds: number, ratePerHour: number): string {
  return (Math.round((seconds * ratePerHour * 100) / 3600) / 100).toFixed(2).replace(".", ",");
}

/**
 * Ouvre `url` avec l'horloge figée exactement à `atSeconds` (figée avant la navigation : le
 * premier affichage est déterministe). La suite du test avance le temps à la main (runFor).
 */
async function openAt(page: Page, url: string, atSeconds: number) {
  await page.clock.install({ time: (atSeconds - 1) * 1000 });
  await page.clock.pauseAt(atSeconds * 1000);
  await page.goto(url);
}

const timer = (page: Page) => page.getByRole("timer");
const digits = (page: Page) => timer(page).locator("[data-ghost]");
const receipt = (page: Page) => page.getByRole("complementary", { name: "Ticket de réunion" });
const notices = (page: Page) => page.getByRole("status");

async function query(page: Page): Promise<URLSearchParams> {
  return new URL(page.url()).searchParams;
}

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

test.describe("reunion-metre · écrans", () => {
  test("CA-1 · sans paramètre : Configuration, 5 participants pré-remplis, tarif B", async ({
    page,
  }) => {
    await page.goto(BASE);
    await expect(page.getByRole("heading", { name: "Préparer la réunion" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Sans ordre du jour/u })).toBeChecked();
    await expect(page.getByRole("radio", { name: /Point rapide/u })).not.toBeChecked();

    const who = page.getByLabel("Qui", { exact: true });
    const rate = page.getByLabel("€/heure", { exact: true });
    await expect(who).toHaveCount(5);
    await expect(rate).toHaveCount(5);
    await expect(page.getByRole("button", { name: /^Retirer/u })).toHaveCount(5);
    for (const [index, [label, value]] of DEFAULT_PEOPLE.entries()) {
      await expect(who.nth(index)).toHaveValue(label ?? "");
      await expect(rate.nth(index)).toHaveValue(value ?? "");
    }
    await expect(timer(page)).toBeHidden();
    expect(page.url()).not.toContain("?");
  });

  test("CA-2 · « Lancer le compteur » met s = maintenant dans l'URL (replaceState)", async ({
    page,
  }) => {
    await openAt(page, BASE, S);
    const historyLength = await page.evaluate(() => history.length);
    await page.getByRole("button", { name: "Lancer le compteur" }).click();

    await expect(timer(page)).toBeVisible();
    const params = await query(page);
    expect(params.get("s")).toBe(String(S));
    expect(params.get("v")).toBe("1");
    expect(params.get("t")).toBe("B");
    expect(params.getAll("p")).toEqual(DEFAULT_PEOPLE.map(([label, rate]) => `${rate}|${label}`));
    expect(params.has("e")).toBe(false);
    // Format exact de la spec : `|` en clair, espaces en %20, v en tête.
    expect(page.url()).toContain(
      "/reunion-metre/?v=1&t=B&p=68|Cheffe%20de%20projet&p=48|Dev%20qui%20code%20sous%20la%20table&",
    );
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
    await expect(page.getByRole("button", { name: "Terminer" })).toBeFocused();
  });

  test("CA-2 · le titre saisi passe dans n et s'affiche", async ({ page }) => {
    await openAt(page, BASE, S);
    await page.getByLabel("Titre de la réunion (facultatif)").fill("Revue de la revue");
    await page.getByRole("button", { name: "Lancer le compteur" }).click();
    expect((await query(page)).get("n")).toBe("Revue de la revue");
    await expect(page.getByText("Revue de la revue").first()).toBeVisible();
  });

  test("Configuration : une ligne invalide bloque le lancement et le dit", async ({ page }) => {
    await openAt(page, BASE, S);
    await page.getByLabel("€/heure", { exact: true }).first().fill("12.5");
    await page.getByRole("button", { name: "Lancer le compteur" }).click();
    await expect(timer(page)).toBeHidden();
    await expect(page.getByLabel("€/heure", { exact: true }).first()).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByLabel("€/heure", { exact: true }).first()).toBeFocused();
    await expect(page.getByText("Le taux doit être un nombre entier de 0 à 1000.")).toBeVisible();
  });

  test("Configuration : une suggestion choisie pré-remplit le taux vide", async ({ page }) => {
    await page.goto(BASE);
    const rate = page.getByLabel("€/heure", { exact: true }).first();
    await rate.fill("");
    await page.getByLabel("Qui", { exact: true }).first().fill("Consultant externe");
    await expect(rate).toHaveValue("120");
    // Taux déjà rempli : on n'y touche pas.
    await page.getByLabel("Qui", { exact: true }).first().fill("Patrick");
    await expect(rate).toHaveValue("120");
  });
});

test.describe("reunion-metre · compteur", () => {
  test("CA-3 · deux navigateurs, même URL, même instant : même montant", async ({ browser }) => {
    const url = link(...SOLO, p(48, "Dev"), `s=${S}`, "v=1");
    const contexts: BrowserContext[] = [];
    try {
      const first = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" });
      const second = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris" });
      contexts.push(first, second);
      const pageA = await first.newPage();
      const pageB = await second.newPage();
      // A ouvre le lien à s + 100, B trois secondes plus tard ; on compare à s + 108.
      await openAt(pageA, url, S + 100);
      await openAt(pageB, url, S + 103);
      await pageA.clock.runFor(8000);
      await pageB.clock.runFor(5000);
      const expected = euros(108, 402);
      await expect(digits(pageA)).toHaveText(expected);
      await expect(digits(pageB)).toHaveText(expected);
    } finally {
      for (const context of contexts) await context.close();
    }
  });

  test("CA-4 · le montant change chaque seconde", async ({ page }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 605);
    const seen = [await digits(page).textContent()];
    for (let second = 1; second <= 3; second += 1) {
      await page.clock.runFor(1000);
      await expect(digits(page)).toHaveText(euros(605 + second, 354));
      seen.push(await digits(page).textContent());
    }
    expect(new Set(seen).size).toBe(4);
    await expect(page.getByRole("definition").filter({ hasText: "00:10:08" })).toBeVisible();
  });

  test("CA-4 · prefers-reduced-motion : ni animation ni lueur, le chiffre continue", async ({
    page,
  }) => {
    const glow = () => digits(page).evaluate((element) => getComputedStyle(element).textShadow);
    const sign = page.getByRole("button", { name: "Terminer" });
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 605);
    expect(await glow()).not.toBe("none");
    expect(await sign.evaluate((element) => getComputedStyle(element).animationName)).not.toBe(
      "none",
    );

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await glow()).toBe("none");
    expect(await sign.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
    expect(await sign.evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
    const before = await digits(page).textContent();
    await page.clock.runFor(1000);
    await expect(digits(page)).not.toHaveText(before ?? "");
    await expect(digits(page)).toHaveText(euros(606, 354));
  });

  test("CA-5 · changer le tarif met l'URL à jour et recalcule depuis s", async ({ page }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 1805);
    await expect(digits(page)).toHaveText(euros(1805, 354));
    await page.getByRole("radio", { name: /Aurait pu être un mail/u }).check();
    expect((await query(page)).get("t")).toBe("C");
    expect((await query(page)).get("s")).toBe(String(S));
    await expect(digits(page)).toHaveText(euros(1805, 708));
    // textContent colle <dt> et <dd> : on tolère l'absence de blanc entre les deux.
    await expect(receipt(page)).toContainText(/Aurait pu être un mail\u00a0:\s*OUI/u);
  });

  test("CA-5 · ajouter, retirer, renommer, changer un taux pendant le Compteur", async ({
    page,
  }) => {
    await openAt(page, link("v=1", "t=A", p(100, "Ana"), p(50, "Bob"), `s=${S}`), S + 3600);
    await expect(digits(page)).toHaveText("150,00");

    await page.getByRole("button", { name: "+ quelqu'un qui n'a rien à faire là" }).click();
    let people = (await query(page)).getAll("p");
    expect(people).toEqual(["100|Ana", "50|Bob", "68|Cheffe de projet"]);
    await expect(digits(page)).toHaveText("218,00");
    await expect(page.getByLabel("Qui", { exact: true }).last()).toBeFocused();

    await page.getByLabel("Qui", { exact: true }).nth(1).fill("Bob du marketing");
    await page.getByLabel("€/heure", { exact: true }).nth(1).fill("60");
    people = (await query(page)).getAll("p");
    expect(people).toEqual(["100|Ana", "60|Bob du marketing", "68|Cheffe de projet"]);
    await expect(digits(page)).toHaveText("228,00");

    await page.getByRole("button", { name: "Retirer le participant 1" }).click();
    people = (await query(page)).getAll("p");
    expect(people).toEqual(["60|Bob du marketing", "68|Cheffe de projet"]);
    await expect(digits(page)).toHaveText("128,00");
    expect((await query(page)).get("s")).toBe(String(S));
    await expect(receipt(page)).toContainText(`Café tiède ×${NBSP}2`);
  });

  test("CA-5 · un taux invalide n'entre pas dans le lien", async ({ page }) => {
    await openAt(page, link("v=1", "t=A", p(100, "Ana"), p(50, "Bob"), `s=${S}`), S + 3600);
    await page.getByLabel("€/heure", { exact: true }).nth(1).fill("-4");
    expect((await query(page)).getAll("p")).toEqual(["100|Ana"]);
    await expect(page.getByLabel("€/heure", { exact: true }).nth(1)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // Le seul participant valide restant ne peut pas être retiré.
    await expect(page.getByRole("button", { name: "Retirer le participant 1" })).toBeDisabled();
  });

  test("CA-5 · vider le seul participant : message visible, le lien ne change pas", async ({
    page,
  }) => {
    await openAt(page, link("v=1", "t=A", p(100, "Ana"), `s=${S}`), S + 3600);
    const before = page.url();
    await page.getByLabel("Qui", { exact: true }).fill("");
    await expect(
      page.getByText("Il faut au moins une personne valide autour de la table."),
    ).toBeVisible();
    await expect(page.getByText("Le libellé doit faire de 1 à 40 caractères.")).toBeVisible();
    expect(page.url()).toBe(before);
    await expect(digits(page)).toHaveText("100,00");
    await page.getByLabel("Qui", { exact: true }).fill("Ana bis");
    await expect(page.getByText(/au moins une personne valide/u)).toBeHidden();
    expect((await query(page)).getAll("p")).toEqual(["100|Ana bis"]);
  });

  test("CA-6 · « Terminer » ajoute e = maintenant, affiche le Ticket, le montant est figé", async ({
    page,
  }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 2520);
    await page.getByRole("button", { name: "Terminer" }).click();
    expect((await query(page)).get("e")).toBe(String(S + 2520));
    await expect(page.getByRole("button", { name: "Copier le lien du ticket" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Nouvelle réunion" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Terminer" })).toBeHidden();
    await expect(digits(page)).toHaveText("247,80");
    await page.clock.runFor(120_000);
    await expect(digits(page)).toHaveText("247,80");
    await expect(receipt(page)).toContainText(`247,80${NBSP}€`);
    await expect(receipt(page)).toContainText("09:00 – 09:42");
  });

  test("CA-6 · le lien du Ticket rouvert ailleurs donne le même ticket", async ({ page }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`, `e=${S + 2520}`), S + 99_999);
    await expect(digits(page)).toHaveText("247,80");
    await expect(receipt(page)).toContainText("Kevin");
    await expect(receipt(page)).toContainText(`354${NBSP}€/h`);
  });

  test("Nouvelle réunion : retour à la Configuration avec la même équipe", async ({ page }) => {
    await openAt(
      page,
      link("v=1", "t=C", p(10, "Ana"), `s=${S}`, `e=${S + 60}`, "n=Revue"),
      S + 99,
    );
    await page.getByRole("button", { name: "Nouvelle réunion" }).click();
    await expect(page.getByRole("heading", { name: "Préparer la réunion" })).toBeFocused();
    const params = await query(page);
    expect(params.has("s")).toBe(false);
    expect(params.has("e")).toBe(false);
    await expect(page.getByLabel("Qui", { exact: true })).toHaveValue("Ana");
    await expect(page.getByRole("radio", { name: /Aurait pu être un mail/u })).toBeChecked();
    await page.goBack();
    await expect(page.getByRole("button", { name: "Copier le lien du ticket" })).toBeVisible();
  });
});

test.describe("reunion-metre · copie du lien", () => {
  test("CA-7 · copie l'URL complète, confirmation visible et annoncée", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openAt(page, link("v=1", ...SOLO, `s=${S}`, `e=${S + 2520}`), S + 3000);
    await page.getByRole("button", { name: "Copier le lien du ticket" }).click();
    const status = page.getByText("Lien copié. Collez-le dans le chat de la réunion.");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("aria-live", "polite");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
    expect(page.url()).toContain(`e=${S + 2520}`);
  });

  test("CA-7 · presse-papiers refusé : le lien s'affiche dans un champ sélectionné", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("refusé")) },
      });
    });
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 3000);
    await page.getByRole("button", { name: "Copier le lien du compteur" }).click();
    const field = page.getByLabel("Lien à copier");
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    await expect(field).toHaveValue(page.url());
    const selection = await field.evaluate((element) =>
      element instanceof HTMLInputElement
        ? [element.selectionStart, element.selectionEnd, element.value.length]
        : [],
    );
    expect(selection).toEqual([0, page.url().length, page.url().length]);
    await expect(page.getByText(/Le navigateur refuse la copie/u)).toHaveAttribute(
      "aria-live",
      "polite",
    );
    await expectNoAxeViolation(page);
  });
});

test.describe("reunion-metre · accessibilité du compteur", () => {
  test("CA-8 · role=timer, aria-live=off, résumé mis à jour au plus toutes les 30 s", async ({
    page,
  }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 2520);
    const counter = timer(page);
    await expect(counter).toHaveAttribute("aria-live", "off");
    await expect(counter).toHaveAccessibleName("247 euros et 80 centimes, 42 minutes");
    await page.clock.runFor(5000);
    await expect(digits(page)).toHaveText(euros(2525, 354));

    await page.clock.runFor(24_000);
    await expect(digits(page)).toHaveText(euros(2549, 354));
    await expect(counter).toHaveAccessibleName("247 euros et 80 centimes, 42 minutes");

    await page.clock.runFor(3000);
    await expect(counter).toHaveAccessibleName(/^250 euros et \d+ centimes, 42 minutes$/u);
  });

  for (const [seconds, expected, ghost] of [
    [2520, "247,80", "888,88"],
    [36_000, `3${NBSP}540,00`, `8${NBSP}888,88`],
    [10, "0,98", "8,88"],
  ] as const) {
    test(`CA-9 · ${expected} : des « 8 » fantômes du même nombre de caractères`, async ({
      page,
    }) => {
      await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + seconds);
      await expect(digits(page)).toHaveText(expected);
      await expect(digits(page)).toHaveAttribute("data-ghost", ghost);
      const before = await digits(page).evaluate((element) =>
        getComputedStyle(element, "::before").content.replaceAll('"', ""),
      );
      expect(before).toBe(ghost);
      expect(before.length).toBe(expected.length);
    });
  }

  test("CA-10 · l'étiquette affiche « Look 01/03 » et mène au look suivant", async ({ page }) => {
    await page.goto(BASE);
    const tag = page.getByRole("navigation", { name: "Collection", exact: true });
    await expect(tag).toContainText("Look 01/03", { ignoreCase: true });
    const next = tag.getByRole("link", { name: /Juré Craché/u });
    await expect(next).toHaveAttribute("href", "/collection-paperasse/jure-crache/");
    // Couleurs adaptées au fond sombre : texte clair sur le panneau.
    const colors = await tag.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.color];
    });
    expect(colors).toEqual(["rgb(33, 27, 21)", "rgb(243, 233, 214)"]);
  });
});

test.describe("reunion-metre · CA-11 · tient à 1280 × 720", () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== "desktop", "viewport fixé : une fois suffit");
  });

  const crowd = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      p(40 + index, `Participant au nom assez long ${index + 1}`),
    );

  async function layout(page: Page) {
    return page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (element === null) throw new Error(selector);
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      };
      const list = document.getElementById("people");
      return {
        main: box("main"),
        timer: box('[role="timer"]'),
        finish: box("#finish"),
        receipt: box("#receipt"),
        list: box("#people"),
        listOverflow: list === null ? -1 : list.scrollHeight - list.clientHeight,
        scrollY: window.scrollY,
      };
    });
  }

  for (const count of [1, 5, 8]) {
    test(`CA-11 · ${count} participant(s) : tout l'écran Compteur tient sans défilement`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await openAt(page, link("v=1", "t=B", ...crowd(count), `s=${S}`, "n=Point rapide"), S + 60);
      await page.evaluate(() => document.fonts.ready);
      const box = await layout(page);
      expect(box.main.bottom).toBeLessThanOrEqual(720);
      expect(box.receipt.bottom).toBeLessThanOrEqual(720);
      expect(box.list.bottom).toBeLessThanOrEqual(720);
      expect(box.listOverflow, "la liste ne défile pas jusqu'à 8").toBeLessThanOrEqual(0);
      expect(box.timer.top).toBeGreaterThanOrEqual(0);
      await expect(page.getByLabel("Qui", { exact: true })).toHaveCount(count);
      for (const field of await page.getByLabel("Qui", { exact: true }).all()) {
        await expect(field).toBeInViewport({ ratio: 1 });
      }
    });
  }

  // CA-11 ne garantit l'absence de défilement que jusqu'à 8 : à 9, la liste peut encore tenir.
  for (const count of [12, 30]) {
    test(`CA-11 · ${count} participants : la liste défile dans son cadre, le montant reste visible`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await openAt(page, link("v=1", "t=B", ...crowd(count), `s=${S}`), S + 60);
      await page.evaluate(() => document.fonts.ready);
      const box = await layout(page);
      expect(box.main.bottom).toBeLessThanOrEqual(720);
      expect(box.list.bottom).toBeLessThanOrEqual(720);
      expect(box.listOverflow).toBeGreaterThan(0);
      await expect(timer(page)).toBeInViewport({ ratio: 1 });
      // Défiler dans la liste jusqu'au dernier participant ne fait pas défiler la page.
      await page.getByLabel("Qui", { exact: true }).last().focus();
      await expect(page.getByLabel("Qui", { exact: true }).last()).toBeInViewport();
      await expect(timer(page)).toBeInViewport({ ratio: 1 });
      expect((await layout(page)).scrollY).toBe(0);
    });
  }
});

test.describe("reunion-metre · cas limites", () => {
  test("CL-1 · s dans le futur : Configuration + « Cette réunion n'a pas encore commencé »", async ({
    page,
  }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S + 61}`), S);
    await expect(notices(page).first()).toContainText(
      "Cette réunion n'a pas encore commencé. Profitez-en.",
    );
    await expect(page.getByRole("heading", { name: "Préparer la réunion" })).toBeVisible();
    await expect(page.getByLabel("Qui", { exact: true })).toHaveValue("Kevin");
    await expect(timer(page)).toBeHidden();
  });

  test("CL-1 · s = maintenant + 60 s : toléré, le compteur attend à 0", async ({ page }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S + 60}`), S);
    await expect(digits(page)).toHaveText("0,00");
  });

  test("CL-2 · plus de 24 h sans e : arrêté à 24 h, « Respirez »", async ({ page }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 90_000);
    await expect(page.getByText(/Réunion de plus de 24\sh\. Respirez\./u)).toBeVisible();
    await expect(page.getByRole("definition").filter({ hasText: "24:00:00" })).toBeVisible();
    await expect(digits(page)).toHaveText(`8${NBSP}496,00`);
    await page.clock.runFor(10_000);
    await expect(digits(page)).toHaveText(`8${NBSP}496,00`);
    await page.getByRole("button", { name: "Terminer" }).click();
    expect((await query(page)).get("e")).toBe(String(S + 86_400));
    await expect(page.getByRole("button", { name: "Nouvelle réunion" })).toBeVisible();
  });

  test("CL-2 · le message apparaît au moment où la réunion passe 24 h", async ({ page }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 86_390);
    await expect(page.getByText(/Respirez/u)).toBeHidden();
    await page.clock.runFor(10_000);
    await expect(page.getByText(/Respirez/u)).toBeHidden();
    await page.clock.runFor(1000);
    await expect(page.getByText(/Respirez/u)).toBeVisible();
  });

  for (const [label, end] of [
    ["e = s", S],
    ["e < s", S - 10],
  ] as const) {
    test(`CL-3 · ${label} : e ignoré, retour au Compteur`, async ({ page }) => {
      await openAt(page, link("v=1", ...SOLO, `s=${S}`, `e=${end}`), S + 605);
      await expect(page.getByRole("button", { name: "Terminer" })).toBeVisible();
      await expect(notices(page).first()).toContainText("Heure de fin illisible");
      await page.clock.runFor(1000);
      await expect(digits(page)).toHaveText(euros(606, 354));
    });
  }

  test("CL-4 · 31 participants : les 30 premiers + message", async ({ page }) => {
    const people = Array.from({ length: 31 }, (_, index) => p(index + 1, `P${index + 1}`));
    await openAt(page, link("v=1", "t=A", ...people, `s=${S}`), S + 60);
    await expect(page.getByLabel("Qui", { exact: true })).toHaveCount(30);
    await expect(page.getByLabel("Qui", { exact: true }).last()).toHaveValue("P30");
    await expect(page.getByRole("definition").filter({ hasText: /^30$/u })).toBeVisible();
    await expect(notices(page).first()).toContainText("seuls les 30 premiers sont gardés");
    await expect(
      page.getByRole("button", { name: "+ quelqu'un qui n'a rien à faire là" }),
    ).toBeDisabled();
  });

  test("CL-5 · taux décimal, négatif, 1e3, NaN, sans |, libellé vide ou trop long : ignorés", async ({
    page,
  }) => {
    await openAt(
      page,
      link(
        "v=1",
        "t=A",
        "p=12.5|A",
        "p=-3|B",
        "p=1e3|C",
        "p=NaN|D",
        "p=Kevin",
        "p=12|",
        `p=12|${"x".repeat(41)}`,
        p(50, "Valide"),
        `s=${S}`,
      ),
      S + 60,
    );
    await expect(page.getByLabel("Qui", { exact: true })).toHaveCount(1);
    await expect(page.getByLabel("Qui", { exact: true })).toHaveValue("Valide");
    await expect(notices(page).first()).toContainText("7 participants illisibles ont été ignorés.");
  });

  test("CL-5 · libellé et titre avec du HTML : affichés tels quels, en texte", async ({ page }) => {
    const errors = collectErrors(page);
    const html = "<img src=x onerror=alert(1)>";
    const title = "<script>alert(2)</script>";
    await openAt(
      page,
      link("v=1", p(50, html), `s=${S}`, `e=${S + 60}`, `n=${encodeURIComponent(title)}`),
      S + 120,
    );
    await expect(receipt(page)).toContainText(html);
    await expect(page.getByText(title).first()).toBeVisible();
    expect(await page.locator("main img, main script").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test("CL-5 · caractères bidirectionnels retirés du libellé", async ({ page }) => {
    const rlo = String.fromCodePoint(0x202e);
    await openAt(page, link("v=1", p(50, `Ke${rlo}vin`), `s=${S}`), S + 60);
    await expect(page.getByLabel("Qui", { exact: true })).toHaveValue("Kevin");
  });

  test("CL-11 · deux participants au même libellé : autorisé", async ({ page }) => {
    await openAt(page, link("v=1", "t=A", p(50, "Kevin"), p(40, "Kevin"), `s=${S}`), S + 3600);
    await expect(page.getByLabel("Qui", { exact: true })).toHaveCount(2);
    await expect(page.getByLabel("Qui", { exact: true }).nth(1)).toHaveValue("Kevin");
    await expect(digits(page)).toHaveText("90,00");
    await expect(notices(page).first()).toBeEmpty();
  });

  test("CL-6 · tous les taux à 0 : 0,00 € et « Réunion bénévole. Suspect. »", async ({ page }) => {
    await openAt(page, link("v=1", "t=C", p(0, "Ana"), p(0, "Bob"), `s=${S}`), S + 3600);
    await expect(digits(page)).toHaveText("0,00");
    await expect(page.getByText("Réunion bénévole. Suspect.")).toBeVisible();
    await page.getByLabel("€/heure", { exact: true }).first().fill("10");
    await expect(page.getByText("Réunion bénévole. Suspect.")).toBeHidden();
  });

  test("CL-7 · paramètres en double : on prend le premier", async ({ page }) => {
    await openAt(page, link("v=1", "t=A", "t=C", p(354, "Kevin"), `s=${S}`, `s=${S + 5}`), S + 65);
    await expect(page.getByRole("radio", { name: /Point rapide/u })).toBeChecked();
    await expect(digits(page)).toHaveText(euros(65, 354));
  });

  test("CL-8 · query de plus de 4 Ko : Configuration + « Lien trop long »", async ({ page }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`, `n=${"a".repeat(4100)}`), S + 60);
    await expect(notices(page).first()).toContainText("Lien trop long");
    await expect(page.getByRole("heading", { name: "Préparer la réunion" })).toBeVisible();
    await expect(page.getByLabel("Qui", { exact: true })).toHaveCount(5);
  });

  test("CL-9 · onglet en arrière-plan puis revenu : montant juste immédiatement", async ({
    page,
  }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 65);
    await expect(digits(page)).toHaveText(euros(65, 354));
    // Minuteurs gelés (onglet caché) pendant 10 minutes : l'heure avance, rien ne bat.
    await page.clock.setSystemTime((S + 665) * 1000);
    await expect(digits(page)).toHaveText(euros(65, 354));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(digits(page)).toHaveText(euros(665, 354));
  });

  test("CL-10 · le ticket indique « heure de votre appareil »", async ({ page }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`, `e=${S + 2520}`), S + 3000);
    await expect(receipt(page)).toContainText("Heure de votre appareil");
    await expect(receipt(page)).toContainText("14/10/2025 · 09:00 – 09:42");
  });

  for (const [label, version] of [
    ["absent", null],
    ["2", "2"],
    ["texte", "un"],
  ] as const) {
    test(`v ${label} : Configuration + « Lien d'une version inconnue »`, async ({ page }) => {
      const parts = [...SOLO, `s=${S}`];
      await openAt(page, link(...(version === null ? parts : [`v=${version}`, ...parts])), S + 60);
      await expect(notices(page).first()).toContainText("Lien d'une version inconnue");
      await expect(timer(page)).toBeHidden();
    });
  }
});

test.describe("reunion-metre · qualité sur chaque écran", () => {
  const SCREENS = [
    { name: "Configuration", url: BASE },
    { name: "Compteur", url: link("v=1", "t=B", p(68, "Cheffe"), p(6, "Stagiaire"), `s=${S}`) },
    {
      name: "Ticket",
      url: link("v=1", "t=C", p(68, "Cheffe"), p(6, "Stagiaire"), `s=${S}`, `e=${S + 2520}`),
    },
    {
      name: "Compteur avec messages",
      url: link("v=1", "t=Z", "p=1.5|x", p(0, "Ana"), `s=${S}`, "e=1", `n=${"a".repeat(80)}`),
    },
    { name: "Configuration avec message", url: link("v=1", ...SOLO, `s=${S + 9999}`) },
  ];

  for (const screen of SCREENS) {
    test(`${screen.name} · axe sans violation, sans défilement horizontal, sans erreur`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await openAt(page, screen.url, S + 2600);
      await expectNoAxeViolation(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });

    test(`${screen.name} · typographie française (insécables, pas de tiret cadratin)`, async ({
      page,
    }) => {
      await openAt(page, screen.url, S + 2600);
      const texts = await perceivedTexts(page, page.locator("body"));
      const issues = texts.flatMap(({ where, text }) =>
        typographyIssues(text).map((issue) => `${where} : ${issue}`),
      );
      expect(issues).toEqual([]);
      expect(texts.map((entry) => normalizeSpaces(entry.text)).join(" ")).toContain(
        "Réunion-mètre",
      );
    });
  }

  test("les boutons et champs font au moins 44 px", async ({ page }) => {
    for (const url of [SCREENS[0]?.url ?? BASE, SCREENS[1]?.url ?? BASE, SCREENS[2]?.url ?? BASE]) {
      await openAt(page, url, S + 2600);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("main button, main input:not([type=radio]), main .tariff")]
          .filter((element) => element.getClientRects().length > 0)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              text: element.textContent?.trim() ?? "",
              width: rect.width,
              height: rect.height,
            };
          })
          .filter((rect) => rect.width < 44 || rect.height < 44),
      );
      expect(small).toEqual([]);
    }
  });
});

test.describe("reunion-metre · tour 2", () => {
  const eight = (rate?: number) =>
    Array.from({ length: 8 }, (_, index) =>
      p(rate ?? 40 + index, `Participant au nom assez long ${index + 1}`),
    );

  /** Les 8 champs « Qui » sont entiers à l'écran et la liste ne défile pas (CA-11). */
  async function expectEightFit(page: Page) {
    const who = page.getByLabel("Qui", { exact: true });
    await expect(who).toHaveCount(8);
    for (const field of await who.all()) await expect(field).toBeInViewport({ ratio: 1 });
    await expect(timer(page)).toBeInViewport({ ratio: 1 });
    const state = await page.evaluate(() => {
      const list = document.getElementById("people");
      return {
        listOverflow: list === null ? -1 : list.scrollHeight - list.clientHeight,
        mainBottom: document.querySelector("main")?.getBoundingClientRect().bottom ?? 9999,
        scrollY: window.scrollY,
      };
    });
    expect(state.listOverflow, "la liste des 8 participants ne défile pas").toBeLessThanOrEqual(0);
    expect(state.mainBottom).toBeLessThanOrEqual(720);
    expect(state.scrollY).toBe(0);
  }

  test("CA-11 · pire cas : 8 participants + CL-2 + CL-6 + une notice du lien, sans défilement", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    // Tous les taux à 0 (CL-6), lancé il y a deux jours (CL-2), un participant illisible.
    await openAt(
      page,
      link("v=1", "t=B", ...eight(0), "p=12.5|x", `s=${S}`, "n=Point rapide"),
      S + 2 * 86_400,
    );
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole("status").getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText("Réunion bénévole. Suspect.")).toBeVisible();
    await expect(page.getByText(/Réunion de plus de 24\sh\. Respirez\./u)).toBeVisible();
    await expect(page.getByText("1 participant illisible a été ignoré.")).toBeVisible();
    await expectEightFit(page);
  });

  test("CA-11 · 8 participants + tous les messages possibles + repli de copie : la liste ne défile pas", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "viewport fixé par le test");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    await openAt(
      page,
      link("v=1", "t=Z", ...eight(0), "p=1e3|x", "p=-1|y", `s=${S}`, "e=1", `n=${"a".repeat(61)}`),
      S + 2 * 86_400,
    );
    await page.evaluate(() => document.fonts.ready);
    // Tarif inconnu, titre trop long, participants ignorés, fin illisible + CL-2 + CL-6.
    await expect(page.getByRole("status").getByRole("listitem")).toHaveCount(6);
    await page.getByRole("button", { name: "Copier le lien du compteur" }).click();
    await expect(page.getByLabel("Lien à copier")).toBeVisible();
    await expectEightFit(page);
  });

  test("notices du lien refermables : « Fermer » les retire, le focus va à « Terminer »", async ({
    page,
  }) => {
    await openAt(page, link("v=1", "t=Z", p(10, "Ana"), "p=x|y", `s=${S}`), S + 60);
    const close = page.getByRole("button", { name: "Fermer les messages du lien" });
    await expect(page.getByText("Tarif inconnu", { exact: false })).toBeVisible();
    await close.click();
    await expect(notices(page).first()).toBeEmpty();
    await expect(close).toBeHidden();
    await expect(page.getByRole("button", { name: "Terminer" })).toBeFocused();
    // Sans notice, pas de bouton « Fermer ».
    await openAt(page, link("v=1", p(10, "Ana"), `s=${S}`), S + 60);
    await expect(close).toBeHidden();
  });

  test("notices refermables aussi en Configuration : le focus va au titre de l'écran", async ({
    page,
  }) => {
    await openAt(page, link("v=1", p(10, "Ana"), `s=${S + 9999}`), S);
    await page.getByRole("button", { name: "Fermer les messages du lien" }).click();
    await expect(notices(page).first()).toBeEmpty();
    await expect(page.getByRole("heading", { name: "Préparer la réunion" })).toBeFocused();
  });

  test("URL réécrite sous forme propre : inconnus, doublons, invalides et hash retirés", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const messy = `${link("utm_source=chat", "n=Revue", "t=C", "t=A", "p=12.5|x", p(48, "Quelqu'un"), "v=1", `s=${S}`, `s=${S + 5}`)}#truc`;
    await openAt(page, messy, S + 60);
    const clean = `/collection-paperasse/reunion-metre/?v=1&t=C&p=48|Quelqu%27un&s=${S}&n=Revue`;
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(clean);
    expect(new URL(page.url()).hash).toBe("");
    // Réécrite sur place (replaceState) : Précédent ne ramène pas au lien d'origine.
    const length = await page.evaluate(() => history.length);
    await page.reload();
    expect(await page.evaluate(() => history.length)).toBe(length);
    await page.getByRole("button", { name: "Copier le lien du compteur" }).click();
    await expect(page.getByText("Lien copié. Collez-le dans le chat de la réunion.")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  });

  test("URL réécrite : un lien ignoré en entier redevient l'adresse nue", async ({ page }) => {
    await openAt(page, link("v=2", p(10, "Ana"), `s=${S}`), S + 60);
    await expect(notices(page).first()).toContainText("Lien d'une version inconnue");
    expect(new URL(page.url()).search).toBe("");
  });

  test("Nouvelle réunion : Précédent rend le ticket, puis l'URL suit la Configuration sans nouvelle entrée", async ({
    page,
  }) => {
    await openAt(
      page,
      link("v=1", "t=C", p(10, "Ana"), `s=${S}`, `e=${S + 60}`, "n=Revue"),
      S + 99,
    );
    await page.getByRole("button", { name: "Nouvelle réunion" }).click();
    expect(new URL(page.url()).search).toBe("?v=1&t=C&p=10|Ana&n=Revue");
    await expect(page.getByLabel("Titre de la réunion (facultatif)")).toHaveValue("Revue");
    const length = await page.evaluate(() => history.length);
    await page.getByLabel("€/heure", { exact: true }).fill("25");
    await page.getByRole("radio", { name: /Point rapide/u }).check();
    await page.getByLabel("Titre de la réunion (facultatif)").fill("Rétro");
    expect(new URL(page.url()).search).toBe("?v=1&t=A&p=25|Ana&n=R%C3%A9tro");
    expect(await page.evaluate(() => history.length)).toBe(length);
    await page.goBack();
    await expect(page.getByRole("button", { name: "Copier le lien du ticket" })).toBeVisible();
    expect((await query(page)).get("e")).toBe(String(S + 60));
  });

  test("CL-3 · e dans le futur : ignoré avec message, le compteur tourne", async ({ page }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`, `e=${S + 3600}`), S + 600);
    await expect(page.getByRole("button", { name: "Terminer" })).toBeVisible();
    await expect(notices(page).first()).toContainText(
      `Heure de fin dans le futur${NBSP}: la réunion continue.`,
    );
    expect((await query(page)).has("e")).toBe(false);
  });

  test("CA-6 · Terminer dans la seconde du lancement : e = s + 1, le lien du ticket reste valide", async ({
    page,
  }) => {
    await openAt(page, BASE, S);
    await page.getByRole("button", { name: "Lancer le compteur" }).click();
    await page.getByRole("button", { name: "Terminer" }).click();
    expect((await query(page)).get("e")).toBe(String(S + 1));
    await page.reload();
    await expect(page.getByRole("button", { name: "Copier le lien du ticket" })).toBeVisible();
  });

  test("CL-8 · l'app refuse une modification qui produirait un lien trop long", async ({
    page,
  }) => {
    // 16 libellés de 40 « é » (6 caractères encodés chacun) + 1 de 13 : environ 4 075 caractères.
    const people = [
      ...Array.from({ length: 16 }, () => p(1000, "é".repeat(40))),
      p(1000, "é".repeat(13)),
    ];
    await openAt(page, link("v=1", "t=A", ...people, `s=${S}`), S + 60);
    const before = page.url();
    const length = new URL(before).search.length - 1;
    expect(length).toBeGreaterThan(4096 - 26);
    expect(length).toBeLessThanOrEqual(4096);
    // La suggestion suivante (« Cheffe de projet ») ajoute 26 caractères : refusée.
    await page.getByRole("button", { name: "+ quelqu'un qui n'a rien à faire là" }).click();
    await expect(page.getByText(/Lien trop long\u00a0: raccourcissez/u)).toBeVisible();
    await expect(page.getByLabel("Qui", { exact: true })).toHaveCount(17);
    expect(page.url()).toBe(before);
  });

  test("#form-error est une région live : l'erreur de saisie est annoncée", async ({ page }) => {
    await openAt(page, link("v=1", "t=A", p(100, "Ana"), `s=${S}`), S + 60);
    const error = page.locator("#form-error");
    await expect(error).toHaveAttribute("aria-live", "polite");
    await page.getByLabel("Qui", { exact: true }).fill("");
    await expect(error).toHaveText("Il faut au moins une personne valide autour de la table.");
  });

  test("longueurs en points de code, sans maxlength : 40 emoji acceptés, 41 caractères refusés", async ({
    page,
  }) => {
    await openAt(page, BASE, S);
    const who = page.getByLabel("Qui", { exact: true }).first();
    const title = page.getByLabel("Titre de la réunion (facultatif)");
    await expect(who).not.toHaveAttribute("maxlength");
    await expect(title).not.toHaveAttribute("maxlength");
    await who.fill("🥙".repeat(40));
    await expect(who).not.toHaveAttribute("aria-invalid");
    expect((await query(page)).getAll("p")[0]).toBe(`68|${"🥙".repeat(40)}`);
    await who.fill("x".repeat(41));
    await expect(who).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Le libellé doit faire de 1 à 40 caractères.")).toBeVisible();
    await title.fill("🎉".repeat(60));
    await expect(title).not.toHaveAttribute("aria-invalid");
    await title.fill("a".repeat(61));
    await expect(title).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Le titre fait 60 caractères au maximum.")).toBeVisible();
    await title.fill("🎉".repeat(60));
    await who.fill("Kevin");
    await page.getByRole("button", { name: "Lancer le compteur" }).click();
    expect((await query(page)).get("n")).toBe("🎉".repeat(60));
  });

  test("libellé invisible dans le lien (U+200B, U+3164, U+2800) : participant ignoré", async ({
    page,
  }) => {
    const invisible = [0x200b, 0x3164, 0x2800].map((code) => String.fromCodePoint(code)).join("");
    await openAt(page, link("v=1", p(1000, invisible), p(10, "Ana"), `s=${S}`), S + 60);
    await expect(page.getByLabel("Qui", { exact: true })).toHaveCount(1);
    await expect(notices(page).first()).toContainText("1 participant illisible a été ignoré.");
  });

  test("U+061C retiré du titre (bidi)", async ({ page }) => {
    const alm = String.fromCodePoint(0x061c);
    await openAt(
      page,
      link("v=1", p(10, "Ana"), `s=${S}`, `n=${encodeURIComponent(`${alm}Revue${alm}`)}`),
      S + 60,
    );
    await expect(page.locator("#subtitle")).toHaveText("Revue");
  });

  test("ticket : les lignes sont construites une fois, seuls les montants changent", async ({
    page,
  }) => {
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 605);
    const lines = receipt(page).locator("#receipt-lines");
    await lines.evaluate((element) => {
      // Marque posée sur les nœuds actuels : elle disparaîtrait s'ils étaient recréés.
      for (const child of element.querySelectorAll("dt, dd")) child.setAttribute("data-mark", "1");
    });
    const before = await lines.locator("dd").allTextContents();
    await page.clock.runFor(3000);
    await expect(digits(page)).toHaveText(euros(608, 354));
    const after = await lines.locator("dd").allTextContents();
    expect(after).not.toEqual(before);
    expect(await lines.locator("dt:not([data-mark]), dd:not([data-mark])").count()).toBe(0);
  });

  test("Doto pour tous les chiffres hors ticket : montant, durée, personnes, €/heure, taux", async ({
    page,
  }) => {
    const family = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((element) => getComputedStyle(element).fontFamily);
    await openAt(page, link("v=1", ...SOLO, `s=${S}`), S + 605);
    for (const selector of ["#amount", "#clock", "#count", "#hourly", "input.rate-input"]) {
      expect(await family(selector), selector).toMatch(/^"?Doto/u);
    }
    expect(await family("#receipt-total")).toMatch(/JetBrains Mono/u);
    await openAt(page, BASE, S);
    expect(await family("#hourly-preview")).toMatch(/^"?Doto/u);
  });

  test("afficheur : « € » avant le montant, milliers en U+00A0", async ({ page }) => {
    await openAt(page, link("v=1", "t=A", p(1000, "Board"), `s=${S}`), S + 5 * 3600 + 1800);
    expect(normalizeSpaces(await timer(page).innerText()).replace(/\s+/gu, " ")).toBe("€ 5 500,00");
    await expect(digits(page)).toHaveText(`5${NBSP}500,00`);
    await expect(page.locator("#hourly")).toHaveText(`1${NBSP}000${NBSP}€`);
  });
});
