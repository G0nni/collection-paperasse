import { NARROW_NBSP, NBSP } from "@paperasse/shared/typography";
import { describe, expect, it } from "vitest";
import type { Meeting } from "./meeting";
import {
  formatClock,
  formatCount,
  formatDate,
  formatEuros,
  formatHourly,
  formatTime,
  ghostDigits,
  ledAmount,
  ledHourly,
  receiptWhen,
  spokenAmount,
  spokenDuration,
  spokenSummary,
} from "./format";

describe("montants", () => {
  it("Intl fr-FR EUR, arrondi au centime déjà fait", () => {
    expect(formatEuros(24_780)).toBe(`247,80${NBSP}€`);
    expect(formatEuros(0)).toBe(`0,00${NBSP}€`);
    expect(formatEuros(124_780)).toBe(`1${NARROW_NBSP}247,80${NBSP}€`);
  });

  it("coût horaire : sans centimes s'il tombe rond", () => {
    expect(formatHourly(24_500)).toBe(`245${NBSP}€`);
    expect(formatHourly(36_750)).toBe(`367,50${NBSP}€`);
  });

  it("afficheur LED : sans symbole, milliers séparés par U+00A0 (dessinée par Doto)", () => {
    expect(ledAmount(24_780)).toBe("247,80");
    expect(ledAmount(0)).toBe("0,00");
    expect(ledAmount(144_000_000)).toBe(`1${NBSP}440${NBSP}000,00`);
  });
});

describe("CA-9 · chiffres fantômes", () => {
  it.each([0, 5, 99, 999, 24_780, 99_999, 100_000, 144_000_000])(
    "%i centimes : des 8 à la place des chiffres, même nombre de caractères",
    (cents) => {
      const amount = ledAmount(cents);
      const ghost = ghostDigits(amount);
      expect(ghost).toHaveLength(amount.length);
      expect(ghost).toMatch(new RegExp(`^[8,${NBSP}]+$`, "u"));
      expect(ghost.replaceAll("8", "")).toBe(amount.replace(/\d/gu, ""));
    },
  );

  it("exemple : 1 247,80 → 8 888,88", () => {
    expect(ghostDigits(`1${NBSP}247,80`)).toBe(`8${NBSP}888,88`);
  });
});

describe("durée", () => {
  it("HH:MM:SS jusqu'à 24 h", () => {
    expect(formatClock(0)).toBe("00:00:00");
    expect(formatClock(2537)).toBe("00:42:17");
    expect(formatClock(3661)).toBe("01:01:01");
    expect(formatClock(86_400)).toBe("24:00:00");
  });

  it("nombre de personnes sur deux chiffres", () => {
    expect(formatCount(5)).toBe("05");
    expect(formatCount(30)).toBe("30");
  });
});

describe("CA-8 · résumé accessible", () => {
  it("exemple de la spec", () => {
    expect(spokenSummary(24_780, 2520)).toBe("247 euros et 80 centimes, 42 minutes");
  });

  it("accords", () => {
    expect(spokenAmount(0)).toBe("0 euro");
    expect(spokenAmount(1)).toBe("0 euro et 1 centime");
    expect(spokenAmount(100)).toBe("1 euro");
    expect(spokenAmount(201)).toBe("2 euros et 1 centime");
    expect(spokenAmount(144_000_000)).toBe("1440000 euros");
  });

  it("durées", () => {
    expect(spokenDuration(0)).toBe("0 seconde");
    expect(spokenDuration(1)).toBe("1 seconde");
    expect(spokenDuration(59)).toBe("59 secondes");
    expect(spokenDuration(60)).toBe("1 minute");
    expect(spokenDuration(119)).toBe("1 minute");
    expect(spokenDuration(3600)).toBe("1 heure");
    expect(spokenDuration(3900)).toBe("1 heure 5 minutes");
    expect(spokenDuration(86_400)).toBe("24 heures");
  });
});

describe("CL-10 · dates à l'heure de l'appareil", () => {
  it("formatées en fr-FR dans le fuseau donné", () => {
    expect(formatDate(1_760_425_200, "Europe/Paris")).toBe("14/10/2025");
    expect(formatTime(1_760_425_200, "Europe/Paris")).toBe("09:00");
    expect(formatTime(1_760_425_200, "America/New_York")).toBe("03:00");
  });
});

describe("coût horaire en chiffres Doto", () => {
  it("milliers en U+00A0 (Doto n'a pas U+202F), symbole après, comme Intl", () => {
    expect(ledHourly(52_200)).toBe(`522${NBSP}€`);
    expect(ledHourly(6_000_000)).toBe(`60${NBSP}000${NBSP}€`);
    expect(ledHourly(36_750)).toBe(`367,50${NBSP}€`);
    expect(ledHourly(6_000_000)).not.toContain(NARROW_NBSP);
  });
});

describe("CL-10 · ligne « quand » du ticket", () => {
  const PARIS = "Europe/Paris";
  /** 14/10/2026 23:50 à Paris. */
  const LATE = Date.UTC(2026, 9, 14, 21, 50, 0) / 1000;
  const base = { tariff: "A", participants: [{ rate: 1, label: "Ana" }], title: "" } as const;
  const at = (start: number, end: number | null): Meeting => ({ ...base, start, end });

  it("vide tant que la réunion n'est pas lancée", () => {
    expect(receiptWhen({ ...base, start: null, end: null }, PARIS)).toBe("");
  });

  it("en cours", () => {
    expect(receiptWhen(at(LATE, null), PARIS)).toBe("14/10/2026 · 23:50 – en cours");
  });

  it("même jour : l'heure de fin seule", () => {
    expect(receiptWhen(at(LATE, LATE + 540), PARIS)).toBe("14/10/2026 · 23:50 – 23:59");
  });

  it("autour de minuit : la date de fin s'ajoute dès qu'on change de jour", () => {
    expect(receiptWhen(at(LATE, LATE + 599), PARIS)).toBe("14/10/2026 · 23:50 – 23:59");
    expect(receiptWhen(at(LATE, LATE + 600), PARIS)).toBe("14/10/2026 · 23:50 – 15/10/2026 00:00");
    expect(receiptWhen(at(LATE, LATE + 1200), PARIS)).toBe("14/10/2026 · 23:50 – 15/10/2026 00:10");
  });

  it("le jour dépend du fuseau de l'appareil, pas de l'UTC", () => {
    // 21:50 UTC → 23:50 à Paris, 17:50 à New York : même jour à New York.
    expect(receiptWhen(at(LATE, LATE + 1200), "America/New_York")).toBe(
      "14/10/2026 · 17:50 – 18:10",
    );
  });
});
