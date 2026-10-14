/** Domaine GitHub Pages et sous-chemin de la collection. Une seule source de vérité. */
export const SITE = "https://g0nni.github.io";
export const COLLECTION_BASE = "/collection-paperasse/";
export const REPO_URL = "https://github.com/G0nni/collection-paperasse";

/** Base Astro d'une app : la racine pour le lookbook, un sous-dossier pour chaque look. */
export function baseFor(slug: string | null): string {
  return slug === null ? COLLECTION_BASE : `${COLLECTION_BASE}${slug}/`;
}

/**
 * Directives CSP ajoutées à celles qu'Astro génère (script-src et style-src avec hashes).
 * GitHub Pages ne permet pas d'envoyer d'en-têtes : tout passe par la meta CSP, donc
 * frame-ancestors (ignoré en meta) n'est pas disponible.
 */
export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];
