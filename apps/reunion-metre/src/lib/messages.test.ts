import { EM_DASH, findTypographyIssues, formatTypographyIssue } from "@paperasse/shared/typography";
import { describe, expect, it } from "vitest";
import type { NoticeCode } from "./link";
import { ROLES, TARIFFS } from "./meeting";
import { receiptLines } from "./meter";
import { TEXT, noticeText, rateText, removeContext, rowLegend } from "./messages";

const NOTICE_CODES: Readonly<Record<NoticeCode, true>> = {
  "unknown-version": true,
  "too-long": true,
  "future-start": true,
  "bad-start": true,
  "bad-end": true,
  "future-end": true,
  "end-without-start": true,
  "bad-tariff": true,
  "bad-title": true,
  "too-many-participants": true,
  "ignored-participants": true,
  "no-participants": true,
};

/** Contrôles C0/C1, zéro-largeur et marques bidirectionnelles. */
const FORBIDDEN = new RegExp(
  `[${[
    [0x00, 0x1f],
    [0x7f, 0x9f],
    [0x200b, 0x200f],
    [0x202a, 0x202e],
    [0x2066, 0x2069],
  ]
    .map(([from = 0, to = 0]) => `\\u{${from.toString(16)}}-\\u{${to.toString(16)}}`)
    .join("")}]`,
  "u",
);

function allTexts(): string[] {
  const codes = Object.keys(NOTICE_CODES).filter(
    (code): code is NoticeCode => code in NOTICE_CODES,
  );
  return [
    ...Object.values(TEXT),
    ...codes.flatMap((code) => [noticeText({ code, count: 1 }), noticeText({ code, count: 3 })]),
    rowLegend(3),
    `${TEXT.remove} ${removeContext(3)}`,
    rateText(68),
    ...ROLES.map((role) => role.label),
    ...Object.values(TARIFFS).flatMap((tariff) => [tariff.name, tariff.factor]),
    ...receiptLines(5, 24_780).map((line) => line.label),
  ];
}

describe("textes du look", () => {
  it("passent l'oracle typographique de la collection", () => {
    const issues = allTexts().flatMap((text) =>
      findTypographyIssues(text).map((issue) => `${text} → ${formatTypographyIssue(issue)}`),
    );
    expect(issues).toEqual([]);
  });

  it("aucun tiret cadratin ni caractère de contrôle ou bidirectionnel", () => {
    for (const text of allTexts()) {
      expect(text).not.toContain(EM_DASH);
      expect(text).not.toMatch(FORBIDDEN);
    }
  });

  it("messages imposés par la spec, mot pour mot", () => {
    expect(noticeText({ code: "future-start", count: 1 })).toBe(
      "Cette réunion n'a pas encore commencé. Profitez-en.",
    );
    expect(noticeText({ code: "unknown-version", count: 1 })).toContain(
      "Lien d'une version inconnue",
    );
    expect(noticeText({ code: "too-long", count: 1 })).toContain("Lien trop long");
    expect(TEXT.volunteer).toBe("Réunion bénévole. Suspect.");
    expect(TEXT.capped.replaceAll(String.fromCodePoint(0xa0), " ")).toBe(
      "Réunion de plus de 24 h. Respirez.",
    );
  });

  it("ignored-participants s'accorde", () => {
    expect(noticeText({ code: "ignored-participants", count: 1 })).toBe(
      "1 participant illisible a été ignoré.",
    );
    expect(noticeText({ code: "ignored-participants", count: 4 })).toBe(
      "4 participants illisibles ont été ignorés.",
    );
  });

  it("CA-1 · étiquettes des champs participant", () => {
    expect(TEXT.whoLabel).toBe("Qui");
    expect(TEXT.rateLabel).toBe("€/heure");
    expect(TEXT.remove).toBe("Retirer");
    expect(TEXT.launch).toBe("Lancer le compteur");
  });

  it("tarifs de la spec", () => {
    expect(TARIFFS.A.name).toBe("Point rapide");
    expect(TARIFFS.B.name).toBe("Sans ordre du jour");
    expect(TARIFFS.C.name).toBe("Aurait pu être un mail");
  });
});
