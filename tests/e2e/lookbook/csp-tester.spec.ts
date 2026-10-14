// Tests de l'agent tester (tour 3) : la CSP « fermée » (security, tour 2, M2) et les outils qui
// la contrôlent (support/csp.ts, scripts/check-csp.mjs lancé par deploy.yml). CLAUDE.md,
// Sécurité : « Scripts, styles, polices et images ne sont autorisés que sous le préfixe de la
// collection ». Un contrôle qui ne regarde que les directives qu'il connaît laisse passer une
// directive plus précise qui les remplace : script-src-elem prime sur script-src pour les
// <script>, object-src ou frame-src priment sur default-src.
import { expect, test, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cspProblems, parseCsp, readCsp } from "../support/csp";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INSIDE = "/collection-paperasse/__csp-probe/";
const EVIL = "https://evil.example/";

/** Lecture du HTML et outils : indépendants de la largeur d'écran. */
function desktopOnly() {
  test.skip(test.info().project.name !== "desktop", "lecture du HTML : une fois suffit");
}

/** Directives ajoutées à une CSP correcte, chacune suffit à l'élargir. */
const WIDENINGS: readonly { name: string; directive: string }[] = [
  { name: "script-src-elem distant", directive: `script-src-elem ${EVIL}` },
  { name: "script-src-attr inline", directive: "script-src-attr 'unsafe-inline'" },
  { name: "style-src-elem distant", directive: `style-src-elem ${EVIL}` },
  { name: "style-src-attr distant", directive: `style-src-attr ${EVIL}` },
  { name: "object-src distant", directive: `object-src ${EVIL}` },
  { name: "frame-src distant", directive: `frame-src ${EVIL}` },
  { name: "child-src distant", directive: `child-src ${EVIL}` },
  { name: "worker-src distant", directive: `worker-src ${EVIL}` },
  { name: "media-src distant", directive: `media-src ${EVIL}` },
  { name: "manifest-src distant", directive: `manifest-src ${EVIL}` },
];

/** La CSP du lookbook construit, telle quelle (meta décodée). */
function lookbookPolicy(): string {
  const html = readFileSync(join(ROOT, "site", "index.html"), "utf8");
  // readCsp lève une erreur s'il n'y a pas exactement une meta.
  readCsp(html);
  const match = /content="(default-src[^"]*)"/u.exec(html);
  if (match?.[1] === undefined) throw new Error("meta CSP du lookbook introuvable");
  return match[1];
}

function runCheckCsp(...args: string[]) {
  return spawnSync(process.execPath, [join(ROOT, "scripts", "check-csp.mjs"), ...args], {
    encoding: "utf8",
  });
}

test.describe("lookbook · CSP tester tour 3 · outils de contrôle", () => {
  test("CA-3 · la CSP construite du lookbook passe cspProblems (témoin)", ({ baseURL }) => {
    desktopOnly();
    const prefix = new URL(baseURL ?? "http://127.0.0.1:4321/collection-paperasse/").href;
    expect(cspProblems(parseCsp(lookbookPolicy()), prefix)).toEqual([]);
  });

  for (const { name, directive } of WIDENINGS) {
    test(`CA-3 · cspProblems refuse une directive en plus : ${name}`, ({ baseURL }) => {
      desktopOnly();
      const prefix = new URL(baseURL ?? "http://127.0.0.1:4321/collection-paperasse/").href;
      const policy = `${lookbookPolicy()} ${directive};`;
      expect(cspProblems(parseCsp(policy), prefix), policy).not.toEqual([]);
    });
  }

  // Un nonce figé dans du HTML statique est public : il autorise n'importe quel script inline
  // qui le recopie.
  for (const directive of ["script-src", "style-src"]) {
    test(`CA-3 · cspProblems refuse un nonce dans ${directive}`, ({ baseURL }) => {
      desktopOnly();
      const prefix = new URL(baseURL ?? "http://127.0.0.1:4321/collection-paperasse/").href;
      const policy = lookbookPolicy().replace(
        `${directive} ${prefix}`,
        `${directive} ${prefix} 'nonce-abc'`,
      );
      expect(policy).toContain("'nonce-abc'");
      expect(cspProblems(parseCsp(policy), prefix), policy).not.toEqual([]);
    });
  }

  test("CA-3 · check-csp.mjs refuse une page dont une directive en plus élargit la CSP", ({
    baseURL,
  }) => {
    desktopOnly();
    const prefix = new URL(baseURL ?? "http://127.0.0.1:4321/collection-paperasse/").href;
    const good = readFileSync(join(ROOT, "site", "index.html"), "utf8");
    const dir = mkdtempSync(join(tmpdir(), "check-csp-tester-"));
    try {
      WIDENINGS.forEach(({ directive }, index) => {
        const forged = good.replace("default-src 'none';", `default-src 'none'; ${directive};`);
        expect(forged, directive).not.toBe(good);
        writeFileSync(join(dir, `elargie-${index}.html`), forged);
      });
      const result = runCheckCsp(dir, prefix);
      expect(result.status, result.stdout).toBe(1);
      WIDENINGS.forEach(({ directive }, index) => {
        expect(result.stderr, directive).toContain(`elargie-${index}.html`);
      });
      expect(result.stdout).not.toContain("ok :");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("CA-3 · check-csp.mjs refuse meta en double, hors <head>, après une ressource, ou en report-only", ({
    baseURL,
  }) => {
    desktopOnly();
    const prefix = new URL(baseURL ?? "http://127.0.0.1:4321/collection-paperasse/").href;
    const good = readFileSync(join(ROOT, "site", "index.html"), "utf8");
    const meta = /<meta http-equiv="content-security-policy"[^>]*>/u.exec(good)?.[0] ?? "";
    expect(meta).not.toBe("");
    const withoutMeta = good.replace(meta, "");
    const cases: Record<string, string> = {
      double: good.replace(meta, `${meta}${meta}`),
      "hors-head": withoutMeta.replace("</body>", `${meta}</body>`),
      "apres-ressource": withoutMeta.replace(
        "</head>",
        `<script src="${prefix}x.js"></script>${meta}</head>`,
      ),
      "report-only": good.replace(
        'http-equiv="content-security-policy"',
        'http-equiv="content-security-policy-report-only"',
      ),
    };
    const dir = mkdtempSync(join(tmpdir(), "check-csp-tester-"));
    try {
      for (const [name, html] of Object.entries(cases)) {
        expect(html, name).not.toBe(good);
        writeFileSync(join(dir, `${name}.html`), html);
      }
      const result = runCheckCsp(dir, prefix);
      expect(result.status).toBe(1);
      for (const name of Object.keys(cases)) {
        expect(result.stderr, name).toContain(`${name}.html`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Violations CSP de la page, dès le premier octet. */
async function recordViolations(page: Page) {
  await page.addInitScript(() => {
    const store: string[] = [];
    Reflect.set(window, "__violations", store);
    document.addEventListener("securitypolicyviolation", (event) => {
      store.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
}

async function violatedDirectives(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store: unknown = Reflect.get(window, "__violations");
    return Array.isArray(store) ? store.map((entry) => String(entry).split(" ")[0] ?? "") : [];
  });
}

// security, tour 2, M2 : « default-src 'none'; connect-src 'none'; base-uri 'none';
// form-action 'none' ». csp.spec.ts couvre fetch, iframe et audio sous le préfixe ; ici le reste,
// sur l'écran de la spec (le lookbook), dans les deux largeurs.
test.describe("lookbook · CSP tester tour 3 · CSP fermée dans le navigateur", () => {
  test("CA-3 · fetch vers un autre dépôt du même hôte : bloqué", async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "http://127.0.0.1:4321").origin;
    await recordViolations(page);
    await page.goto("");
    const outcome = await page.evaluate(async (url) => {
      try {
        await fetch(url);
        return "load";
      } catch {
        return "error";
      }
    }, `${origin}/autre-depot/data.json`);
    expect(outcome).toBe("error");
    expect(await violatedDirectives(page)).toContain("connect-src");
  });

  test("CA-3 · envoi d'un formulaire, même sous le préfixe : bloqué", async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "http://127.0.0.1:4321").origin;
    await recordViolations(page);
    await page.goto("");
    const before = page.url();
    await page.evaluate((action) => {
      const form = document.createElement("form");
      form.method = "get";
      // eslint-disable-next-line no-restricted-syntax -- sonde CSP construite par le test
      form.setAttribute("action", action);
      document.body.append(form);
      form.submit();
    }, `${origin}${INSIDE}envoi`);
    await expect.poll(() => violatedDirectives(page)).toContain("form-action");
    expect(page.url()).toBe(before);
  });

  test("CA-3 · <base> injecté : refusé, les liens relatifs ne changent pas de cible", async ({
    page,
  }) => {
    await recordViolations(page);
    await page.goto("");
    const before = await page.evaluate(() => document.baseURI);
    const after = await page.evaluate((href) => {
      const base = document.createElement("base");
      // eslint-disable-next-line no-restricted-syntax -- sonde CSP construite par le test
      base.setAttribute("href", href);
      document.head.prepend(base);
      return document.baseURI;
    }, EVIL);
    expect(after).toBe(before);
    await expect.poll(() => violatedDirectives(page)).toContain("base-uri");
  });

  test("CA-3 · <object> et <embed>, même sous le préfixe : bloqués", async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "http://127.0.0.1:4321").origin;
    await recordViolations(page);
    await page.goto("");
    await page.evaluate((url) => {
      const object = document.createElement("object");
      object.setAttribute("data", url);
      object.setAttribute("type", "text/html");
      const embed = document.createElement("embed");
      // eslint-disable-next-line no-restricted-syntax -- sonde CSP construite par le test
      embed.setAttribute("src", url);
      embed.setAttribute("type", "text/html");
      document.body.append(object, embed);
    }, `${origin}${INSIDE}objet.html`);
    await expect
      .poll(async () => (await violatedDirectives(page)).filter((d) => d === "object-src").length)
      .toBe(2);
  });
});
