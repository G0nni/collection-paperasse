import { describe, expect, it } from "vitest";
import { codePointLength, sanitizeText } from "./text";

const bounds = { min: 1, max: 10 };

describe("sanitizeText", () => {
  it("garde un texte normal, sans les espaces autour", () => {
    expect(sanitizeText("  Théo  ", bounds)).toEqual({ ok: true, value: "Théo" });
  });

  it("refuse ce qui n'est pas une chaîne", () => {
    for (const input of [null, undefined, 42, {}, [], true]) {
      expect(sanitizeText(input, bounds)).toEqual({ ok: false, reason: "type" });
    }
  });

  it("retire les caractères de contrôle et bidirectionnels", () => {
    const nul = String.fromCodePoint(0x0000);
    const rlo = String.fromCodePoint(0x202e);
    const lri = String.fromCodePoint(0x2066);
    const rlm = String.fromCodePoint(0x200f);
    expect(sanitizeText(`a${nul}b${rlo}c${lri}d${rlm}`, bounds)).toEqual({
      ok: true,
      value: "abcd",
    });
  });

  it("refuse un texte vide une fois nettoyé", () => {
    expect(
      sanitizeText(` ${String.fromCodePoint(0)} ${String.fromCodePoint(0x202e)} `, bounds),
    ).toEqual({ ok: false, reason: "too-short" });
  });

  it("compte les emoji comme un seul caractère", () => {
    expect(codePointLength("🥙🥙")).toBe(2);
    expect(sanitizeText("🥙".repeat(10), bounds).ok).toBe(true);
    expect(sanitizeText("🥙".repeat(11), bounds)).toEqual({ ok: false, reason: "too-long" });
  });

  it("refuse très vite une chaîne énorme", () => {
    expect(sanitizeText("x".repeat(1_000_000), bounds)).toEqual({ ok: false, reason: "too-long" });
  });

  it("laisse le HTML tel quel : c'est l'affichage en textContent qui protège", () => {
    expect(sanitizeText("<b>x</b>", { min: 1, max: 20 })).toEqual({ ok: true, value: "<b>x</b>" });
  });
});
