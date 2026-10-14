// CSP de toute la collection (les 4 pages), vérifiée dans le navigateur et pas seulement en
// lisant la meta (CLAUDE.md, Sécurité) : « Scripts, styles, polices et images ne sont autorisés
// que sous le préfixe de la collection (sur g0nni.github.io, 'self' couvrirait tous les repos
// Pages du compte) ». On injecte des ressources du même hôte, hors du préfixe, et on vérifie
// que le navigateur les bloque ; une sonde sous le préfixe sert de témoin positif (sinon un
// test qui bloque tout passerait aussi).
//
// Tour 3 : fusion de tests/e2e/lookbook/csp.spec.ts et de la partie CSP de collection.spec.ts
// (reviewer, tour 2). La meta est lue par l'unique analyseur, support/csp.ts.
import { expect, test, type Page, type Route } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cspProblems, findCspMetas, hashSources, readCsp } from "./support/csp";

const PAGES = [
  { path: "", name: "lookbook" },
  { path: "reunion-metre/", name: "reunion-metre" },
  { path: "jure-crache/", name: "jure-crache" },
  { path: "sav-de-ta-vie/", name: "sav-de-ta-vie" },
];

/** Même hôte, hors du préfixe : un autre dépôt Pages, et un nom qui commence pareil. */
const OUTSIDE = ["/autre-depot/", "/collection-paperasse-evil/", "/"];
const INSIDE = "/collection-paperasse/__csp-probe/";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ASSETS = join(ROOT, "site", "_astro");

/** Une vraie police du site, servie par la sonde font (lue à la demande, pas au chargement). */
function probeFont(): Buffer {
  const woff2 = readdirSync(ASSETS).find((file) => file.endsWith(".woff2"));
  if (woff2 === undefined) {
    throw new Error(
      `Aucun .woff2 dans ${ASSETS} : la sonde font n'a rien à servir. Lance \`pnpm build:e2e\`.`,
    );
  }
  return readFileSync(join(ASSETS, woff2));
}

// PNG 1 × 1 transparent.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Les tests qui ne font que lire le HTML ne dépendent pas de la largeur d'écran. */
function desktopOnly() {
  test.skip(test.info().project.name !== "desktop", "lecture du HTML : une fois suffit");
}

const sha256 = (content: string | Buffer) =>
  `'sha256-${createHash("sha256").update(content).digest("base64")}'`;

/**
 * Hashes qu'Astro 7 ajoute toujours à script-src : ceux de ses 5 directives client, sans
 * option pour les retirer. Adaptation de test décidée par l'orchestrateur à l'issue du tour 2
 * et documentée dans CLAUDE.md (Sécurité, « Exception connue ») : « Ils sont tolérés ; les tests
 * les acceptent via une liste blanche calculée depuis astro/runtime/client/*.prebuilt.js, tout
 * autre hash fait échouer les tests. » Calculée, pas recopiée : une montée de version d'Astro
 * qui change ces scripts change la liste avec eux.
 */
async function astroDirectiveHashes(): Promise<string[]> {
  // astro n'est pas une dépendance de la racine : on le résout depuis le lookbook.
  const require = createRequire(join(ROOT, "apps", "lookbook", "package.json"));
  const hashes: string[] = [];
  for (const directive of ["idle", "load", "media", "only", "visible"]) {
    const file = require.resolve(`astro/client/${directive}.prebuilt.js`);
    const module: unknown = await import(pathToFileURL(file).href);
    const script: unknown = Reflect.get(Object(module), "default");
    if (typeof script !== "string" || script === "") {
      throw new Error(`${file} n'exporte pas le script de la directive ${directive}.`);
    }
    hashes.push(sha256(script));
  }
  return hashes;
}

/** Hashes des scripts de la page : inline, et `<script src>` servis sous le préfixe. */
async function pageScriptHashes(
  html: string,
  pageUrl: string,
  prefix: string,
  fetchText: (url: string) => Promise<string>,
): Promise<string[]> {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(match[1] ?? "");
    if (src === null) {
      hashes.push(sha256(match[2] ?? ""));
      continue;
    }
    const url = new URL(src[1] ?? src[2] ?? src[3] ?? "", pageUrl).href;
    if (url.startsWith(prefix)) hashes.push(sha256(await fetchText(url)));
  }
  return hashes;
}

/** Hashes de script-src que rien n'explique : doit rester vide. */
function unexpectedHashes(hashes: readonly string[], allowed: readonly string[]): string[] {
  return hashes.filter((hash) => !allowed.includes(hash));
}

/** Sert les sondes (`__probe.*`) quel que soit le chemin, pour que seule la CSP décide. */
async function serveProbes(page: Page) {
  await page.route(
    (url) => url.pathname.includes("__probe."),
    async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith(".js")) {
        await route.fulfill({
          contentType: "text/javascript",
          body: `window.__probes = (window.__probes || []).concat(${JSON.stringify(url.pathname)});`,
        });
      } else if (url.pathname.endsWith(".css")) {
        await route.fulfill({ contentType: "text/css", body: ":root { --probe: 1; }" });
      } else if (url.pathname.endsWith(".png")) {
        await route.fulfill({ contentType: "image/png", body: PNG });
      } else {
        await route.fulfill({ contentType: "font/woff2", body: probeFont() });
      }
    },
  );
}

/** Enregistre les violations CSP dans la page, dès le premier octet. */
async function recordViolations(page: Page) {
  await page.addInitScript(() => {
    const store: string[] = [];
    Reflect.set(window, "__violations", store);
    document.addEventListener("securitypolicyviolation", (event) => {
      store.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
}

async function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store: unknown = Reflect.get(window, "__violations");
    return Array.isArray(store) ? store.map(String) : [];
  });
}

/** Charge une ressource du type donné depuis `href` ; renvoie « load » ou « error ». */
async function load(page: Page, kind: "script" | "style" | "image" | "font", href: string) {
  return page.evaluate(
    async ({ kind, href }) => {
      if (kind === "font") {
        try {
          await new FontFace("Probe", `url(${href})`).load();
          return "load";
        } catch {
          return "error";
        }
      }
      // Sondes construites par le test (pas de donnée utilisateur) : le but est justement de
      // charger une URL interdite et de voir la CSP la bloquer.
      let element: HTMLScriptElement | HTMLLinkElement | HTMLImageElement;
      if (kind === "script") {
        element = document.createElement("script");
        // eslint-disable-next-line no-restricted-syntax -- sonde CSP construite par le test
        element.setAttribute("src", href);
      } else if (kind === "style") {
        element = document.createElement("link");
        element.setAttribute("rel", "stylesheet");
        // eslint-disable-next-line no-restricted-syntax -- sonde CSP construite par le test
        element.setAttribute("href", href);
      } else {
        element = document.createElement("img");
        element.setAttribute("alt", "");
        // eslint-disable-next-line no-restricted-syntax -- sonde CSP construite par le test
        element.setAttribute("src", href);
      }
      const outcome = new Promise<string>((resolve) => {
        element.addEventListener("load", () => resolve("load"));
        element.addEventListener("error", () => resolve("error"));
      });
      document.head.append(element);
      return outcome;
    },
    { kind, href },
  );
}

const KINDS = [
  { kind: "script", file: "__probe.js", directive: "script-src-elem" },
  { kind: "style", file: "__probe.css", directive: "style-src-elem" },
  { kind: "image", file: "__probe.png", directive: "img-src" },
  { kind: "font", file: "__probe.woff2", directive: "font-src" },
] as const;

for (const { path, name } of PAGES) {
  test.describe(`CSP · ${name}`, () => {
    test("CA-3 · la meta CSP est unique, dans <head>, avant toute ressource", async ({
      request,
    }) => {
      desktopOnly();
      const html = await (await request.get(path)).text();
      const metas = findCspMetas(html);
      expect(metas).toHaveLength(1);
      const metaIndex = metas[0]?.index ?? -1;
      const headEnd = html.indexOf("</head>");
      expect(metaIndex).toBeGreaterThan(-1);
      expect(metaIndex).toBeLessThan(headEnd);
      // Une meta CSP ne protège que ce qui la suit : rien ne doit être chargé avant elle.
      const firstResource = html.search(/<(?:link|script|style|img|iframe|object|embed|base)\b/iu);
      expect(firstResource === -1 || firstResource > metaIndex, "ressource avant la CSP").toBe(
        true,
      );
    });

    // security, tour 2, M2 : tout fermé par défaut, rien en 'self' (qui couvrirait tout
    // g0nni.github.io) ; scripts, styles, polices et images seulement sous le préfixe.
    test("CA-3 · CSP stricte : 'none' par défaut, ressources sous le préfixe seulement", async ({
      request,
      baseURL,
    }) => {
      desktopOnly();
      const prefix = new URL(baseURL ?? "http://127.0.0.1:4321/collection-paperasse/").href;
      const csp = readCsp(await (await request.get(path)).text());
      expect(cspProblems(csp, prefix)).toEqual([]);
      expect(csp.has("object-src"), "couvert par default-src 'none'").toBe(false);
    });

    test("CA-3 · aucun attribut style dans le HTML construit", async ({ request }) => {
      desktopOnly();
      const html = await (await request.get(path)).text();
      const styleAttributes = [...html.matchAll(/<[^>]*\sstyle\s*=[^>]*>/giu)].map((m) => m[0]);
      expect(styleAttributes).toEqual([]);
    });

    // CLAUDE.md : scripts autorisés seulement sous le préfixe. Un hash de script-src autorise un
    // script inline, hors préfixe : il n'est acceptable que s'il est expliqué (voir
    // astroDirectiveHashes pour l'exception documentée).
    test("CA-3 · chaque hash de script-src est un script de la page ou une directive d'Astro", async ({
      request,
      baseURL,
    }) => {
      desktopOnly();
      const prefix = new URL(baseURL ?? "http://127.0.0.1:4321/collection-paperasse/").href;
      const pageUrl = new URL(path, prefix).href;
      const html = await (await request.get(path)).text();
      const astro = await astroDirectiveHashes();
      expect(new Set(astro).size, "5 directives client distinctes").toBe(5);
      const scripts = await pageScriptHashes(html, pageUrl, prefix, async (url) =>
        (await request.get(url)).text(),
      );
      const hashes = hashSources(readCsp(html), "script-src");
      expect(unexpectedHashes(hashes, [...astro, ...scripts]), "hashes inexpliqués").toEqual([]);
    });

    test("CA-3 · se charge et se parcourt sans aucune violation CSP", async ({ page }) => {
      await recordViolations(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      for (const link of await page.getByRole("link").all()) await link.hover();
      expect(await violations(page)).toEqual([]);
    });

    for (const { kind, file, directive } of KINDS) {
      test(`CA-3 · ${kind} : bloqué hors du préfixe, chargé sous le préfixe`, async ({
        page,
        baseURL,
      }) => {
        const origin = new URL(baseURL ?? "http://127.0.0.1:4321").origin;
        await serveProbes(page);
        await recordViolations(page);
        await page.goto(path);

        // Témoin positif : une ressource sous le préfixe passe.
        expect(await load(page, kind, `${origin}${INSIDE}${file}`), "sous le préfixe").toBe("load");
        for (const prefix of OUTSIDE) {
          expect(await load(page, kind, `${origin}${prefix}${file}`), prefix).toBe("error");
        }
        const reported = await violations(page);
        for (const prefix of OUTSIDE) {
          expect(reported, prefix).toContain(`${directive} ${origin}${prefix}${file}`);
        }
        expect(reported.some((entry) => entry.includes(INSIDE))).toBe(false);
        if (kind === "script") {
          const ran = await page.evaluate(() => {
            const probes: unknown = Reflect.get(window, "__probes");
            return Array.isArray(probes) ? probes.map(String) : null;
          });
          expect(ran).toEqual([`${INSIDE}${file}`]);
        }
      });
    }

    // security, tour 2, M2 : ce que 'self' laissait passer (fetch vers un autre dépôt, iframe,
    // média, formulaire) est désormais refusé, même sous le préfixe.
    test("CA-3 · fetch, iframe, média et envoi de formulaire sont bloqués", async ({
      page,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? "http://127.0.0.1:4321").origin;
      await recordViolations(page);
      await page.goto(path);
      const fetched = await page.evaluate(async (url) => {
        try {
          await fetch(url);
          return "load";
        } catch {
          return "error";
        }
      }, `${origin}${INSIDE}data.json`);
      expect(fetched).toBe("error");
      await page.evaluate((url) => {
        for (const tag of ["iframe", "audio"]) {
          const element = document.createElement(tag);
          // eslint-disable-next-line no-restricted-syntax -- sonde CSP construite par le test
          element.setAttribute("src", url);
          document.body.append(element);
        }
      }, `${origin}${INSIDE}probe`);
      await expect
        .poll(async () => (await violations(page)).map((entry) => entry.split(" ")[0]))
        .toEqual(expect.arrayContaining(["connect-src", "frame-src", "media-src"]));
    });

    test("CA-3 · script et style inline injectés sont bloqués ; le CSSOM reste permis", async ({
      page,
    }) => {
      await recordViolations(page);
      await page.goto(path);
      const result = await page.evaluate(() => {
        const script = document.createElement("script");
        script.textContent = "window.__inline = true;";
        document.head.append(script);

        const style = document.createElement("style");
        style.textContent = "body { outline: 7px solid rgb(1, 2, 3); }";
        document.head.append(style);

        const attribute = document.createElement("p");
        // eslint-disable-next-line no-restricted-syntax -- sonde CSP construite par le test
        attribute.setAttribute("style", "color: rgb(4, 5, 6)");
        document.body.append(attribute);

        // CLAUDE.md : les valeurs dynamiques passent par style.setProperty, qui doit marcher.
        const cssom = document.createElement("p");
        cssom.style.setProperty("color", "rgb(7, 8, 9)");
        document.body.append(cssom);

        return {
          inlineRan: Reflect.get(window, "__inline") === true,
          outline: getComputedStyle(document.body).outlineColor,
          attribute: getComputedStyle(attribute).color,
          cssom: getComputedStyle(cssom).color,
        };
      });
      expect(result.inlineRan).toBe(false);
      expect(result.outline).not.toBe("rgb(1, 2, 3)");
      expect(result.attribute).not.toBe("rgb(4, 5, 6)");
      expect(result.cssom).toBe("rgb(7, 8, 9)");
      const reported = await violations(page);
      expect(reported).toContain("script-src-elem inline");
      expect(reported).toContain("style-src-elem inline");
      expect(reported).toContain("style-src-attr inline");
    });
  });
}

test.describe("CSP · outils de contrôle", () => {
  test("la liste blanche refuse un hash qui n'est ni une directive d'Astro ni un script", async () => {
    desktopOnly();
    const astro = await astroDirectiveHashes();
    const forged = sha256("alert(1)");
    expect(unexpectedHashes([...astro, forged], astro)).toEqual([forged]);
    expect(
      await pageScriptHashes(
        '<script>a()</script><script src="/collection-paperasse/x.js"></script><script src="/autre/y.js"></script>',
        "http://127.0.0.1:4321/collection-paperasse/",
        "http://127.0.0.1:4321/collection-paperasse/",
        async (url) => `servi:${url}`,
      ),
    ).toEqual([sha256("a()"), sha256("servi:http://127.0.0.1:4321/collection-paperasse/x.js")]);
  });

  test("readCsp ne dépend ni de l'ordre ni des guillemets des attributs", () => {
    desktopOnly();
    const policy = "default-src 'none'; script-src https://a/";
    for (const html of [
      `<meta http-equiv="content-security-policy" content="${policy}">`,
      `<meta content="${policy}" http-equiv="Content-Security-Policy">`,
      `<META CONTENT='${policy.replaceAll("'", "&#39;")}' HTTP-EQUIV=content-security-policy />`,
    ]) {
      expect(readCsp(html).get("script-src"), html).toEqual(["https://a/"]);
    }
    expect(() => readCsp("<meta charset=utf-8>")).toThrow();
    expect(() =>
      readCsp(
        `<meta http-equiv="content-security-policy" content="a"><meta content="b" http-equiv="content-security-policy">`,
      ),
    ).toThrow();
  });

  // Script lancé par deploy.yml après `pnpm build` (security, tour 2, M1).
  test("scripts/check-csp.mjs valide site/ et refuse une CSP qui sort du préfixe", ({
    baseURL,
  }) => {
    desktopOnly();
    const prefix = new URL(baseURL ?? "http://127.0.0.1:4321/collection-paperasse/").href;
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [join(ROOT, "scripts", "check-csp.mjs"), ...args], {
        encoding: "utf8",
      });

    const ok = run("site", prefix);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain("4 page(s)");

    // site/ est un build e2e : la CSP de production n'y est pas, le contrôle doit échouer.
    const production = run("site");
    expect(production.status).toBe(1);
    expect(production.stderr).toContain("https://g0nni.github.io/collection-paperasse/");

    const forged = mkdtempSync(join(tmpdir(), "check-csp-"));
    const empty = mkdtempSync(join(tmpdir(), "check-csp-"));
    try {
      const good = readFileSync(join(ROOT, "site", "index.html"), "utf8");
      writeFileSync(join(forged, "index.html"), good);
      writeFileSync(
        join(forged, "self.html"),
        good.replace("connect-src 'none'", "connect-src 'self'"),
      );
      writeFileSync(join(forged, "none.html"), "<!doctype html><html><head></head></html>");
      const bad = run(forged, prefix);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("self.html : connect-src");
      expect(bad.stderr).toContain("none.html : une seule meta CSP attendue, 0 trouvée(s)");
      expect(bad.stderr).not.toContain("index.html");

      const nothing = run(empty, prefix);
      expect(nothing.status).toBe(1);
      expect(nothing.stderr).toContain("aucune page HTML");
    } finally {
      rmSync(forged, { recursive: true, force: true });
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
