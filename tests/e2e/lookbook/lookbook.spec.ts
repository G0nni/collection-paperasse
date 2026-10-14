// Tests du lookbook écrits par le builder (specs/lookbook.md). Les garde-fous communs
// (CSP, axe, requêtes tierces, tour des étiquettes) sont dans tests/e2e/collection.spec.ts.
import { expect, test, type Page } from "@playwright/test";

const looks = [
  { label: "Look 01", name: "Réunion-mètre", slug: "reunion-metre" },
  { label: "Look 02", name: "Juré Craché", slug: "jure-crache" },
  { label: "Look 03", name: "Le SAV de ta vie", slug: "sav-de-ta-vie" },
];

async function cardBoxes(page: Page) {
  const cards = page.locator("main article");
  await expect(cards).toHaveCount(3);
  const boxes = [];
  for (const card of await cards.all()) {
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    if (box !== null) boxes.push(box);
  }
  return boxes;
}

test.describe("lookbook", () => {
  test("CA-1 : chaque lien mène à la bonne app, sous la base de la collection", async ({
    page,
  }) => {
    for (const look of looks) {
      await page.goto("");
      const link = page.getByRole("link", { name: new RegExp(look.label) });
      await expect(link).toHaveAccessibleName(`Essayer le ${look.label}, ${look.name}`);
      await expect(link).toHaveAttribute("href", `/collection-paperasse/${look.slug}/`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/collection-paperasse/${look.slug}/$`));
      await expect(page.getByRole("navigation", { name: "Collection" })).toContainText(
        `${look.label}/03`,
      );
    }
  });

  test("CA-2 : les cartes s'empilent à 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("");
    const [first, second, third] = await cardBoxes(page);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("trois cartes attendues");
    }
    expect(second.y).toBeGreaterThan(first.y + first.height - 1);
    expect(third.y).toBeGreaterThan(second.y + second.height - 1);
    expect(Math.abs(second.x - first.x)).toBeLessThan(1);
    expect(first.x + first.width).toBeLessThanOrEqual(360);
  });

  test("CA-2 : trois colonnes à partir de 960 px", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 900 });
    await page.goto("");
    const [first, second, third] = await cardBoxes(page);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("trois cartes attendues");
    }
    expect(Math.abs(second.y - first.y)).toBeLessThan(1);
    expect(Math.abs(third.y - first.y)).toBeLessThan(1);
    expect(second.x).toBeGreaterThan(first.x + first.width - 1);
    expect(third.x).toBeGreaterThan(second.x + second.width - 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("CA-3 : les polices sont servies par le site lui-même", async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "http://localhost").origin;
    const fonts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") fonts.push(request.url());
    });
    await page.goto("");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    expect(fonts.length).toBeGreaterThan(0);
    for (const url of fonts) {
      expect(new URL(url).origin).toBe(origin);
    }
  });

  test("affiche l'en-tête, les fiches défilé et le pied de page de la spec", async ({ page }) => {
    await page.goto("");
    await expect(page.locator("h1")).toHaveText("Collection Paperasse");
    const banner = page.getByRole("banner");
    await expect(banner).toContainText("Avis à la population");
    await expect(banner).toContainText("Automne-Hiver 2026");
    await expect(banner).toContainText(
      "Trois documents officiels. Aucune valeur. Zéro inscription.",
    );

    const sheets = page.locator("main dl");
    await expect(sheets).toHaveCount(3);
    await expect(sheets.nth(0)).toContainText("papier thermique 80 mm");
    await expect(sheets.nth(0)).toContainText("0 € (mais la réunion, elle, coûte cher)");
    await expect(sheets.nth(1)).toContainText("un kebab, selon l'issue");
    await expect(sheets.nth(2)).toContainText("0 €, SLA non garanti");

    const footer = page.getByRole("contentinfo");
    await expect(footer).toContainText("Aucun cookie, aucun compte, aucun serveur.");
    await expect(footer).toContainText("Prochaine collection : bientôt.");
    await expect(footer.getByRole("link", { name: /GitHub/ })).toHaveAttribute(
      "href",
      "https://github.com/G0nni/collection-paperasse",
    );
  });

  test("n'affiche pas d'étiquette de collection (le lookbook est la racine)", async ({ page }) => {
    await page.goto("");
    await expect(page.getByRole("navigation", { name: "Collection" })).toHaveCount(0);
  });

  test("garde les fiches et les liens droits, seuls l'affiche et les aperçus penchent", async ({
    page,
  }) => {
    await page.goto("");
    const transformOf = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((element) => getComputedStyle(element).transform);
    expect(await transformOf("main .label")).toBe("none");
    expect(await transformOf("main a")).toBe("none");
    expect(await transformOf("footer > *")).toBe("none");
    expect(await transformOf("header")).not.toBe("none");
  });
});
