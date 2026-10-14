import { describe, expect, it } from "vitest";
import {
  canRemove,
  checkRow,
  nextSuggestion,
  rowsFrom,
  suggestedRate,
  validParticipants,
  type DraftRow,
} from "./drafts";
import { ROLES } from "./meeting";

const row = (label: string, rate: string, id = 1): DraftRow => ({ id, label, rate });

describe("checkRow", () => {
  it("ligne valide : participant nettoyé", () => {
    expect(checkRow(row("  Kevin  ", "48"))).toEqual({
      participant: { rate: 48, label: "Kevin" },
      labelError: false,
      rateError: false,
    });
  });

  it("mêmes règles que le lien (CL-5)", () => {
    for (const rate of ["12.5", "-3", "1e3", "NaN", "", "1001", "abc"]) {
      expect(checkRow(row("Kevin", rate))).toMatchObject({ participant: null, rateError: true });
    }
    for (const label of ["", "   ", "x".repeat(41)]) {
      expect(checkRow(row(label, "10"))).toMatchObject({ participant: null, labelError: true });
    }
  });

  it("libellé avec du HTML : gardé tel quel", () => {
    expect(checkRow(row("<b>Kevin</b>", "10")).participant).toEqual({
      rate: 10,
      label: "<b>Kevin</b>",
    });
  });
});

describe("validParticipants", () => {
  it("garde les lignes valides, dans l'ordre", () => {
    const checks = [row("A", "1"), row("", "2"), row("C", "x"), row("D", "4")].map(checkRow);
    expect(validParticipants(checks)).toEqual([
      { rate: 1, label: "A" },
      { rate: 4, label: "D" },
    ]);
  });
});

describe("suggestions", () => {
  it("le taux suggéré n'existe que pour un libellé exact de la liste", () => {
    expect(suggestedRate("Patrick")).toBe(55);
    expect(suggestedRate("  Consultant externe ")).toBe(120);
    expect(suggestedRate("patrick")).toBeNull();
    expect(suggestedRate("Kevin")).toBeNull();
  });

  it("la prochaine personne est la première suggestion absente, sinon on recycle", () => {
    expect(nextSuggestion([])).toEqual(ROLES[0]);
    const firstFive = ROLES.slice(0, 5).map((role) => role.label);
    expect(nextSuggestion(firstFive)).toEqual(ROLES[5]);
    const everyone = ROLES.map((role) => role.label);
    expect(ROLES).toContainEqual(nextSuggestion(everyone));
    expect(nextSuggestion(everyone)).toEqual(ROLES[everyone.length % ROLES.length]);
  });
});

describe("canRemove", () => {
  it("jamais la dernière ligne", () => {
    expect(canRemove([checkRow(row("A", "1"))], 0)).toBe(false);
  });

  it("jamais le dernier participant valide, mais une ligne invalide oui", () => {
    const checks = [checkRow(row("A", "1")), checkRow(row("", "2"))];
    expect(canRemove(checks, 0)).toBe(false);
    expect(canRemove(checks, 1)).toBe(true);
  });

  it("deux participants valides : chacun peut partir", () => {
    const checks = [checkRow(row("A", "1")), checkRow(row("B", "2"))];
    expect(canRemove(checks, 0)).toBe(true);
    expect(canRemove(checks, 1)).toBe(true);
  });
});

describe("rowsFrom", () => {
  it("convertit les participants en lignes numérotées", () => {
    expect(rowsFrom([{ rate: 6, label: "Stagiaire" }], 4)).toEqual([
      { id: 4, label: "Stagiaire", rate: "6" },
    ]);
  });
});
