/**
 * Oracle typographique de la collection (CLAUDE.md, « Accessibilité et qualité ») : le seul à
 * utiliser, dans les tests unitaires comme dans les e2e. Il est volontairement strict : avant
 * « : ; ! ? » et à l'intérieur de « », seule l'espace insécable U+00A0 est acceptée
 * (specs/lookbook.md : « U+00A0 partout (pas d'espace fine U+202F), pour un seul cas à
 * tester »). Une espace normale, une fine sécable (U+2009), une tabulation ou un retour à la
 * ligne laissent le signe partir seul à la ligne suivante : c'est une faute. Une espace sécable
 * collée à l'insécable aussi : la ligne se coupe sur elle et emporte « ⍽: » à la ligne.
 */

/** Espace insécable de la collection. Le seul exemplaire du dépôt : importe-le d'ici. */
export const NBSP = String.fromCodePoint(0xa0);
/** Espace fine insécable : refusée (specs/lookbook.md), U+00A0 partout. */
export const NARROW_NBSP = String.fromCodePoint(0x202f);
/** Tiret cadratin : interdit dans les textes d'interface (CLAUDE.md, Style de code). */
export const EM_DASH = String.fromCodePoint(0x2014);

/** Signes qui prennent une insécable avant eux. */
const HIGH_PUNCTUATION = new Set([":", ";", "!", "?"]);

/**
 * Les URL ont leurs propres règles (https://, ?a=1) : on ne vérifie pas leurs espaces.
 * Insensible à la casse (`text-transform: uppercase` donne « HTTPS:// » dans `innerText`) et
 * arrêtée aux guillemets, qui ne sont jamais des caractères d'URL : « https://x.fr» reste une
 * faute.
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s«»"“”<>]+/giu;

export type TypographyIssueKind =
  /** Tiret cadratin : Gonni n'en veut pas (CLAUDE.md, Style de code). */
  | "em-dash"
  /** Une espace sécable (espace, fine, tabulation, retour à la ligne…) au lieu d'une insécable. */
  | "breaking-space"
  /** Une espace fine insécable (U+202F) au lieu de U+00A0. */
  | "narrow-nbsp"
  /** Aucune espace du tout : signe collé au mot, ou guillemet collé au texte. */
  | "missing-nbsp";

export type TypographyIssue = {
  readonly kind: TypographyIssueKind;
  /** Le signe concerné : « : », « ; », « ! », « ? », « « », « » » ou le tiret cadratin. */
  readonly mark: string;
  /** Position du signe, en points de code. */
  readonly index: number;
  /** Extrait autour de la faute, insécables rendues visibles par « ⍽ » (U+202F : « ⍿ »). */
  readonly excerpt: string;
};

/** Ce qu'est un caractère, vu de la règle des insécables. */
function spaceKind(char: string | undefined): "nbsp" | "narrow" | "breaking" | "other" {
  if (char === NBSP) return "nbsp";
  if (char === NARROW_NBSP) return "narrow";
  if (char !== undefined && /\s/u.test(char)) return "breaking";
  return "other";
}

/** Masque les URL sans décaler les positions (même nombre de points de code). */
function maskUrls(text: string): string {
  return text.replace(URL_PATTERN, (url) => "x".repeat(Array.from(url).length));
}

function excerptAround(chars: readonly string[], index: number): string {
  return JSON.stringify(
    chars
      .slice(Math.max(0, index - 15), index + 15)
      .join("")
      .replaceAll(NBSP, "⍽")
      .replaceAll(NARROW_NBSP, "⍿"),
  );
}

/**
 * Faute d'espacement d'un côté du signe : `neighbour` est le caractère collé au signe,
 * `beyond` celui d'après (dans le même sens). Il faut exactement une U+00A0, sans espace
 * sécable ni fine derrière elle.
 */
function spacingIssue(
  neighbour: string | undefined,
  beyond: string | undefined,
): TypographyIssueKind | null {
  const near = spaceKind(neighbour);
  if (near === "breaking") return "breaking-space";
  if (near === "narrow") return "narrow-nbsp";
  if (near === "other") return "missing-nbsp";
  const far = spaceKind(beyond);
  if (far === "breaking") return "breaking-space";
  if (far === "narrow") return "narrow-nbsp";
  return null;
}

/** Renvoie toutes les fautes du texte, dans l'ordre. Un texte correct renvoie `[]`. */
export function findTypographyIssues(text: string): TypographyIssue[] {
  const original = Array.from(text);
  const chars = Array.from(maskUrls(text));
  const issues: TypographyIssue[] = [];
  const report = (kind: TypographyIssueKind, index: number) => {
    issues.push({
      kind,
      mark: original[index] ?? "",
      index,
      excerpt: excerptAround(original, index),
    });
  };

  chars.forEach((char, index) => {
    const previous = chars[index - 1];
    const next = chars[index + 1];

    // Sur le texte original : une URL affichée reste un texte d'interface (CLAUDE.md).
    if (original[index] === EM_DASH) {
      report("em-dash", index);
      return;
    }
    if (char === "«") {
      const kind = spacingIssue(next, chars[index + 2]);
      if (kind !== null) report(kind, index);
      return;
    }
    if (char === "»") {
      const kind = spacingIssue(previous, chars[index - 2]);
      if (kind !== null) report(kind, index);
      return;
    }
    if (!HIGH_PUNCTUATION.has(char) || index === 0) {
      return;
    }
    // Une heure (14:30) n'a pas d'espace.
    if (char === ":" && /\d/u.test(previous ?? "") && /\d/u.test(next ?? "")) {
      return;
    }
    // « ?! », « !! » : seul le premier signe porte l'espace.
    if ((char === "!" || char === "?") && (previous === "!" || previous === "?")) {
      return;
    }
    const kind = spacingIssue(previous, chars[index - 2]);
    if (kind !== null) report(kind, index);
  });

  return issues;
}

const KIND_LABELS: Readonly<Record<TypographyIssueKind, string>> = {
  "em-dash": "tiret cadratin",
  "breaking-space": "espace sécable au lieu d'une insécable",
  "narrow-nbsp": "espace fine insécable (U+202F) au lieu de U+00A0",
  "missing-nbsp": "insécable manquante",
};

/** Message lisible pour un rapport de test : « insécable manquante près de « : » "…" ». */
export function formatTypographyIssue(issue: TypographyIssue): string {
  return `${KIND_LABELS[issue.kind]} près de « ${issue.mark} » ${issue.excerpt}`;
}
