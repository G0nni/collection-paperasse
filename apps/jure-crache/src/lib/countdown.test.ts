import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everySecond } from "@paperasse/shared/ticker";
import { countdown, spokenCountdown, stubs } from "./countdown";

const D = Date.UTC(2026, 9, 17, 18, 0, 0);
const PASSED = "Échéance passée.";

describe("CA-4 · countdown", () => {
  it("jours, heures, minutes, secondes restants", () => {
    const now = D - (3 * 86_400 + 11 * 3600 + 42 * 60 + 9) * 1000;
    expect(countdown(D, now)).toEqual({
      passed: false,
      days: 3,
      hours: 11,
      minutes: 42,
      seconds: 9,
    });
    expect(stubs({ passed: false, days: 3, hours: 11, minutes: 42, seconds: 9 })).toEqual([
      { value: "03", unit: "jours" },
      { value: "11", unit: "heures" },
      { value: "42", unit: "min" },
      { value: "09", unit: "sec" },
    ]);
  });

  it("arrondi à la seconde supérieure, bascule pile à l'échéance", () => {
    expect(countdown(D, D - 1)).toEqual({
      passed: false,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 1,
    });
    expect(countdown(D, D - 1000)).toEqual({
      passed: false,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 1,
    });
    expect(countdown(D, D)).toEqual({ passed: true });
    expect(countdown(D, D + 5000)).toEqual({ passed: true });
  });

  it("10 ans de délai : les jours dépassent 99 sans perdre de chiffre", () => {
    const now = D - 3652 * 86_400_000;
    const remaining = countdown(D, now);
    expect(remaining).toEqual({ passed: false, days: 3652, hours: 0, minutes: 0, seconds: 0 });
    if (!remaining.passed) expect(stubs(remaining)[0]?.value).toBe("3652");
  });

  it("une horloge illisible (NaN) ne fait pas un compte à rebours infini", () => {
    expect(countdown(D, Number.NaN)).toEqual({ passed: true });
  });
});

describe("spokenCountdown (résumé accessible)", () => {
  it("à la minute près, accords et liste", () => {
    const at = (seconds: number) => spokenCountdown(countdown(D, D - seconds * 1000), PASSED);
    expect(at(3 * 86_400 + 11 * 3600 + 42 * 60 + 9)).toBe(
      "Échéance dans 3 jours, 11 heures et 42 minutes.",
    );
    expect(at(86_400 + 3600 + 60)).toBe("Échéance dans 1 jour, 1 heure et 1 minute.");
    expect(at(2 * 3600)).toBe("Échéance dans 2 heures.");
    expect(at(86_400 + 120)).toBe("Échéance dans 1 jour et 2 minutes.");
    expect(at(59)).toBe("Échéance dans moins d'une minute.");
    expect(spokenCountdown({ passed: true }, PASSED)).toBe(PASSED);
  });
});

describe("CA-4 · mise à jour chaque seconde (temps simulé)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(D - 10_000 - 400);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("une valeur par seconde, calée sur l'échéance, puis « passée »", () => {
    const seen: string[] = [];
    const render = () => {
      const remaining = countdown(D, Date.now());
      seen.push(remaining.passed ? "passée" : String(remaining.seconds));
    };
    render();
    const stop = everySecond(render, () => Date.now() - D, {
      set: (callback, delay) => setTimeout(callback, delay),
      clear: (handle) => clearTimeout(handle),
    });
    vi.advanceTimersByTime(400);
    expect(seen).toEqual(["11", "10"]);
    vi.advanceTimersByTime(10_000);
    stop();
    expect(seen).toEqual(["11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "passée"]);
  });
});
