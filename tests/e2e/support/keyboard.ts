import type { Locator, Page } from "@playwright/test";

/** Va au lien `link` au clavier depuis le haut de la page. Échoue s'il n'est jamais atteint. */
export async function tabTo(page: Page, link: Locator, maxPresses = 40) {
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
