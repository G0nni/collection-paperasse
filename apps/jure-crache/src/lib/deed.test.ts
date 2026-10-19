import { describe, expect, it } from "vitest";
import { DEED_KEYS, LIMITS, canonicalJson, latestDeadline, readDeed, sameName } from "./deed";

/** 14/10/2026 09:00 UTC : date de rédaction des actes de test. */
const T = Date.UTC(2026, 9, 14, 9, 0, 0);
/** 17/10/2026 18:00 UTC. */
const D = Date.UTC(2026, 9, 17, 18, 0, 0);
const NOW = T + 60_000;

/** Acte brut, tel qu'il sort de JSON.parse. */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    p: "Théo",
    c: "Sam",
    o: "Kevin arrivera en retard à la soirée de samedi.",
    e: "Un (1) kebab.",
    a: ["Art un.", "Art deux."],
    d: D,
    t: T,
  };
  const merged = { ...base, ...overrides };
  // Une valeur `undefined` retire la clé (clé manquante).
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

describe("readDeed · schéma strict", () => {
  it("lit un acte valide clé par clé", () => {
    const result = readDeed(raw(), NOW);
    expect(result).toEqual({
      ok: true,
      deed: {
        bettor: "Théo",
        opponent: "Sam",
        subject: "Kevin arrivera en retard à la soirée de samedi.",
        stake: "Un (1) kebab.",
        articles: ["Art un.", "Art deux."],
        deadline: D,
        draftedAt: T,
      },
    });
  });

  it("CL-2 · tableau, nombre, chaîne, null, booléen : refusés", () => {
    for (const value of [[], [raw()], 42, "acte", null, true, undefined]) {
      expect(readDeed(value, NOW)).toEqual({ ok: false, error: "not-object" });
    }
  });

  it("CL-2 · objet avec __proto__ (JSON.parse en fait une clé propre) : refusé", () => {
    const parsed: unknown = JSON.parse(
      `{"__proto__":{"polluted":true},"p":"Théo","c":"Sam","o":"x","e":"y","a":[],"d":${D},"t":${T}}`,
    );
    expect(readDeed(parsed, NOW)).toEqual({ ok: false, error: "unknown-key" });
    // Et rien n'a été pollué.
    expect(Object.prototype).not.toHaveProperty("polluted");
    const constructor: unknown = JSON.parse(
      `{"constructor":{"prototype":{"x":1}},"p":"Théo","c":"Sam","o":"x","e":"y","a":[],"d":${D},"t":${T}}`,
    );
    expect(readDeed(constructor, NOW)).toEqual({ ok: false, error: "unknown-key" });
  });

  it("CL-2 · objet sans prototype ou d'une autre classe : refusé", () => {
    const bare = Object.create(null);
    for (const key of DEED_KEYS) bare[key] = raw()[key];
    expect(readDeed(bare, NOW)).toEqual({ ok: false, error: "not-object" });
    expect(readDeed(new Date(), NOW)).toEqual({ ok: false, error: "not-object" });
  });

  it("clé inconnue → refusé ; clé manquante → refusé", () => {
    expect(readDeed(raw({ v: 1 }), NOW)).toEqual({ ok: false, error: "unknown-key" });
    for (const key of DEED_KEYS) {
      expect(readDeed(raw({ [key]: undefined }), NOW)).toEqual({
        ok: false,
        error: "missing-key",
      });
    }
  });

  it("textes : mauvais type, vide, invisibles, trop longs → refusés", () => {
    for (const [key, max] of [
      ["p", LIMITS.nameMax],
      ["c", LIMITS.nameMax],
      ["o", LIMITS.subjectMax],
      ["e", LIMITS.stakeMax],
    ] as const) {
      for (const value of [1, null, ["Théo"], {}, "", "   ", "\u200b\u3164", "x".repeat(max + 1)]) {
        expect(readDeed(raw({ [key]: value }), NOW).ok, key).toBe(false);
      }
      // Pile à la borne, en points de code (un emoji compte pour 1).
      const atMax = String.fromCodePoint(0x1f600).repeat(max);
      const other = key === "p" ? { c: "Sam" } : key === "c" ? { p: "Théo" } : {};
      expect(readDeed(raw({ [key]: atMax, ...other }), NOW).ok, key).toBe(true);
    }
  });

  it("textes : trim, contrôles et bidi retirés avant les bornes", () => {
    const rlo = String.fromCodePoint(0x202e);
    const result = readDeed(raw({ p: `  Th${rlo}éo\u0000 `, o: `${"x".repeat(200)}${rlo}` }), NOW);
    expect(result.ok && result.deed.bettor).toBe("Théo");
    expect(result.ok && result.deed.subject).toBe("x".repeat(200));
  });

  it("CL-3 · du HTML et des URL restent du texte, tels quels", () => {
    const html = `<script>alert(1)</script><img src=x onerror=alert(1)> https://evil.example`;
    const result = readDeed(raw({ o: html }), NOW);
    expect(result.ok && result.deed.subject).toBe(html);
  });

  it("CL-4 · noms identiques sans tenir compte de la casse : refusé", () => {
    for (const [p, c] of [
      ["Théo", "théo"],
      ["THÉO", "théo"],
      ["Théo", "Th\u200béo"],
      ["Théo", "Ｔｈéo"],
      ["straße", "STRASSE"],
    ]) {
      expect(readDeed(raw({ p, c }), NOW), `${p} / ${c}`).toEqual({
        ok: false,
        error: "same-names",
      });
    }
    // Des noms différents restent permis, accents compris.
    expect(readDeed(raw({ p: "Théo", c: "Theo" }), NOW).ok).toBe(true);
  });

  it("articles : 0 à 5, chacun de 1 à 160 caractères", () => {
    expect(readDeed(raw({ a: [] }), NOW).ok).toBe(true);
    expect(readDeed(raw({ a: Array(5).fill("x".repeat(160)) }), NOW).ok).toBe(true);
    for (const a of [
      Array(6).fill("x"),
      ["x".repeat(161)],
      [""],
      ["ok", 3],
      ["ok", null],
      "pas un tableau",
      { 0: "x", length: 1 },
    ]) {
      expect(readDeed(raw({ a }), NOW)).toEqual({ ok: false, error: "bad-articles" });
    }
  });

  it("t : entier, ≥ 2026-01-01, ≤ maintenant + 1 jour", () => {
    const ok = (t: unknown, d: unknown = D) => readDeed(raw({ t, d }), NOW).ok;
    expect(ok(LIMITS.earliestDraft, LIMITS.earliestDraft + 1)).toBe(true);
    expect(ok(LIMITS.earliestDraft - 1, LIMITS.earliestDraft + 1)).toBe(false);
    expect(ok(NOW + 86_400_000, NOW + 86_400_001)).toBe(true);
    expect(ok(NOW + 86_400_001, NOW + 86_400_002)).toBe(false);
    for (const t of [String(T), T + 0.5, Number.NaN, Infinity, null, -T]) {
      expect(readDeed(raw({ t }), NOW)).toEqual({ ok: false, error: "bad-draft-date" });
    }
    // Un entier écrit en notation exponentielle (« 1792054800e3 ») reste un entier : accepté.
    const exponent = JSON.stringify(raw()).replace(String(T), `${T / 1000}e3`);
    expect(exponent).toContain("e3");
    expect(readDeed(JSON.parse(exponent), NOW).ok).toBe(true);
  });

  it("d : entier, > t, ≤ t + 10 ans", () => {
    const ok = (d: unknown) => readDeed(raw({ d }), NOW).ok;
    expect(ok(T + 1)).toBe(true);
    expect(ok(T)).toBe(false);
    expect(ok(T - 1)).toBe(false);
    expect(ok(Date.UTC(2036, 9, 14, 9, 0, 0))).toBe(true);
    expect(ok(Date.UTC(2036, 9, 14, 9, 0, 0) + 1)).toBe(false);
    for (const d of [String(D), D + 0.1, null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(readDeed(raw({ d }), NOW)).toEqual({ ok: false, error: "bad-deadline" });
    }
  });
});

describe("latestDeadline", () => {
  it("même instant, 10 ans plus tard, en UTC", () => {
    expect(latestDeadline(T)).toBe(Date.UTC(2036, 9, 14, 9, 0, 0));
  });
});

describe("sameName", () => {
  it("compare sans la casse ni les invisibles", () => {
    expect(sameName("Théo", "théo")).toBe(true);
    expect(sameName("Théo", "Sam")).toBe(false);
  });
});

describe("canonicalJson", () => {
  it("clés dans l'ordre p, c, o, e, a, d, t, sans espace", () => {
    const result = readDeed(raw({}), NOW);
    if (!result.ok) throw new Error("acte de test invalide");
    // Même acte, clés données dans un autre ordre : même JSON canonique.
    const shuffled = readDeed(
      JSON.parse(
        `{"t":${T},"a":["Art un.","Art deux."],"d":${D},"e":"Un (1) kebab.","o":"Kevin arrivera en retard à la soirée de samedi.","c":"Sam","p":"Théo"}`,
      ),
      NOW,
    );
    if (!shuffled.ok) throw new Error("acte de test invalide");
    const json = canonicalJson(result.deed);
    expect(json).toBe(
      `{"p":"Théo","c":"Sam","o":"Kevin arrivera en retard à la soirée de samedi.","e":"Un (1) kebab.","a":["Art un.","Art deux."],"d":${D},"t":${T}}`,
    );
    expect(canonicalJson(shuffled.deed)).toBe(json);
    expect(Object.keys(JSON.parse(json))).toEqual([...DEED_KEYS]);
  });
});
