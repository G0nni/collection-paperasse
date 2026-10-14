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
 * faute. La fin de la correspondance est ensuite rognée (voir urlEnd).
 */
const URL_PATTERN = /\bhttps?:\/\/[^\s«»"“”<>]+/giu;

/** Ponctuation qui, en fin d'URL, appartient à la phrase. */
const URL_TRAILING_PUNCTUATION = /[.,:;?]$/u;

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

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}

/**
 * Longueur de l'URL proprement dite dans une correspondance de URL_PATTERN : la ponctuation
 * finale « . , : ; ? » et une « ) » sans « ( » ouvrante dans l'URL sont rendues à la phrase,
 * pour que « (https://x.fr): ici » soit vu comme une faute. « ! » final reste dans l'URL :
 * « https://exemple.fr/?q=1! » est une URL valide affichée telle quelle (typography.tester.test.ts).
 */
function urlEnd(match: string): number {
  let url = match;
  for (;;) {
    if (URL_TRAILING_PUNCTUATION.test(url)) {
      url = url.slice(0, -1);
    } else if (url.endsWith(")") && count(url, ")") > count(url, "(")) {
      url = url.slice(0, -1);
    } else {
      return url.length;
    }
  }
}

/** Masque les URL sans décaler les positions (même nombre de points de code). */
function maskUrls(text: string): string {
  return text.replace(URL_PATTERN, (match) => {
    const end = urlEnd(match);
    return "x".repeat(Array.from(match.slice(0, end)).length) + match.slice(end);
  });
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
 * Faute d'espacement d'un côté du signe : on lit `chars` à partir de `start` (le caractère
 * collé au signe) en avançant de `step` (-1 vers la gauche, 1 vers la droite). Il faut au
 * moins une U+00A0, et le caractère qui suit la suite d'insécables ne doit être ni une espace
 * sécable ni une fine : la ligne se couperait sur lui et emporterait « ⍽⍽: » à la ligne.
 */
function spacingIssue(
  chars: readonly string[],
  start: number,
  step: -1 | 1,
): TypographyIssueKind | null {
  const near = spaceKind(chars[start]);
  if (near === "breaking") return "breaking-space";
  if (near === "narrow") return "narrow-nbsp";
  if (near === "other") return "missing-nbsp";
  let index = start;
  while (spaceKind(chars[index]) === "nbsp") index += step;
  const far = spaceKind(chars[index]);
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
      const kind = spacingIssue(chars, index + 1, 1);
      if (kind !== null) report(kind, index);
      return;
    }
    if (char === "»") {
      const kind = spacingIssue(chars, index - 1, -1);
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
    const kind = spacingIssue(chars, index - 1, -1);
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
