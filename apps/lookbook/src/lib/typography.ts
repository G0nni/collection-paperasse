/**
 * Vérifie les règles typographiques de CLAUDE.md sur un texte d'interface. Sert aux tests :
 * les textes du lookbook sont statiques, une faute se rattrape donc avant le build.
 */
export type TypographyIssue =
  | "em-dash"
  | "space-before-high-punctuation"
  | "missing-space-before-high-punctuation"
  | "space-inside-quotes"
  | "missing-space-inside-quotes";

const NBSP = String.fromCodePoint(0xa0);
const NARROW_NBSP = String.fromCodePoint(0x202f);
const EM_DASH = String.fromCodePoint(0x2014);
const NON_BREAKING = `[${NBSP}${NARROW_NBSP}]`;

export function findTypographyIssues(text: string): TypographyIssue[] {
  const issues = new Set<TypographyIssue>();
  if (text.includes(EM_DASH)) {
    issues.add("em-dash");
  }
  if (/ [:;!?»]/u.test(text)) {
    issues.add("space-before-high-punctuation");
  }
  if (/« /u.test(text)) {
    issues.add("space-inside-quotes");
  }
  // « : » collé à un mot. On tolère les deux-points d'une heure ou d'une URL (chiffre ou
  // barre oblique juste après).
  if (/[\p{L}\p{N})][;!?»]|[\p{L})]:(?![\d/])/u.test(text)) {
    issues.add("missing-space-before-high-punctuation");
  }
  if (new RegExp(`«(?!${NON_BREAKING})`, "u").test(text)) {
    issues.add("missing-space-inside-quotes");
  }
  return [...issues];
}
