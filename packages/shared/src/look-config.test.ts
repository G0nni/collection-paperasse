import { describe, expect, it } from "vitest";
import { ORIGIN_ENV } from "./config";
import { lookConfig } from "./look-config";

const PRODUCTION_SOURCE = "https://g0nni.github.io/collection-paperasse/";

describe("lookConfig", () => {
  it("donne à chaque app sa base, sous la collection", () => {
    expect(lookConfig(null).base).toBe("/collection-paperasse/");
    expect(lookConfig("reunion-metre").base).toBe("/collection-paperasse/reunion-metre/");
    expect(lookConfig("sav-de-ta-vie").base).toBe("/collection-paperasse/sav-de-ta-vie/");
  });

  it("produit un site 100 % statique, sans CSS inline", () => {
    const config = lookConfig("jure-crache");
    expect(config.output).toBe("static");
    expect(config.site).toBe("https://g0nni.github.io");
    expect(config.build?.inlineStylesheets).toBe("never");
  });

  it("coupe Shiki, dont les attributs style sont incompatibles avec la CSP", () => {
    expect(lookConfig(null).markdown?.syntaxHighlight).toBe(false);
  });

  it("n'inline aucun asset en data: (polices comprises), pour toutes les apps", () => {
    for (const slug of [null, "reunion-metre", "jure-crache", "sav-de-ta-vie"] as const) {
      expect(lookConfig(slug).vite?.build?.assetsInlineLimit).toBe(0);
    }
  });

  it("limite script-src et style-src au préfixe de la collection en production", () => {
    const csp = lookConfig(null).security?.csp;
    expect(typeof csp).toBe("object");
    if (typeof csp === "object") {
      expect(csp.scriptDirective?.resources).toEqual([PRODUCTION_SOURCE]);
      expect(csp.styleDirective?.resources).toEqual([PRODUCTION_SOURCE]);
      expect(csp.directives).toContain(`font-src ${PRODUCTION_SOURCE}`);
    }
  });

  it("prend l'origine locale des e2e quand la variable est fixée", () => {
    const csp = lookConfig("jure-crache", { [ORIGIN_ENV]: "http://127.0.0.1:4321" }).security?.csp;
    if (typeof csp !== "object") throw new Error("CSP attendue");
    expect(csp.scriptDirective?.resources).toEqual(["http://127.0.0.1:4321/collection-paperasse/"]);
    expect(csp.styleDirective?.resources).toEqual(["http://127.0.0.1:4321/collection-paperasse/"]);
  });

  it("arrête le build si la variable est invalide", () => {
    expect(() => lookConfig(null, { [ORIGIN_ENV]: "http://evil.example" })).toThrow();
  });
});
