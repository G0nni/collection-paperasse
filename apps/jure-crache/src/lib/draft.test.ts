import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NBSP } from "@paperasse/shared/typography";
import { canonicalJson } from "./deed";
import {
  DEFAULT_ARTICLES,
  MISSING_DEADLINE,
  NONEXISTENT_DEADLINE,
  deadlineAt,
  defaultDeadline,
  largestText,
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
  deadline: deadlineAt(NOW + 3 * 86_400_000),
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
    expect(result.deed).toEqual({ ...DRAFT, deadline: NOW + 3 * 86_400_000, draftedAt: NOW });
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
        deadline: MISSING_DEADLINE,
      },
      NOW,
    );
    expect(result).toEqual({
      ok: false,
      reason: "fields",
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
      const result = validateDraft({ ...DRAFT, deadline: deadlineAt(deadline) }, NOW);
      expect(!result.ok && result.errors).toEqual([
        { field: "deadline", index: 0, code: "past-date" },
      ]);
    }
    expect(validateDraft({ ...DRAFT, deadline: deadlineAt(NOW + 1) }, NOW).ok).toBe(true);
  });

  it("échéance à plus de 10 ans : erreur", () => {
    const tenYears = Date.UTC(2036, 9, 14, 9, 0, 0);
    expect(validateDraft({ ...DRAFT, deadline: deadlineAt(tenYears) }, NOW).ok).toBe(true);
    const result = validateDraft({ ...DRAFT, deadline: deadlineAt(tenYears + 1) }, NOW);
    expect(!result.ok && result.errors).toEqual([{ field: "deadline", index: 0, code: "too-far" }]);
  });

  it("0 article est permis ; au-delà de 5, les suivants sont ignorés", () => {
    expect(validateDraft({ ...DRAFT, articles: [] }, NOW).ok).toBe(true);
    const six = validateDraft({ ...DRAFT, articles: ["1", "2", "3", "4", "5", "6"] }, NOW);
    expect(six.ok && six.deed.articles).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("horloge de l'appareil avant 2026 : refus, l'acte ne serait pas relu", () => {
    const early = Date.UTC(2025, 5, 1);
    const result = validateDraft({ ...DRAFT, deadline: deadlineAt(early + 86_400_000) }, early);
    expect(result).toEqual({ ok: false, reason: "clock", errors: [] });
    // Un champ en erreur passe avant l'horloge : c'est lui qu'il faut corriger d'abord.
    const both = validateDraft(
      { ...DRAFT, bettor: "", deadline: deadlineAt(early + 86_400_000) },
      early,
    );
    expect(both).toEqual({
      ok: false,
      reason: "fields",
      errors: [{ field: "bettor", index: 0, code: "empty" }],
    });
  });

  it("l'erreur d'échéance ferme la liste, seule ou après les autres", () => {
    expect(validateDraft({ ...DRAFT, deadline: MISSING_DEADLINE }, NOW)).toEqual({
      ok: false,
      reason: "fields",
      errors: [{ field: "deadline", index: 0, code: "missing-date" }],
    });
    const both = validateDraft({ ...DRAFT, stake: "", deadline: deadlineAt(NOW - 1) }, NOW);
    expect(!both.ok && both.errors).toEqual([
      { field: "stake", index: 0, code: "empty" },
      { field: "deadline", index: 0, code: "past-date" },
    ]);
    // Un instant qui n'est pas un entier sûr (NaN, infini) vaut une date manquante.
    for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const result = validateDraft({ ...DRAFT, deadline: deadlineAt(ms) }, NOW);
      expect(!result.ok && result.errors).toEqual([
        { field: "deadline", index: 0, code: "missing-date" },
      ]);
    }
  });

  it("heure sautée au passage à l'heure d'été : erreur sur l'échéance", () => {
    const result = validateDraft({ ...DRAFT, deadline: NONEXISTENT_DEADLINE }, NOW);
    expect(result).toEqual({
      ok: false,
      reason: "fields",
      errors: [{ field: "deadline", index: 0, code: "nonexistent-time" }],
    });
  });

  it("CL-9 · acte dans les bornes, lien de plus de 4 Ko : erreur sur le texte le plus lourd une fois compressé", () => {
    // Des idéogrammes tous différents se compressent mal : l'acte respecte les bornes, pas le lien.
    let next = 0;
    const rare = (length: number) =>
      Array.from({ length }, () => String.fromCodePoint(0x4e00 + ((next++ * 7919) % 20_000))).join(
        "",
      );
    const exotic: Draft = {
      ...DRAFT,
      bettor: rare(40),
      opponent: rare(40),
      subject: rare(200),
      stake: rare(120),
      articles: Array.from({ length: 5 }, () => rare(160)),
    };
    expect(validateDraft(exotic, NOW)).toEqual({
      ok: false,
      reason: "fields",
      errors: [{ field: "subject", index: 0, code: "link-too-long" }],
    });
    // Objet court, 3e article le plus long : c'est lui qui est désigné.
    const heavy: Draft = {
      ...exotic,
      subject: "Court.",
      articles: [rare(150), rare(150), rare(160), rare(150), rare(150)],
    };
    expect(validateDraft(heavy, NOW)).toEqual({
      ok: false,
      reason: "fields",
      errors: [{ field: "article", index: 2, code: "link-too-long" }],
    });
  });
});

describe("largestText", () => {
  it("le texte le plus lourd une fois compressé, le premier du formulaire à égalité", () => {
    const deed = { ...DRAFT, deadline: NOW + 1, draftedAt: NOW };
    // Le 3e article par défaut (SNCF, 103 caractères) pèse plus que l'objet (48).
    expect(largestText(deed)).toEqual({ field: "article", index: 2 });
    expect(largestText({ ...deed, articles: [] })).toEqual({ field: "subject", index: 0 });
    expect(
      largestText({ ...deed, bettor: "a", opponent: "b", subject: "c", stake: "d", articles: [] }),
    ).toEqual({ field: "bettor", index: 0 });
  });
});

describe("champ datetime-local", () => {
  // Le fuseau du moteur décide de l'heure locale : Paris, comme les tests e2e.
  const savedTimeZone = process.env["TZ"];
  beforeEach(() => {
    process.env["TZ"] = "Europe/Paris";
  });
  afterEach(() => {
    if (savedTimeZone === undefined) delete process.env["TZ"];
    else process.env["TZ"] = savedTimeZone;
  });

  it("passage à l'heure d'été (29 mars 2026, Paris) : 2 h 30 n'existe pas, 1 h 59 et 3 h 00 oui", () => {
    const day = { year: 2026, month: 3, day: 29 };
    expect(localToEpoch({ ...day, hour: 2, minute: 30 })).toEqual(NONEXISTENT_DEADLINE);
    expect(localToEpoch({ ...day, hour: 2, minute: 0 })).toEqual(NONEXISTENT_DEADLINE);
    expect(localToEpoch({ ...day, hour: 1, minute: 59 })).toEqual(
      deadlineAt(Date.UTC(2026, 2, 29, 0, 59)),
    );
    expect(localToEpoch({ ...day, hour: 3, minute: 0 })).toEqual(
      deadlineAt(Date.UTC(2026, 2, 29, 1, 0)),
    );
    // Retour à l'heure d'hiver : 2 h 30 existe deux fois, le moteur prend la première.
    expect(localToEpoch({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 })).toEqual(
      deadlineAt(Date.UTC(2026, 9, 25, 0, 30)),
    );
  });

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
    expect(localToEpoch(local)).toEqual(deadlineAt(new Date(2026, 9, 17, 20, 0).getTime()));
    expect(localToEpoch({ ...local, month: 2, day: 30 })).toEqual(MISSING_DEADLINE);
    expect(localToEpoch({ ...local, month: 13 })).toEqual(MISSING_DEADLINE);
    expect(localToEpoch({ ...local, hour: 24 })).toEqual(MISSING_DEADLINE);
    expect(localToEpoch({ ...local, minute: 60 })).toEqual(MISSING_DEADLINE);
  });

  it("toLocalInputValue fait l'aller-retour avec parseLocalDateTime + localToEpoch", () => {
    const ms = new Date(2026, 9, 17, 20, 5).getTime();
    expect(toLocalInputValue(ms)).toBe("2026-10-17T20:05");
    const parsed = parseLocalDateTime(toLocalInputValue(ms));
    expect(parsed && localToEpoch(parsed)).toEqual(deadlineAt(ms));
  });

  it("échéance proposée : dans 7 jours à 20 h, heure locale, toujours dans le futur", () => {
    const now = new Date(2026, 9, 14, 23, 59).getTime();
    const proposed = new Date(defaultDeadline(now));
    expect([proposed.getDate(), proposed.getHours(), proposed.getMinutes()]).toEqual([21, 20, 0]);
    expect(validateDraft({ ...DRAFT, deadline: deadlineAt(defaultDeadline(NOW)) }, NOW).ok).toBe(
      true,
    );
  });
});
