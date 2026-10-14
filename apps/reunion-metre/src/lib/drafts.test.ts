import { describe, expect, it } from "vitest";
import {
  canRemove,
  checkRow,
  nextSuggestion,
  proposeMeeting,
  rowsFrom,
  suggestedRate,
  validParticipants,
  type DraftRow,
} from "./drafts";
import { buildQuery } from "./link";
import { ROLES, defaultMeeting, type Meeting } from "./meeting";

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

describe("proposeMeeting", () => {
  const S = 1_760_425_200;
  const running: Meeting = {
    tariff: "C",
    participants: [{ rate: 10, label: "Ana" }],
    title: "Revue",
    start: S,
    end: null,
  };

  it("remplace les participants par les lignes valides, garde le reste", () => {
    const proposal = proposeMeeting(running, [
      row("Bob", "20"),
      row("", "5", 2),
      row("Eve", "x", 3),
    ]);
    expect(proposal).toEqual({
      ok: true,
      meeting: { ...running, participants: [{ rate: 20, label: "Bob" }] },
    });
  });

  it("aucune ligne valide : refusé, la réunion ne change pas", () => {
    expect(proposeMeeting(running, [row("", "10"), row("Bob", "-1", 2)])).toEqual({
      ok: false,
      error: "no-valid-people",
    });
    expect(proposeMeeting(running, [])).toEqual({ ok: false, error: "no-valid-people" });
  });

  it("CL-8 · lien de plus de 4 Ko : refusé", () => {
    const crowded = Array.from({ length: 30 }, (_, index) => row("é".repeat(40), "1000", index));
    expect(proposeMeeting(running, crowded)).toEqual({ ok: false, error: "link-too-long" });
  });

  it("CL-8 · un lien de 4 096 caractères pile passe, un de plus non", () => {
    const base: Meeting = { ...defaultMeeting(), title: "" };
    // 30 libellés « %%%… » : 3 caractères encodés chacun, le lien approche des 4 Ko.
    const many = Array.from({ length: 30 }, (_, index) => row("%".repeat(40), "1000", index));
    const crowd = many.map(() => ({ rate: 1000, label: "%".repeat(40) }));
    // Longueur de la query brute, sans le « ? » (ce que mesure CL-8).
    const lengthWith = (title: string) =>
      buildQuery({ ...base, title, participants: crowd }).length - 1;
    const room = 4096 - lengthWith("");
    // « &n= » prend 3 caractères, chaque « a » un de plus.
    const fits = "a".repeat(room - 3);
    expect(lengthWith(fits)).toBe(4096);
    expect(proposeMeeting({ ...base, title: fits }, many).ok).toBe(true);
    expect(proposeMeeting({ ...base, title: `${fits}a` }, many)).toEqual({
      ok: false,
      error: "link-too-long",
    });
  });

  it("sert aussi au lancement : début et titre passés dans la base", () => {
    const setup = { ...running, start: null, end: null };
    const proposal = proposeMeeting({ ...setup, start: S + 5, end: null }, [row("Ana", "10")]);
    expect(proposal.ok && proposal.meeting.start).toBe(S + 5);
  });
});
