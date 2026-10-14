import { NBSP } from "@paperasse/shared/typography";
import { describe, expect, it } from "vitest";
import type { Meeting } from "./meeting";
import {
  SPLIT,
  costCents,
  elapsed,
  endFor,
  hourlyCents,
  mailVerdict,
  receiptLines,
  splitCost,
} from "./meter";

const S = 1_760_425_200;
const running = (participants: Meeting["participants"], tariff: Meeting["tariff"] = "A") =>
  ({ tariff, participants, title: "", start: S, end: null }) satisfies Meeting;

describe("elapsed", () => {
  it("compte depuis s, à la seconde entière", () => {
    const meeting = running([{ rate: 10, label: "X" }]);
    expect(elapsed(meeting, (S + 42) * 1000)).toEqual({ seconds: 42, capped: false });
    expect(elapsed(meeting, (S + 42) * 1000 + 999)).toEqual({ seconds: 42, capped: false });
  });

  it("s jusqu'à 60 s dans le futur : 0, jamais négatif", () => {
    expect(elapsed(running([]), (S - 30) * 1000).seconds).toBe(0);
  });

  it("CL-2 · plus de 24 h sans e : arrêté à 24 h, signalé", () => {
    const meeting = running([{ rate: 10, label: "X" }]);
    expect(elapsed(meeting, (S + 86_400) * 1000)).toEqual({ seconds: 86_400, capped: false });
    expect(elapsed(meeting, (S + 86_401) * 1000)).toEqual({ seconds: 86_400, capped: true });
    expect(elapsed(meeting, (S + 10 * 86_400) * 1000)).toEqual({ seconds: 86_400, capped: true });
  });

  it("CA-6 · avec e, la durée ne dépend plus de l'heure", () => {
    const ended = { ...running([{ rate: 10, label: "X" }]), end: S + 600 };
    expect(elapsed(ended, (S + 601) * 1000)).toEqual({ seconds: 600, capped: false });
    expect(elapsed(ended, (S + 999_999) * 1000)).toEqual({ seconds: 600, capped: false });
  });

  it("Configuration (pas de s) : 0", () => {
    expect(elapsed({ ...running([]), start: null }, S * 1000).seconds).toBe(0);
  });
});

describe("costCents", () => {
  it("coût = durée / 3600 × Σ taux × multiplicateur", () => {
    // 42 min à 354 €/h : 247,80 €, l'exemple du résumé accessible de la spec.
    expect(costCents(2520, [{ rate: 354, label: "X" }], "A")).toBe(24_780);
    // Exemple de la spec : 68 + 48 + 6 = 122 €/h, tarif B ×1,5 = 183 €/h, 1 h = 183 €.
    const people = [
      { rate: 68, label: "Cheffe" },
      { rate: 48, label: "Kevin" },
      { rate: 6, label: "Stagiaire" },
    ];
    expect(costCents(3600, people, "B")).toBe(18_300);
    expect(costCents(3600, people, "C")).toBe(24_400);
  });

  it("arrondi au centime le plus proche (demi vers le haut)", () => {
    // 1 s à 1 €/h ×1 = 0,0277… centime → 0 ; 18 s = 0,5 centime → 1.
    expect(costCents(1, [{ rate: 1, label: "X" }], "A")).toBe(0);
    expect(costCents(18, [{ rate: 1, label: "X" }], "A")).toBe(1);
    // 1 s à 1 €/h ×1,5 = 0,041666… centime.
    expect(costCents(12, [{ rate: 1, label: "X" }], "B")).toBe(1);
  });

  it("CL-6 · tous les taux à 0 : 0 centime", () => {
    expect(
      costCents(
        86_400,
        [
          { rate: 0, label: "A" },
          { rate: 0, label: "B" },
        ],
        "C",
      ),
    ).toBe(0);
  });

  it("pire cas borné : 30 × 1000 €/h × 2 pendant 24 h, entier exact", () => {
    const people = Array.from({ length: 30 }, () => ({ rate: 1000, label: "X" }));
    expect(costCents(86_400, people, "C")).toBe(144_000_000);
  });

  it("CA-3 · même lien, même instant : même montant, quelle que soit la milliseconde", () => {
    const meeting = running(
      [
        { rate: 95, label: "N+2" },
        { rate: 6, label: "Stagiaire" },
      ],
      "B",
    );
    const at = (ms: number) => costCents(elapsed(meeting, ms).seconds, meeting.participants, "B");
    expect(at((S + 1234) * 1000 + 10)).toBe(at((S + 1234) * 1000 + 990));
  });

  it("CA-5 · tarif rétroactif : changer de tarif recalcule tout depuis s", () => {
    const people = [{ rate: 100, label: "X" }];
    expect(costCents(1800, people, "A")).toBe(5000);
    expect(costCents(1800, people, "C")).toBe(10_000);
  });
});

describe("hourlyCents", () => {
  it("Σ taux × multiplicateur, en centimes", () => {
    expect(hourlyCents([{ rate: 245, label: "X" }], "B")).toBe(36_750);
    expect(hourlyCents([], "C")).toBe(0);
  });
});

describe("splitCost", () => {
  it("pourcentages de la spec, dans l'ordre", () => {
    expect(SPLIT.map((part) => part.percent)).toEqual([32, 14, 28, 26]);
    expect(SPLIT.reduce((sum, part) => sum + part.percent, 0)).toBe(100);
    expect(splitCost(10_000).map((line) => line.cents)).toEqual([3200, 1400, 2800, 2600]);
  });

  it("la somme des lignes vaut toujours le total, sans ligne négative", () => {
    const totals = [
      ...Array.from({ length: 5001 }, (_, cents) => cents),
      24_780,
      99_999,
      144_000_000,
      123_456_789,
    ];
    for (const total of totals) {
      const lines = splitCost(total);
      expect(lines.reduce((sum, line) => sum + line.cents, 0)).toBe(total);
      expect(lines.every((line) => line.cents >= 0)).toBe(true);
    }
  });

  it("le reste d'arrondi va sur la dernière ligne", () => {
    // 1 centime : 0,32 + 0,14 + 0,28 arrondis à 0, tout part sur le récap.
    expect(splitCost(1).map((line) => line.cents)).toEqual([0, 0, 0, 1]);
    // 24 780 : 7929,6 → 7929 ; 3469,2 → 3469 ; 6938,4 → 6938 ; reste 6444.
    expect(splitCost(24_780).map((line) => line.cents)).toEqual([7929, 3469, 6938, 6444]);
  });
});

describe("receiptLines", () => {
  it("« Café tiède × N » à 0, puis les quatre lignes", () => {
    const lines = receiptLines(5, 24_780);
    expect(lines[0]).toEqual({ label: `Café tiède ×${NBSP}5`, cents: 0 });
    expect(lines.slice(1).map((line) => line.label)).toEqual([
      "Tour de table",
      `«${NBSP}Tu m'entends, là${NBSP}?${NBSP}»`,
      "Digression sur le parking",
      "Récap de ce qui vient d'être dit",
    ]);
    expect(lines.reduce((sum, line) => sum + line.cents, 0)).toBe(24_780);
  });
});

describe("mailVerdict", () => {
  it("OUI au tarif C, PEUT-ÊTRE sinon", () => {
    expect(mailVerdict("C")).toBe("OUI");
    expect(mailVerdict("A")).toBe("PEUT-ÊTRE");
    expect(mailVerdict("B")).toBe("PEUT-ÊTRE");
  });
});

describe("endFor", () => {
  it("CA-6 · e = maintenant", () => {
    expect(endFor(S, (S + 600) * 1000 + 500)).toBe(S + 600);
  });

  it("dans la seconde du lancement : s + 1, pour que e reste valide (e > s)", () => {
    expect(endFor(S, S * 1000 + 400)).toBe(S + 1);
    expect(endFor(S, (S - 30) * 1000)).toBe(S + 1);
  });

  it("après 24 h : s + 24 h, la borne de e", () => {
    expect(endFor(S, (S + 90_000) * 1000)).toBe(S + 86_400);
  });
});
