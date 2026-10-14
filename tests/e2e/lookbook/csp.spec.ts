// CSP limitée au préfixe de la collection, vérifiée dans le navigateur et pas seulement en
// lisant la meta (CLAUDE.md, Sécurité) : « Scripts, styles, polices et images ne sont autorisés
// que sous le préfixe de la collection (sur g0nni.github.io, 'self' couvrirait tous les repos
// Pages du compte) ». On injecte des ressources du même hôte, hors du préfixe, et on vérifie
// que le navigateur les bloque ; une sonde sous le préfixe sert de témoin positif (sinon un
// test qui bloque tout passerait aussi).
import { expect, test, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGES = [
  { path: "", name: "lookbook" },
  { path: "reunion-metre/", name: "reunion-metre" },
  { path: "jure-crache/", name: "jure-crache" },
  { path: "sav-de-ta-vie/", name: "sav-de-ta-vie" },
];

/** Même hôte, hors du préfixe : un autre dépôt Pages, et un nom qui commence pareil. */
const OUTSIDE = ["/autre-depot/", "/collection-paperasse-evil/", "/"];
const INSIDE = "/collection-paperasse/__csp-probe/";

const assets = fileURLToPath(new URL("../../../site/_astro/", import.meta.url));
const woff2 = readdirSync(assets).find((file) => file.endsWith(".woff2"));
const FONT = woff2 === undefined ? Buffer.alloc(0) : readFileSync(`${assets}${woff2}`);
// PNG 1 × 1 transparent.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

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
        await route.fulfill({ contentType: "font/woff2", body: FONT });
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
  test.describe(`CSP réelle · ${name}`, () => {
    test("CA-3 · la meta CSP est unique, dans <head>, avant toute ressource", async ({
      request,
    }) => {
      const html = await (await request.get(path)).text();
      const metas = [...html.matchAll(/<meta[^>]+http-equiv="content-security-policy"/giu)];
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

    // CLAUDE.md : scripts autorisés seulement sous le préfixe. Un hash de script-src autorise un
    // script inline, hors préfixe : il n'est acceptable que si la page contient ce script.
    // (security, tour 1, M1 : « les 5 hashes de scripts d'hydratation Astro sont inutiles ».)
    test("CA-3 · chaque hash de script-src correspond à un script inline de la page", async ({
      request,
    }) => {
      const html = await (await request.get(path)).text();
      const csp = /http-equiv="content-security-policy" content="([^"]*)"/u.exec(html)?.[1] ?? "";
      const scriptSrc = csp
        .split(";")
        .map((directive) => directive.trim().split(/\s+/u))
        .find(([directive]) => directive === "script-src");
      const hashes = (scriptSrc ?? []).filter((source) => source.startsWith("'sha256-"));
      const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/giu)].map(
        (match) =>
          `'sha256-${createHash("sha256")
            .update(match[1] ?? "")
            .digest("base64")}'`,
      );
      expect(
        hashes.filter((hash) => !inline.includes(hash)),
        "hashes sans script",
      ).toEqual([]);
    });
  });
}
