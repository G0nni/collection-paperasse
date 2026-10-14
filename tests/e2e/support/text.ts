// Textes perçus d'une page et typographie française. L'oracle est celui de la collection
// (packages/shared/src/typography.ts) : un seul oracle, pour les tests unitaires et les e2e.
import type { Locator, Page } from "@playwright/test";
import {
  findTypographyIssues,
  formatTypographyIssue,
} from "../../../packages/shared/src/typography";

export const NBSP = String.fromCodePoint(0xa0);
export const NARROW_NBSP = String.fromCodePoint(0x202f);
export const EM_DASH = String.fromCodePoint(0x2014);

/** Les insécables comptent comme des espaces quand on compare au texte de la spec. */
export function normalizeSpaces(text: string): string {
  return text.replaceAll(NBSP, " ").replaceAll(NARROW_NBSP, " ").replace(/\s+/gu, " ").trim();
}

/** Fautes typographiques d'un texte, sous forme de messages lisibles. */
export function typographyIssues(text: string): string[] {
  return findTypographyIssues(text).map(formatTypographyIssue);
}

/** Tous les textes perçus de la page : rendu (innerText), attributs lus par les lecteurs d'écran. */
export async function perceivedTexts(page: Page, root: Locator) {
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
