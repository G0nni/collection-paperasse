import { describe, expect, it } from "vitest";
import { SIGNATURE_BOX, hashName, seededRandom, signaturePath } from "./signature";

/** Tous les nombres d'un tracé, par paires (x, y). */
function points(path: string): [number, number][] {
  const numbers = (path.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number);
  const pairs: [number, number][] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    pairs.push([numbers[index] ?? 0, numbers[index + 1] ?? 0]);
  }
  return pairs;
}

describe("signaturePath", () => {
  it("même nom → même gribouillis (déterministe)", () => {
    expect(signaturePath("Théo")).toBe(signaturePath("Théo"));
    // Valeur figée : un changement involontaire de l'algorithme changerait toutes les signatures.
    expect(signaturePath("Théo")).toBe(
      "M13.3 35.4 C7.5 11.1 30.6 5.1 21.6 30.3 C23.6 21.0 35.6 21.0 36.7 32.1 " +
        "C37.5 22.2 47.3 22.2 48.1 30.9 C49.1 20.8 60.4 20.8 61.4 30.4 " +
        "C62.4 18.1 74.3 18.1 75.3 29.6 C76.1 22.3 85.1 22.3 85.9 32.0 " +
        "M12.3 43.4 Q99.1 45.0 166.5 37.8",
    );
  });

  it("noms différents → gribouillis différents", () => {
    const names = [
      "Théo",
      "théo",
      "Sam",
      "Kevin",
      "Théo ",
      "Ana",
      "Bob",
      String.fromCodePoint(0x1f600),
    ];
    expect(new Set(names.map(signaturePath)).size).toBe(names.length);
  });

  it("seulement des commandes et des nombres, jamais le nom", () => {
    for (const name of [
      "<script>",
      '"/><img onerror=alert(1)>',
      ["java", "script:alert(1)"].join(""),
      "x".repeat(40),
    ]) {
      const path = signaturePath(name);
      expect(path).toMatch(/^M[\d. ]+( [MCQ][\d. ]+)+$/u);
      expect(path).not.toContain(name);
    }
  });

  it("le tracé reste dans le cadre 180 × 48", () => {
    for (const name of ["Théo", "Sam", "W".repeat(40), "a", String.fromCodePoint(0x10ffff)]) {
      for (const [x, y] of points(signaturePath(name))) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(SIGNATURE_BOX.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(SIGNATURE_BOX.height);
      }
    }
  });

  it("une majuscule, 5 à 8 lettres attachées et un paraphe", () => {
    for (const name of ["Théo", "Sam", "Kevin", "Ana", "Bob", "Zoé"]) {
      const curves = signaturePath(name).match(/C/gu)?.length ?? 0;
      expect(curves).toBeGreaterThanOrEqual(6);
      expect(curves).toBeLessThanOrEqual(9);
      expect(signaturePath(name).match(/Q/gu)).toHaveLength(1);
    }
  });
});

describe("hashName / seededRandom", () => {
  it("FNV-1a 32 bits sur les points de code", () => {
    expect(hashName("")).toBe(0x811c9dc5);
    expect(hashName("a")).toBe(0xe40c292c);
  });

  it("générateur reproductible, dans [0, 1)", () => {
    const first = seededRandom(42);
    const second = seededRandom(42);
    for (let index = 0; index < 100; index += 1) {
      const value = first();
      expect(value).toBe(second());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
