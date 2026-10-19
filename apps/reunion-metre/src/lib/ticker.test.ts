import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUMMARY_INTERVAL_MS, everySecond, msToNextSecond, summaryDue } from "./ticker";

const realTimers = {
  set: (callback: () => void, delay: number) => setTimeout(callback, delay),
  clear: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
};

describe("everySecond", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T09:00:00.300Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("CA-4 · bat à chaque changement de seconde, recalé sur l'horloge", () => {
    const ticks: number[] = [];
    const stop = everySecond(() => ticks.push(Date.now() % 1000), Date.now, realTimers);
    vi.advanceTimersByTime(699);
    expect(ticks).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ticks).toEqual([0]);
    vi.advanceTimersByTime(3000);
    expect(ticks).toEqual([0, 0, 0, 0]);
    stop();
    vi.advanceTimersByTime(5000);
    expect(ticks).toHaveLength(4);
  });

  it("s'arrête si le callback l'arrête (passage au Ticket)", () => {
    let calls = 0;
    const stop: () => void = everySecond(
      () => {
        calls += 1;
        stop();
      },
      Date.now,
      realTimers,
    );
    vi.advanceTimersByTime(10_000);
    expect(calls).toBe(1);
  });

  it("CL-9 · onglet en arrière-plan : un battement en retard reste calé sur l'heure", () => {
    const seen: number[] = [];
    const stop = everySecond(() => seen.push(Math.floor(Date.now() / 1000)), Date.now, realTimers);
    // Le navigateur gèle les minuteurs : l'horloge avance sans battement.
    vi.setSystemTime(new Date("2026-10-14T09:10:00.500Z"));
    vi.advanceTimersByTime(700);
    vi.advanceTimersByTime(500);
    stop();
    expect(seen.at(-1)).toBe(Math.floor(Date.parse("2026-10-14T09:10:01.000Z") / 1000));
  });
});

describe("msToNextSecond", () => {
  it("délai dans ]0, 1000]", () => {
    expect(msToNextSecond(10_000)).toBe(1000);
    expect(msToNextSecond(10_001)).toBe(999);
    expect(msToNextSecond(10_999)).toBe(1);
  });
});

describe("CA-8 · summaryDue", () => {
  it("au premier affichage, puis au plus toutes les 30 s", () => {
    expect(SUMMARY_INTERVAL_MS).toBe(30_000);
    expect(summaryDue(null, 0)).toBe(true);
    expect(summaryDue(1000, 1000 + 29_999)).toBe(false);
    expect(summaryDue(1000, 1000 + 30_000)).toBe(true);
  });
});
