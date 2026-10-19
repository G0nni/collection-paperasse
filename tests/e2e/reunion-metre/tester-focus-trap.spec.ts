// Réunion-mètre, repli de copie : focus piégé (agent tester, tour 3 de Juré Craché). Le copieur
// (packages/shared/src/copy.ts) est partagé : depuis le tour 3 de Juré Craché, c'est lui qui
// piège Tab et Maj+Tab dans son <dialog> modal, pour les deux looks. Ces tests vérifient le
// Réunion-mètre livré (spec reunion-metre, « Écrans », repli de copie ; CA-7), sur le Compteur
// et sur le Ticket. Sélecteurs par rôle et nom accessible ; temps figé par page.clock.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/** Mercredi 14 octobre 2026, 10:00 à Paris. */
const NOW_MS = Date.UTC(2026, 9, 14, 8, 0, 0);
const NOW = NOW_MS / 1000;

const TEAM = "p=68|Cheffe%20de%20projet&p=48|Kevin%20du%20marketing&p=6|Stagiaire";
const SCREENS = [
  ["Compteur", `v=1&t=B&${TEAM}&s=${NOW - 600}`, /Copier le lien du compteur/u],
  ["Ticket", `v=1&t=B&${TEAM}&s=${NOW - 600}&e=${NOW - 60}`, /Copier le lien du ticket/u],
] as const;

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(`pageerror : ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console : ${message.text()}`);
  });
});
test.afterEach(({ page }) => {
  expect(pageErrors.get(page) ?? [], "erreurs JS ou console").toEqual([]);
});

async function openWithRefusedClipboard(page: Page, search: string) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new DOMException("refus", "NotAllowedError")),
    });
  });
  await page.clock.setFixedTime(NOW_MS);
  await page.goto(`reunion-metre/?${search}`);
  await page.evaluate(() => document.fonts.ready);
}

/** Le focus est dans le dialogue, et la page a toujours le focus (pas parti vers le navigateur). */
async function focusInside(dialog: Locator): Promise<boolean> {
  return dialog.evaluate(
    (element) => document.hasFocus() && element.contains(document.activeElement),
  );
}

test.describe("reunion-metre · repli de copie : focus piégé (copieur partagé)", () => {
  for (const [screen, search, copyName] of SCREENS) {
    test(`CA-7 · ${screen} : Tab boucle du champ à « Fermer » puis revient au champ, sans sortir`, async ({
      page,
    }) => {
      await openWithRefusedClipboard(page, search);
      const copy = page.getByRole("button", { name: copyName });
      await copy.click();
      const dialog = page.getByRole("dialog");
      const input = dialog.getByRole("textbox", { name: /Lien à copier/u });
      const close = dialog.getByRole("button", { name: /^Fermer/u });
      await expect(input).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(input).toBeFocused();
      for (let press = 0; press < 6; press += 1) {
        await page.keyboard.press("Tab");
        expect(await focusInside(dialog), `Tab n° ${press + 3}`).toBe(true);
      }
    });

    test(`CA-7 · ${screen} : Maj+Tab depuis le champ boucle sur « Fermer », puis reste dedans`, async ({
      page,
    }) => {
      await openWithRefusedClipboard(page, search);
      await page.getByRole("button", { name: copyName }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("textbox", { name: /Lien à copier/u })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.getByRole("button", { name: /^Fermer/u })).toBeFocused();
      for (let press = 0; press < 6; press += 1) {
        await page.keyboard.press("Shift+Tab");
        expect(await focusInside(dialog), `Maj+Tab n° ${press + 2}`).toBe(true);
      }
    });

    test(`CA-7 · ${screen} : après un clic sur le texte du dialogue, Tab et Maj+Tab ne sortent pas`, async ({
      page,
    }) => {
      await openWithRefusedClipboard(page, search);
      await page.getByRole("button", { name: copyName }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("heading").first().click();
      for (const key of ["Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
        await page.keyboard.press(key);
        expect(await focusInside(dialog), key).toBe(true);
      }
    });

    test(`CA-7 · ${screen} : repli fermé, Tab quitte le bouton de copie vers la suite de la page`, async ({
      page,
    }) => {
      await openWithRefusedClipboard(page, search);
      const copy = page.getByRole("button", { name: copyName });
      await copy.click();
      await page.keyboard.press("Escape");
      await expect(copy).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(copy).not.toBeFocused();
      const where = await page.evaluate(() => ({
        inDialog: (document.activeElement?.closest("dialog") ?? null) !== null,
        isBody: document.activeElement === document.body,
      }));
      expect(where).toEqual({ inDialog: false, isBody: false });
    });

    test(`axe · ${screen} : repli de copie ouvert`, async ({ page }) => {
      await openWithRefusedClipboard(page, search);
      await page.getByRole("button", { name: copyName }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
  }
});
