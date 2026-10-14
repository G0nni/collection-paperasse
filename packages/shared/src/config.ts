import type { LookSlug } from "./looks";

/** Domaine GitHub Pages et sous-chemin de la collection. Une seule source de vérité. */
export const SITE = "https://g0nni.github.io";
export const COLLECTION_BASE = "/collection-paperasse/";
export const REPO_URL = "https://github.com/G0nni/collection-paperasse";

/**
 * Variable d'environnement lue au build pour changer l'origine autorisée par la CSP.
 * Absente : production (`SITE`). Les e2e locaux la fixent via `pnpm build:e2e`.
 */
export const ORIGIN_ENV = "PAPERASSE_ORIGIN";

/** Directive CSP nommée : la forme qu'attend `security.csp.directives` d'Astro. */
export type CspDirective = `${
  "default-src" | "img-src" | "font-src" | "connect-src" | "base-uri" | "form-action"} ${string}`;

/**
 * Seule forme acceptée pour `PAPERASSE_ORIGIN` : `http://` + hôte de la boucle locale + port
 * numérique explicite. Écrite en entier plutôt que déduite de `new URL()` : l'URL est recopiée
 * telle quelle dans la meta CSP, qu'Astro n'échappe pas. `https://*` élargirait la CSP à tout
 * hôte, un `"` fermerait l'attribut (et désactiverait la CSP), un `;` injecterait une directive
 * (security, tour 2, M1). Les e2e n'ont besoin de rien d'autre.
 */
const LOCAL_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):([1-9]\d{0,4})$/u;

/** Base Astro d'une app : la racine pour le lookbook, un sous-dossier pour chaque look. */
export function baseFor(slug: LookSlug | null): string {
  return slug === null ? COLLECTION_BASE : `${COLLECTION_BASE}${slug}/`;
}

/**
 * Origine qui servira le site, lue dans l'environnement du build. Absente : la production.
 * Sinon, uniquement une origine locale de test (voir `LOCAL_ORIGIN`) ; tout le reste arrête
 * le build.
 */
export function siteOrigin(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env[ORIGIN_ENV];
  if (raw === undefined || raw === "") {
    return SITE;
  }
  const port = Number(LOCAL_ORIGIN.exec(raw)?.[1] ?? Number.NaN);
  if (!Number.isInteger(port) || port > 65535) {
    throw new Error(
      `${ORIGIN_ENV} doit être une origine locale de test, de la forme http://127.0.0.1:4321 ` +
        `(hôtes acceptés : 127.0.0.1, localhost, [::1] ; port obligatoire) : ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

/**
 * Seule source autorisée pour les scripts, styles, polices et images : le préfixe de la
 * collection, pas l'origine entière. `'self'` vaudrait pour tout g0nni.github.io, donc pour
 * tous les autres dépôts Pages du même compte.
 */
export function collectionSource(origin: string): string {
  return `${origin}${COLLECTION_BASE}`;
}

/**
 * Directives CSP ajoutées à celles qu'Astro génère (script-src et style-src, avec hashes).
 * Tout est fermé par défaut (`default-src 'none'`) et seuls polices et images sont rouvertes,
 * sous le préfixe de la collection : aucune app ne fait de requête, n'a de formulaire envoyé
 * au réseau, de `<base>`, d'iframe ni de média. `'self'` vaudrait pour tout g0nni.github.io
 * (security, tour 2, M2). `object-src` est couvert par `default-src 'none'`.
 * GitHub Pages ne permet pas d'envoyer d'en-têtes : tout passe par la meta CSP, donc
 * frame-ancestors (ignoré en meta) n'est pas disponible.
 */
export function cspDirectives(origin: string): CspDirective[] {
  const source = collectionSource(origin);
  return [
    "default-src 'none'",
    `img-src ${source}`,
    `font-src ${source}`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];
}
