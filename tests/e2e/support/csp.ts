// Le seul analyseur de CSP du dépôt (reviewer, tour 2). Utilisé par les e2e, par
// global-setup.ts et par scripts/check-csp.mjs (contrôle du site/ de production dans
// deploy.yml). Pas de dépendance ni d'import local : Node le charge tel quel (suppression des
// types), sans passer par Playwright. cspProblems contrôle en liste blanche : directives,
// sources et hashes non prévus par lookConfig sont refusés (détail dans son commentaire).

/** Une meta CSP trouvée dans le HTML : sa position (pour vérifier qu'elle est dans <head>). */
export type CspMeta = { readonly index: number; readonly policy: string };

/** Directives d'une CSP, indexées par nom : « script-src » → ["https://…", "'sha256-…'"]. */
export type Csp = ReadonlyMap<string, readonly string[]>;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

/** Décode les entités qu'un générateur HTML peut mettre dans un attribut. */
function decodeAttribute(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? entity;
  });
}

/** Attributs d'une balise ouvrante, noms en minuscules, quel que soit leur ordre ou leur quote. */
function readAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const body = tag.replace(/^<[a-z]+/iu, "").replace(/\/?>$/u, "");
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;
  for (const match of body.matchAll(pattern)) {
    const name = (match[1] ?? "").toLowerCase();
    // Comme un navigateur : seul le premier attribut d'un nom donné compte.
    if (!attributes.has(name)) {
      attributes.set(name, decodeAttribute(match[2] ?? match[3] ?? match[4] ?? ""));
    }
  }
  return attributes;
}

/** Toutes les meta `http-equiv="content-security-policy"` du HTML, dans l'ordre. */
export function findCspMetas(html: string): CspMeta[] {
  const metas: CspMeta[] = [];
  for (const match of html.matchAll(/<meta\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu)) {
    const attributes = readAttributes(match[0]);
    if (attributes.get("http-equiv")?.trim().toLowerCase() === "content-security-policy") {
      metas.push({ index: match.index, policy: attributes.get("content") ?? "" });
    }
  }
  return metas;
}

/** Découpe une politique en directives. Comme un navigateur, la première occurrence gagne. */
export function parseCsp(policy: string): Csp {
  const directives = new Map<string, string[]>();
  for (const directive of policy.split(";")) {
    const [name, ...sources] = directive.trim().split(/\s+/u);
    if (name !== undefined && name !== "" && !directives.has(name.toLowerCase())) {
      directives.set(name.toLowerCase(), sources);
    }
  }
  return directives;
}

/**
 * La CSP d'une page HTML. Lève une erreur s'il n'y a pas exactement une meta CSP : deux metas
 * se cumulent dans le navigateur, et un test qui n'en lirait qu'une se tromperait.
 */
export function readCsp(html: string): Csp {
  const metas = findCspMetas(html);
  const [meta] = metas;
  if (meta === undefined || metas.length !== 1) {
    throw new Error(`Une seule meta CSP attendue, ${metas.length} trouvée(s).`);
  }
  return parseCsp(meta.policy);
}

/** Les sources d'une directive qui ne sont ni des hashes ni des nonces. */
export function hostSources(csp: Csp, directive: string): string[] {
  return (csp.get(directive) ?? []).filter(
    (source) => !/^'(?:sha(?:256|384|512)|nonce)-/iu.test(source),
  );
}

/** Les hashes d'une directive : « 'sha256-…' ». */
export function hashSources(csp: Csp, directive: string): string[] {
  return (csp.get(directive) ?? []).filter((source) => /^'sha(?:256|384|512)-/iu.test(source));
}

/** Les directives que produit `lookConfig` : toute autre est refusée (liste blanche). */
const ALLOWED_DIRECTIVES: ReadonlySet<string> = new Set([
  "default-src",
  "script-src",
  "style-src",
  "img-src",
  "font-src",
  "connect-src",
  "base-uri",
  "form-action",
]);

/** Les seules directives où Astro met des hashes (scripts et styles inline qu'il génère). */
const HASHED_DIRECTIVES: ReadonlySet<string> = new Set(["script-src", "style-src"]);

const HASH = /^'sha(?:256|384|512)-[A-Za-z\d+/]+={0,2}'$/u;

/** Pourquoi une source est refusée quelle que soit la directive, ou `null`. */
function forbiddenSource(value: string): string | null {
  if (/^'nonce-/iu.test(value)) return "nonce (figé dans du HTML statique, donc public)";
  if (/^'(?:strict-dynamic|wasm-unsafe-eval|unsafe-[^']*)'$/iu.test(value)) {
    return "mot-clé interdit";
  }
  if (/^'self'$|^\*$/iu.test(value)) return "source trop large";
  if (/^[a-z][a-z\d+.-]*:$/iu.test(value)) return "source schéma";
  return null;
}

/**
 * Écarts entre la CSP d'une page et celle de la collection (CLAUDE.md, Sécurité). Liste
 * blanche, rien n'est accepté par défaut :
 * - seules les 8 directives de `lookConfig` sont permises (default-src, script-src, style-src,
 *   img-src, font-src, connect-src, base-uri, form-action), toute autre est refusée, même
 *   restrictive : script-src-elem, frame-src, worker-src… priment sur celles qu'on contrôle ;
 * - default-src, connect-src, base-uri et form-action valent exactement `'none'` ;
 * - script-src, style-src, img-src et font-src ont pour seule source d'hôte `source` (le
 *   préfixe de la collection) ;
 * - des hashes bien formés (`'sha256|384|512-…'`) seulement dans script-src et style-src ;
 * - partout refusés : nonces, `'strict-dynamic'`, `'wasm-unsafe-eval'`, `'unsafe-…'`, `'self'`,
 *   `*` et les sources schéma (`https:`, `http:`, `data:`, `blob:`…).
 * Ne vérifie pas quels hashes sont présents : la liste blanche calculée des hashes d'Astro
 * est dans csp.spec.ts. Renvoie `[]` si tout va bien.
 */
export function cspProblems(csp: Csp, source: string): string[] {
  const problems: string[] = [];
  const expectExactly = (directive: string, expected: readonly string[]) => {
    const actual = directive.endsWith("-src") ? hostSources(csp, directive) : csp.get(directive);
    if (JSON.stringify(actual ?? null) !== JSON.stringify(expected)) {
      problems.push(
        `${directive} : attendu ${JSON.stringify(expected)}, trouvé ${JSON.stringify(actual ?? null)}`,
      );
    }
  };
  expectExactly("default-src", ["'none'"]);
  for (const directive of ["script-src", "style-src", "img-src", "font-src"]) {
    expectExactly(directive, [source]);
  }
  expectExactly("connect-src", ["'none'"]);
  expectExactly("base-uri", ["'none'"]);
  expectExactly("form-action", ["'none'"]);
  for (const [directive, sources] of csp) {
    if (!ALLOWED_DIRECTIVES.has(directive)) {
      problems.push(`${directive} : directive non autorisée (${sources.join(" ")})`);
      continue;
    }
    for (const value of sources) {
      const reason = forbiddenSource(value);
      if (reason !== null) {
        problems.push(`${directive} : ${reason} (${value})`);
      } else if (HASH.test(value)) {
        if (!HASHED_DIRECTIVES.has(directive)) {
          problems.push(`${directive} : hash interdit (${value})`);
        }
      } else if (/^'sha/iu.test(value)) {
        problems.push(`${directive} : hash mal formé (${value})`);
      }
    }
  }
  return problems;
}
