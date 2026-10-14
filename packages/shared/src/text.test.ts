import { describe, expect, it } from "vitest";
import { codePointLength, hasVisibleChar, sanitizeText } from "./text";

const bounds = { min: 1, max: 10 };
const char = (code: number) => String.fromCodePoint(code);
const hex = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

/** Tous les contrôles bidirectionnels Unicode (propriété Bidi_Control). */
const BIDI_CONTROLS = [
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
];

/**
 * Caractères qui ne dessinent rien : ignorables par défaut, remplissages hangul, braille
 * vierge, espaces de format. Un texte qui n'en contient que ça doit être refusé comme vide
 * (security M1, spec « Modèle de menace »).
 */
const INVISIBLES = [
  0x00ad, // trait d'union conditionnel
  0x034f, // graphème combinant
  0x115f, // remplissage initial hangul
  0x1160, // remplissage médian hangul
  0x17b4, // voyelle inhérente khmère AQ
  0x17b5, // voyelle inhérente khmère AA
  0x180e, // séparateur de voyelle mongol
  0x200b, // espace sans chasse
  0x200c, // anti-liant sans chasse
  0x200d, // liant sans chasse (gardé dans les emoji composés)
  0x2060, // gluon de mots
  0x2061, // application de fonction
  0x2062, // multiplication invisible
  0x2063, // séparateur invisible
  0x2064, // plus invisible
  0x2800, // braille vierge
  0x3164, // remplissage hangul
  0xfe0f, // sélecteur de variation 16
  0xfeff, // indicateur d'ordre des octets
  0xffa0, // remplissage hangul demi-chasse
  0x1d159, // tête de note nulle
  0x1d173, // début de ligature musicale
  0xe0020, // étiquette espace
];

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
    const nul = char(0x0000);
    const rlo = char(0x202e);
    const lri = char(0x2066);
    const rlm = char(0x200f);
    expect(sanitizeText(`a${nul}b${rlo}c${lri}d${rlm}`, bounds)).toEqual({
      ok: true,
      value: "abcd",
    });
  });

  it.each(BIDI_CONTROLS.map((code) => [hex(code), code]))(
    "retire le contrôle bidirectionnel %s (security M2)",
    (_label, code) => {
      expect(sanitizeText(`Ti${char(code)}tre`, bounds)).toEqual({ ok: true, value: "Titre" });
    },
  );

  it("retire U+061C (marque de lettre arabe), qui retournait un titre (security M2)", () => {
    const alm = char(0x061c);
    expect(sanitizeText(`${alm}exe.txt${alm}`, bounds)).toEqual({ ok: true, value: "exe.txt" });
  });

  it("retire tous les contrôles C0 et C1", () => {
    for (let code = 0; code <= 0x9f; code += 1) {
      if (code > 0x1f && code < 0x7f) continue;
      expect(sanitizeText(`a${char(code)}b`, bounds), hex(code)).toEqual({ ok: true, value: "ab" });
    }
  });

  it("refuse un texte vide une fois nettoyé", () => {
    expect(sanitizeText(` ${char(0)} ${char(0x202e)} `, bounds)).toEqual({
      ok: false,
      reason: "too-short",
    });
  });

  it.each(INVISIBLES.map((code) => [hex(code), code]))(
    "refuse comme vide un texte fait seulement de %s (security M1)",
    (_label, code) => {
      for (const input of [char(code), char(code).repeat(5), ` ${char(code)} ${char(code)} `]) {
        expect(hasVisibleChar(input)).toBe(false);
        expect(sanitizeText(input, bounds)).toEqual({ ok: false, reason: "too-short" });
      }
    },
  );

  it("refuse un mélange d'invisibles, d'espaces et de bidi", () => {
    const mix = INVISIBLES.map(char).join(" ") + BIDI_CONTROLS.map(char).join("");
    expect(sanitizeText(mix, { min: 1, max: 200 })).toEqual({ ok: false, reason: "too-short" });
  });

  it("refuse une marque combinante seule, sans lettre à décorer", () => {
    expect(sanitizeText(char(0x0301).repeat(3), bounds)).toEqual({
      ok: false,
      reason: "too-short",
    });
  });

  it("borne minimale 0 : un texte invisible devient un texte vide, accepté", () => {
    expect(sanitizeText(char(0x200b).repeat(3), { min: 0, max: 10 })).toEqual({
      ok: true,
      value: "",
    });
  });

  it("accepte un invisible mêlé à du visible, sans y toucher", () => {
    const zwsp = char(0x200b);
    expect(sanitizeText(`Kev${zwsp}in`, bounds)).toEqual({ ok: true, value: `Kev${zwsp}in` });
  });

  it("garde U+200D dans un emoji composé, qui compte comme visible", () => {
    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(hasVisibleChar(family)).toBe(true);
    expect(sanitizeText(family, bounds)).toEqual({ ok: true, value: family });
    const heart = `${char(0x2764)}${char(0xfe0f)}`;
    expect(sanitizeText(heart, bounds)).toEqual({ ok: true, value: heart });
  });

  it("accepte les écritures non latines et la ponctuation seule", () => {
    for (const input of ["مدير", "דנה", "東京", "Ωμέγα", "?", "€", "42"]) {
      expect(sanitizeText(input, bounds), input).toEqual({ ok: true, value: input });
    }
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
