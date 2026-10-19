// L'acte de pari et son schéma (specs/jure-crache.md, « Format d'URL (fait foi) »).
// L'objet décodé du lien est hostile (CLAUDE.md, Sécurité) : il n'est jamais étalé ni fusionné,
// chaque clé attendue est lue une par une, et toute clé inconnue ou manquante refuse l'acte.
import { sanitizeText, type TextBounds } from "@paperasse/shared/text";

const DAY_MS = 24 * 60 * 60 * 1000;

export const LIMITS = {
  nameMax: 40,
  subjectMax: 200,
  stakeMax: 120,
  articleMax: 160,
  articlesMax: 5,
  /** `t` ≥ 2026-01-01 00:00 UTC. */
  earliestDraft: Date.UTC(2026, 0, 1),
  /** `t` ≤ maintenant + 1 jour (horloges décalées entre appareils). */
  draftTolerance: DAY_MS,
  /** `d` ≤ `t` + 10 ans. */
  maxYears: 10,
} as const;

export type Deed = {
  /** `p` : le parieur. */
  readonly bettor: string;
  /** `c` : le contre-parieur, différent de `p` sans tenir compte de la casse. */
  readonly opponent: string;
  /** `o` : l'objet du pari. */
  readonly subject: string;
  /** `e` : l'enjeu. */
  readonly stake: string;
  /** `a` : 0 à 5 articles. */
  readonly articles: readonly string[];
  /** `d` : échéance, ms Unix UTC. */
  readonly deadline: number;
  /** `t` : date de rédaction, ms Unix UTC. */
  readonly draftedAt: number;
};

/** Clés du schéma, dans l'ordre du JSON canonique (empreinte). */
export const DEED_KEYS = ["p", "c", "o", "e", "a", "d", "t"] as const;
export type DeedKey = (typeof DEED_KEYS)[number];

/** Textes libres de l'acte et leurs bornes, en points de code. */
export const TEXT_BOUNDS = {
  bettor: { min: 1, max: LIMITS.nameMax },
  opponent: { min: 1, max: LIMITS.nameMax },
  subject: { min: 1, max: LIMITS.subjectMax },
  stake: { min: 1, max: LIMITS.stakeMax },
  article: { min: 1, max: LIMITS.articleMax },
} as const satisfies Record<string, TextBounds>;

export type DeedError =
  /** Ni objet ni objet simple : tableau, nombre, chaîne, `null`. */
  | "not-object"
  /** Une clé hors du schéma (dont `__proto__`, `constructor`). */
  | "unknown-key"
  /** Une clé du schéma absente. */
  | "missing-key"
  /** `p`, `c`, `o` ou `e` illisible, vide ou trop long après nettoyage. */
  | "bad-text"
  /** `p` et `c` désignent la même personne (CL-4). */
  | "same-names"
  /** `a` n'est pas un tableau de 0 à 5 textes de 1 à 160 caractères. */
  | "bad-articles"
  /** `t` hors de [2026-01-01, maintenant + 1 jour] ou pas un entier. */
  | "bad-draft-date"
  /** `d` hors de ]t, t + 10 ans] ou pas un entier. */
  | "bad-deadline";

export type DeedResult =
  { readonly ok: true; readonly deed: Deed } | { readonly ok: false; readonly error: DeedError };

/** Un objet JSON simple (ni tableau ni `null`). Vérification réelle, pas un transtypage. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Clé de comparaison de deux noms (CL-4) : la casse ne compte pas, et un caractère invisible
 * glissé dans un nom (U+200B…) ne suffit pas à en faire un autre. NFKC replie aussi les formes
 * de compatibilité (« Ｔｈéo » pleine chasse). Les deux sens de casse couvrent « ß » / « SS ».
 */
export function sameName(first: string, second: string): boolean {
  const key = (name: string) =>
    name.replace(/\p{Default_Ignorable_Code_Point}/gu, "").normalize("NFKC");
  const a = key(first);
  const b = key(second);
  return a.toLowerCase() === b.toLowerCase() || a.toUpperCase() === b.toUpperCase();
}

/** Dernière échéance permise pour un acte rédigé à `draftedAt` : même instant, 10 ans plus tard (UTC). */
export function latestDeadline(draftedAt: number): number {
  const date = new Date(draftedAt);
  date.setUTCFullYear(date.getUTCFullYear() + LIMITS.maxYears);
  return date.getTime();
}

/** Entier sûr dans [min, max], sinon `null`. Un nombre JSON comme `1.7e12` est un entier. */
function readInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

function readText(value: unknown, bounds: TextBounds): string | null {
  const result = sanitizeText(value, bounds);
  return result.ok ? result.value : null;
}

function readArticles(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > LIMITS.articlesMax) return null;
  const articles: string[] = [];
  // Lecture par index, bornée par la longueur déjà vérifiée.
  for (let index = 0; index < value.length; index += 1) {
    const article = readText(value[index], TEXT_BOUNDS.article);
    if (article === null) return null;
    articles.push(article);
  }
  return articles;
}

/** Vrai si l'objet a exactement les clés du schéma, ni plus ni moins. */
function checkKeys(record: Record<string, unknown>): DeedError | null {
  const keys = Object.keys(record);
  const known: readonly string[] = DEED_KEYS;
  if (keys.some((key) => !known.includes(key))) return "unknown-key";
  if (DEED_KEYS.some((key) => !Object.hasOwn(record, key))) return "missing-key";
  return null;
}

/**
 * Lit un acte décodé du lien (le résultat de `JSON.parse`). `nowMs` est l'heure de l'appareil,
 * passée en paramètre pour rester testable. Ne lève jamais d'exception.
 */
export function readDeed(value: unknown, nowMs: number): DeedResult {
  const fail = (error: DeedError): DeedResult => ({ ok: false, error });
  if (!isPlainRecord(value)) return fail("not-object");
  const keyError = checkKeys(value);
  if (keyError !== null) return fail(keyError);

  const bettor = readText(value["p"], TEXT_BOUNDS.bettor);
  const opponent = readText(value["c"], TEXT_BOUNDS.opponent);
  const subject = readText(value["o"], TEXT_BOUNDS.subject);
  const stake = readText(value["e"], TEXT_BOUNDS.stake);
  if (bettor === null || opponent === null || subject === null || stake === null) {
    return fail("bad-text");
  }
  if (sameName(bettor, opponent)) return fail("same-names");

  const articles = readArticles(value["a"]);
  if (articles === null) return fail("bad-articles");

  const draftedAt = readInteger(value["t"], LIMITS.earliestDraft, nowMs + LIMITS.draftTolerance);
  if (draftedAt === null) return fail("bad-draft-date");
  const deadline = readInteger(value["d"], draftedAt + 1, latestDeadline(draftedAt));
  if (deadline === null) return fail("bad-deadline");

  return { ok: true, deed: { bettor, opponent, subject, stake, articles, deadline, draftedAt } };
}

/**
 * JSON canonique de l'acte, base de l'empreinte : clés dans l'ordre `p, c, o, e, a, d, t`,
 * sans espace (JSON.stringify n'en met pas). Les textes sont déjà nettoyés : deux liens qui
 * affichent le même acte ont la même empreinte.
 */
export function canonicalJson(deed: Deed): string {
  return JSON.stringify({
    p: deed.bettor,
    c: deed.opponent,
    o: deed.subject,
    e: deed.stake,
    a: deed.articles,
    d: deed.deadline,
    t: deed.draftedAt,
  });
}
