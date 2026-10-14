/**
 * Oracle typographique de la collection (CLAUDE.md, « Accessibilité et qualité ») : le seul à
 * utiliser, dans les tests unitaires comme dans les e2e. Il est volontairement strict : avant
 * « : ; ! ? » et à l'intérieur de « », seule une espace insécable (U+00A0) ou fine insécable
 * (U+202F) est acceptée. Une espace normale, une fine sécable (U+2009), une tabulation ou un
 * retour à la ligne laissent le signe partir seul à la ligne suivante : c'est une faute.
 */

const NBSP = String.fromCodePoint(0xa0);
const NARROW_NBSP = String.fromCodePoint(0x202f);
const EM_DASH = String.fromCodePoint(0x2014);

/** Signes qui prennent une insécable avant eux. */
const HIGH_PUNCTUATION = new Set([":", ";", "!", "?"]);

/** Les URL ont leurs propres règles (https://, ?a=1) : on ne les vérifie pas. */
const URL_PATTERN = /\bhttps?:\/\/\S+/gu;

export type TypographyIssueKind =
  /** Tiret cadratin : Gonni n'en veut pas (CLAUDE.md, Style de code). */
  | "em-dash"
  /** Une espace sécable (espace, fine, tabulation, retour à la ligne…) au lieu d'une insécable. */
  | "breaking-space"
  /** Aucune espace du tout : signe collé au mot, ou guillemet collé au texte. */
  | "missing-nbsp";

export type TypographyIssue = {
  readonly kind: TypographyIssueKind;
  /** Le signe concerné : « : », « ; », « ! », « ? », « « », « » » ou le tiret cadratin. */
  readonly mark: string;
  /** Position du signe, en points de code. */
  readonly index: number;
  /** Extrait autour de la faute, insécables rendues visibles par « ⍽ ». */
  readonly excerpt: string;
};

function isNonBreakingSpace(char: string | undefined): boolean {
  return char === NBSP || char === NARROW_NBSP;
}

function isBreakingSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/u.test(char) && !isNonBreakingSpace(char);
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
      .replaceAll(NARROW_NBSP, "⍽"),
  );
}

/** Ce qu'il y a à côté du signe : bonne insécable, espace sécable, ou rien. */
function spacingIssue(neighbour: string | undefined): TypographyIssueKind | null {
  if (isNonBreakingSpace(neighbour)) return null;
  return isBreakingSpace(neighbour) ? "breaking-space" : "missing-nbsp";
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

    if (char === EM_DASH) {
      report("em-dash", index);
      return;
    }
    if (char === "«") {
      const kind = spacingIssue(next);
      if (kind !== null) report(kind, index);
      return;
    }
    if (char === "»") {
      const kind = spacingIssue(previous);
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
    const kind = spacingIssue(previous);
    if (kind !== null) report(kind, index);
  });

  return issues;
}

const KIND_LABELS: Readonly<Record<TypographyIssueKind, string>> = {
  "em-dash": "tiret cadratin",
  "breaking-space": "espace sécable au lieu d'une insécable",
  "missing-nbsp": "insécable manquante",
};

/** Message lisible pour un rapport de test : « insécable manquante près de « : » "…" ». */
export function formatTypographyIssue(issue: TypographyIssue): string {
  return `${KIND_LABELS[issue.kind]} près de « ${issue.mark} » ${issue.excerpt}`;
}
