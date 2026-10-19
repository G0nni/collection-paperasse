import { describe, expect, it } from "vitest";
import { NBSP } from "@paperasse/shared/typography";
import { canonicalJson } from "./deed";
import {
  DEFAULT_ARTICLES,
  defaultDeadline,
  localToEpoch,
  parseLocalDateTime,
  toLocalInputValue,
  validateDraft,
  type Draft,
} from "./draft";
import { buildHash, parseHash } from "./link";

const NOW = Date.UTC(2026, 9, 14, 9, 0, 0);

const DRAFT: Draft = {
  bettor: "Théo",
  opponent: "Sam",
  subject: "Kevin arrivera en retard à la soirée de samedi.",
  stake: "Un (1) kebab.",
  articles: [...DEFAULT_ARTICLES],
  deadline: NOW + 3 * 86_400_000,
};

describe("CA-10 · articles par défaut", () => {
  it("retard > 10 min ; « j'suis en bas » ne vaut pas arrivée ; la SNCF devant le tribunal", () => {
    expect(DEFAULT_ARTICLES).toHaveLength(3);
    expect(DEFAULT_ARTICLES[0]).toMatch(/retard.*dix \(10\) minutes/u);
    expect(DEFAULT_ARTICLES[1]).toBe(
      `Le message «${NBSP}j'suis en bas${NBSP}» ne vaut pas arrivée.`,
    );
    expect(DEFAULT_ARTICLES[2]).toMatch(/excuse impliquant la SNCF.*tribunal des potes/u);
  });
});

describe("CA-1 · validateDraft", () => {
  it("un formulaire valide donne un acte daté de maintenant, relu à l'identique par le lien", () => {
    const result = validateDraft(DRAFT, NOW);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.deed).toEqual({ ...DRAFT, draftedAt: NOW });
    const state = parseHash(buildHash(result.deed, null), NOW);
    expect(state.screen === "deed" && canonicalJson(state.deed)).toBe(canonicalJson(result.deed));
  });

  it("textes nettoyés comme dans le lien (trim, bidi, contrôles)", () => {
    const rlo = String.fromCodePoint(0x202e);
    const result = validateDraft({ ...DRAFT, bettor: `  Th${rlo}éo\t ` }, NOW);
    expect(result.ok && result.deed.bettor).toBe("Théo");
  });

  it("toutes les erreurs, dans l'ordre du formulaire", () => {
    const result = validateDraft(
      {
        bettor: "",
        opponent: "x".repeat(41),
        subject: "   ",
        stake: "y".repeat(121),
        articles: ["ok", "", "z".repeat(161)],
        deadline: null,
      },
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      clock: false,
      errors: [
        { field: "bettor", index: 0, code: "empty" },
        { field: "opponent", index: 0, code: "too-long" },
        { field: "subject", index: 0, code: "empty" },
        { field: "stake", index: 0, code: "too-long" },
        { field: "article", index: 1, code: "empty" },
        { field: "article", index: 2, code: "too-long" },
        { field: "deadline", index: 0, code: "missing-date" },
      ],
    });
  });

  it("bornes en points de code (pas de maxlength UTF-16) : 40 emoji passent, 41 non", () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(validateDraft({ ...DRAFT, bettor: emoji.repeat(40) }, NOW).ok).toBe(true);
    expect(validateDraft({ ...DRAFT, bettor: emoji.repeat(41) }, NOW).ok).toBe(false);
  });

  it("un texte fait d'invisibles est vide", () => {
    const result = validateDraft({ ...DRAFT, stake: "\u200b\u3164\u2800" }, NOW);
    expect(!result.ok && result.errors).toEqual([{ field: "stake", index: 0, code: "empty" }]);
  });

  it("CL-4 · « Théo » / « théo » : erreur sur le contre-parieur", () => {
    for (const opponent of ["théo", "THÉO", " Théo ", "Th\u200béo"]) {
      const result = validateDraft({ ...DRAFT, opponent }, NOW);
      expect(!result.ok && result.errors, opponent).toEqual([
        { field: "opponent", index: 0, code: "same-names" },
      ]);
    }
  });

  it("CL-5 · échéance déjà passée (ou maintenant) : erreur", () => {
    for (const deadline of [NOW, NOW - 1, NOW - 86_400_000]) {
      const result = validateDraft({ ...DRAFT, deadline }, NOW);
      expect(!result.ok && result.errors).toEqual([
        { field: "deadline", index: 0, code: "past-date" },
      ]);
    }
    expect(validateDraft({ ...DRAFT, deadline: NOW + 1 }, NOW).ok).toBe(true);
  });

  it("échéance à plus de 10 ans : erreur", () => {
    const tenYears = Date.UTC(2036, 9, 14, 9, 0, 0);
    expect(validateDraft({ ...DRAFT, deadline: tenYears }, NOW).ok).toBe(true);
    const result = validateDraft({ ...DRAFT, deadline: tenYears + 1 }, NOW);
    expect(!result.ok && result.errors).toEqual([{ field: "deadline", index: 0, code: "too-far" }]);
  });

  it("0 article est permis ; au-delà de 5, les suivants sont ignorés", () => {
    expect(validateDraft({ ...DRAFT, articles: [] }, NOW).ok).toBe(true);
    const six = validateDraft({ ...DRAFT, articles: ["1", "2", "3", "4", "5", "6"] }, NOW);
    expect(six.ok && six.deed.articles).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("horloge de l'appareil avant 2026 : refus, l'acte ne serait pas relu", () => {
    const early = Date.UTC(2025, 5, 1);
    const result = validateDraft({ ...DRAFT, deadline: early + 86_400_000 }, early);
    expect(result).toEqual({ ok: false, errors: [], clock: true });
  });
});

describe("champ datetime-local", () => {
  it("lit « AAAA-MM-JJTHH:MM » (secondes tolérées), refuse le reste", () => {
    expect(parseLocalDateTime("2026-10-17T20:00")).toEqual({
      year: 2026,
      month: 10,
      day: 17,
      hour: 20,
      minute: 0,
    });
    expect(parseLocalDateTime("2026-10-17T20:00:30.5")).not.toBeNull();
    for (const value of [
      "",
      "2026-10-17",
      "17/10/2026 20:00",
      "2026-10-17T20h00",
      "+2026-10-17T20:00",
    ]) {
      expect(parseLocalDateTime(value), value).toBeNull();
    }
  });

  it("localToEpoch : heure locale du moteur, dates impossibles refusées", () => {
    const local = { year: 2026, month: 10, day: 17, hour: 20, minute: 0 };
    expect(localToEpoch(local)).toBe(new Date(2026, 9, 17, 20, 0).getTime());
    expect(localToEpoch({ ...local, month: 2, day: 30 })).toBeNull();
    expect(localToEpoch({ ...local, month: 13 })).toBeNull();
  });

  it("toLocalInputValue fait l'aller-retour avec parseLocalDateTime + localToEpoch", () => {
    const ms = new Date(2026, 9, 17, 20, 5).getTime();
    expect(toLocalInputValue(ms)).toBe("2026-10-17T20:05");
    const parsed = parseLocalDateTime(toLocalInputValue(ms));
    expect(parsed && localToEpoch(parsed)).toBe(ms);
  });

  it("échéance proposée : dans 7 jours à 20 h, heure locale, toujours dans le futur", () => {
    const now = new Date(2026, 9, 14, 23, 59).getTime();
    const proposed = new Date(defaultDeadline(now));
    expect([proposed.getDate(), proposed.getHours(), proposed.getMinutes()]).toEqual([21, 20, 0]);
    expect(validateDraft({ ...DRAFT, deadline: defaultDeadline(NOW) }, NOW).ok).toBe(true);
  });
});
