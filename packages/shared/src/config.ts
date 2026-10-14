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
  | "default-src"
  | "img-src"
  | "font-src"
  | "connect-src"
  | "object-src"
  | "base-uri"
  | "form-action"} ${string}`;

/** Hôtes acceptés en `http:` : uniquement la machine locale, pour les e2e. */
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Base Astro d'une app : la racine pour le lookbook, un sous-dossier pour chaque look. */
export function baseFor(slug: LookSlug | null): string {
  return slug === null ? COLLECTION_BASE : `${COLLECTION_BASE}${slug}/`;
}

/**
 * Origine qui servira le site, lue dans l'environnement du build. Refuse tout ce qui n'est pas
 * une origine nue (pas de chemin, pas d'identifiants) : une valeur fantaisiste élargirait la CSP.
 */
export function siteOrigin(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env[ORIGIN_ENV];
  if (raw === undefined || raw === "") {
    return SITE;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${ORIGIN_ENV} n'est pas une URL : ${raw}`);
  }
  const secure = url.protocol === "https:";
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (!secure && !local) {
    throw new Error(`${ORIGIN_ENV} doit être en https, ou en http sur la machine locale : ${raw}`);
  }
  if (url.origin !== raw) {
    throw new Error(
      `${ORIGIN_ENV} doit être une origine seule, sans chemin ni slash final : ${raw}`,
    );
  }
  return url.origin;
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
 * GitHub Pages ne permet pas d'envoyer d'en-têtes : tout passe par la meta CSP, donc
 * frame-ancestors (ignoré en meta) n'est pas disponible.
 */
export function cspDirectives(origin: string): CspDirective[] {
  const source = collectionSource(origin);
  return [
    "default-src 'self'",
    `img-src ${source}`,
    `font-src ${source}`,
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
}
