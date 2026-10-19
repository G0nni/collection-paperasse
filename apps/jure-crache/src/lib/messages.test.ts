// Chaque texte d'interface passe l'oracle typographique de la collection (insécables, pas de
// tiret cadratin), dans toutes ses variantes.
import { describe, expect, it } from "vitest";
import {
  EM_DASH,
  NBSP,
  findTypographyIssues,
  formatTypographyIssue,
} from "@paperasse/shared/typography";
import type { Deed, DeedError } from "./deed";
import {
  DEFAULT_ARTICLES,
  type DeadlineErrorCode,
  type FieldError,
  type TextErrorCode,
  type TextField,
} from "./draft";
import { formatDate, formatDateTime } from "./format";
import type { UnreadableReason } from "./link";
import {
  TEXT,
  articleLabel,
  articlePrefix,
  deadlineLine,
  errorSummary,
  fieldErrorText,
  formErrorText,
  judgedLine,
  noticeText,
  registeredLine,
  removeArticleContext,
  unreadableDetail,
  verdictLine,
} from "./messages";
import { UNSEALED_NUMBER, deedNumber } from "./seal";

const DEED: Deed = {
  bettor: "Théo",
  opponent: "Sam",
  subject: "x",
  stake: "y",
  articles: [],
  deadline: Date.UTC(2026, 9, 17, 18),
  draftedAt: Date.UTC(2026, 9, 14, 9),
};

const TEXT_FIELDS: TextField[] = ["bettor", "opponent", "subject", "stake", "article"];
const TEXT_CODES: TextErrorCode[] = ["empty", "too-long", "same-names", "link-too-long"];
const DEADLINE_CODES: DeadlineErrorCode[] = [
  "missing-date",
  "nonexistent-time",
  "past-date",
  "too-far",
];
const FIELD_ERRORS: FieldError[] = [
  ...TEXT_FIELDS.flatMap((field) =>
    TEXT_CODES.map((code): FieldError => ({ field, index: 0, code })),
  ),
  ...DEADLINE_CODES.map((code): FieldError => ({ field: "deadline", index: 0, code })),
];
const DEED_ERRORS: DeedError[] = [
  "not-object",
  "unknown-key",
  "missing-key",
  "bad-text",
  "same-names",
  "bad-articles",
  "bad-draft-date",
  "bad-deadline",
];
const REASONS: UnreadableReason[] = [
  "too-long",
  "decoded-too-long",
  "format",
  "decompress",
  "json",
  ...DEED_ERRORS,
];

function allTexts(): string[] {
  const when = formatDateTime(DEED.deadline, "Europe/Paris");
  return [
    ...Object.values(TEXT),
    ...DEFAULT_ARTICLES,
    ...[1, 5].flatMap((n) => [articleLabel(n), articlePrefix(n), removeArticleContext(n)]),
    errorSummary(1),
    errorSummary(3),
    ...FIELD_ERRORS.map(fieldErrorText),
    formErrorText(FIELD_ERRORS),
    formErrorText([{ field: "subject", index: 0, code: "link-too-long" }]),
    ...REASONS.map(unreadableDetail),
    noticeText("unknown-verdict"),
    `${deedNumber("ab".repeat(32), DEED.draftedAt)}${registeredLine(formatDate(DEED.draftedAt, "Europe/Paris"))}`,
    `${UNSEALED_NUMBER}${registeredLine(formatDate(DEED.draftedAt, "Europe/Paris"))}`,
    deadlineLine(when),
    judgedLine(formatDate(DEED.deadline, "Europe/Paris")),
    verdictLine("p", DEED),
    verdictLine("c", DEED),
    verdictLine("n", DEED),
  ];
}

describe("textes d'interface", () => {
  it("typographie française : insécables avant « : ; ! ? » et dans « », pas de tiret cadratin", () => {
    const issues = allTexts().flatMap((text) =>
      findTypographyIssues(text).map((issue) => `${formatTypographyIssue(issue)} dans ${text}`),
    );
    expect(issues).toEqual([]);
    expect(allTexts().join("")).not.toContain(EM_DASH);
  });

  it("CA-8 · pied d'acte ; CA-4 · échéance passée ; textes exacts de la spec", () => {
    expect(TEXT.footer).toBe("Acte sans aucune valeur juridique. Juré, craché.");
    expect(TEXT.passed).toBe("Échéance passée. Le tribunal des potes attend votre verdict.");
    expect(TEXT.verdictNote).toBe(
      "Verdict déclaré par la personne qui a envoyé ce lien. En cas de litige, le tribunal des potes statue en dernier ressort.",
    );
    expect(TEXT.sealRing).toBe("PAS DU TOUT LÉGAL · MAIS TRÈS SÉRIEUX ·");
    expect(TEXT.seal).toBe("Sceller l'acte");
    expect(TEXT.unreadableTitle).toBe("Acte illisible");
    expect(TEXT.restart).toBe("Rédiger un nouvel acte");
    expect(TEXT.unknownVersionTitle).toBe("Acte d'une version inconnue");
  });

  it("verdict : nom du vainqueur, ou match nul", () => {
    expect(verdictLine("p", DEED)).toContain("Théo");
    expect(verdictLine("c", DEED)).toContain("Sam");
    expect(verdictLine("n", DEED)).toBe("Match nul déclaré.");
  });

  it("acte jugé : « Verdict déclaré. Échéance du pari : … », sans date de verdict", () => {
    expect(judgedLine("17 octobre 2026")).toBe(
      `Verdict déclaré. Échéance du pari${NBSP}: 17 octobre 2026.`,
    );
    expect(judgedLine("17 octobre 2026")).not.toMatch(/Jugé/u);
  });

  it("erreurs de champ : borne propre à chaque texte, heure sautée, acte trop long", () => {
    expect(fieldErrorText({ field: "bettor", index: 0, code: "too-long" })).toBe(
      "40 caractères au maximum.",
    );
    expect(fieldErrorText({ field: "subject", index: 0, code: "too-long" })).toBe(
      "200 caractères au maximum.",
    );
    expect(fieldErrorText({ field: "article", index: 2, code: "too-long" })).toBe(
      "160 caractères au maximum.",
    );
    expect(fieldErrorText({ field: "deadline", index: 0, code: "nonexistent-time" })).toMatch(
      /n'existe pas.*heure d'été/u,
    );
    expect(fieldErrorText({ field: "stake", index: 0, code: "link-too-long" })).toMatch(
      /trop de place dans le lien/u,
    );
  });

  it("résumé : « Acte trop long pour tenir dans un lien » seul, sinon le nombre de champs", () => {
    expect(formErrorText([{ field: "subject", index: 0, code: "link-too-long" }])).toBe(
      TEXT.linkTooLong,
    );
    expect(TEXT.linkTooLong).toMatch(/^Acte trop long pour tenir dans un lien/u);
    expect(
      formErrorText([
        { field: "bettor", index: 0, code: "empty" },
        { field: "deadline", index: 0, code: "past-date" },
      ]),
    ).toBe("2 champs à corriger.");
    expect(formErrorText([{ field: "bettor", index: 0, code: "empty" }])).toBe(
      "1 champ à corriger.",
    );
  });
});

describe("dates fr-FR", () => {
  it("dans le fuseau demandé (celui de l'appareil dans le navigateur)", () => {
    expect(formatDate(DEED.draftedAt, "Europe/Paris")).toBe("14 octobre 2026");
    expect(formatDateTime(DEED.deadline, "Europe/Paris")).toBe("17 octobre 2026 à 20:00");
    expect(formatDateTime(DEED.deadline, "America/New_York")).toBe("17 octobre 2026 à 14:00");
    // Un acte rédigé le 31/12 à 23 h 30 UTC est du 1er janvier à Paris.
    expect(formatDate(Date.UTC(2026, 11, 31, 23, 30), "Europe/Paris")).toBe("1 janvier 2027");
  });
});
