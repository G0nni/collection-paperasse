import type { AstroUserConfig } from "astro";
import { SITE, baseFor, collectionSource, cspDirectives, siteOrigin } from "./config";
import type { LookSlug } from "./looks";

/**
 * Configuration Astro commune aux quatre apps, pour qu'aucune ne diverge (CSP, base, sortie
 * statique). `slug` vaut `null` pour le lookbook, servi à la racine de la collection.
 * `env` est l'environnement du build (`process.env`), passé en paramètre pour rester testable.
 */
export function lookConfig(
  slug: LookSlug | null,
  env: Readonly<Record<string, string | undefined>> = {},
): AstroUserConfig {
  const origin = siteOrigin(env);
  const source = collectionSource(origin);
  return {
    site: SITE,
    base: baseFor(slug),
    output: "static",
    trailingSlash: "always",
    build: { inlineStylesheets: "never" },
    security: {
      csp: {
        directives: cspDirectives(origin),
        // Remplace le 'self' par défaut d'Astro (voir collectionSource).
        scriptDirective: { resources: [source] },
        styleDirective: { resources: [source] },
      },
    },
    // Shiki colore le code avec des attributs style, que la CSP refuse. Aucune app n'a de
    // Markdown : on le coupe (et Astro cesse d'avertir à chaque build).
    markdown: { syntaxHighlight: false },
    // Pas de police ni d'image inlinée en data: (font-src et img-src la refuseraient) :
    // chaque fichier reste un asset servi sous le préfixe de la collection.
    vite: { build: { assetsInlineLimit: 0 } },
  };
}
