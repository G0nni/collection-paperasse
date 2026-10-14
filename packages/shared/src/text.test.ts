import { describe, expect, it } from "vitest";
import {
  MAX_COMBINING_MARKS,
  capCombiningMarks,
  codePointLength,
  hasVisibleChar,
  sanitizeText,
} from "./text";

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
  0xfffc, // caractère de remplacement d'objet, que Chromium n'affiche pas (security M1 bis)
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

const text = (...codes: number[]) => String.fromCodePoint(...codes);
const marks = (value: string) => [...value].filter((char) => /\p{M}/u.test(char)).length;
/** Plus longue suite de marques combinantes consécutives. */
const longestMarkRun = (value: string) =>
  Math.max(0, ...(value.match(/\p{M}+/gu) ?? []).map((run) => [...run].length));

/**
 * Textes réels qui empilent des marques combinantes et doivent passer intacts (spec
 * reunion-metre, « Modèle de menace »). Écrits en points de code : aucun caractère combinant
 * littéral dans le source.
 */
const LEGIT_TEXTS: readonly (readonly [string, string])[] = [
  ["vietnamien", text(0x54, 0x69, 0x1ebf, 0x6e, 0x67, 0x20, 0x56, 0x69, 0x1ec7, 0x74)],
  ["thaï", text(0x0e19, 0x0e49, 0x0e33, 0x0e17, 0x0e35, 0x0e48)],
  ["devanagari", text(0x0939, 0x093f, 0x0928, 0x094d, 0x0926, 0x0940, 0x20, 0x0938, 0x094d)],
  [
    "hébreu vocalisé et cantillé",
    text(0x05d1, 0x05bc, 0x05b0, 0x05e8, 0x05b5, 0x05d0, 0x05e9, 0x05c1, 0x05b4, 0x0596, 0x05d9),
  ],
  ["emoji keycap", text(0x31, 0xfe0f, 0x20e3)],
  ["famille avec ZWJ", text(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466)],
  ["salut avec teinte de peau", text(0x1f44b, 0x1f3fd)],
];

/** « a » suivi de 39 marques combinantes (U+0350 à U+036F, en boucle), 40 points de code. */
const ZALGO = text(0x61, ...Array.from({ length: 39 }, (_, index) => 0x0350 + (index % 32)));

describe("sanitizeText · marques combinantes (security M3)", () => {
  it.each(LEGIT_TEXTS)("laisse passer intact : %s", (_label, input) => {
    // Seul l'ordre canonique des marques peut changer (hébreu) : aucune n'est retirée.
    const nfc = input.normalize("NFC");
    expect(marks(nfc)).toBe(marks(input));
    expect(sanitizeText(input, { min: 1, max: 40 })).toEqual({ ok: true, value: nfc });
  });

  it("vietnamien décomposé (NFD) : recomposé en NFC, rien de retiré", () => {
    const decomposed = text(0x56, 0x69, 0x65, 0x0323, 0x0302, 0x74);
    expect(sanitizeText(decomposed, bounds)).toEqual({
      ok: true,
      value: text(0x56, 0x69, 0x1ec7, 0x74),
    });
  });

  it("zalgo : 39 marques sur une lettre réduites à 4", () => {
    expect(codePointLength(ZALGO)).toBe(40);
    const result = sanitizeText(ZALGO, { min: 1, max: 40 });
    expect(result.ok).toBe(true);
    const value = result.ok ? result.value : "";
    expect(value.startsWith("a")).toBe(true);
    expect(codePointLength(value)).toBe(1 + MAX_COMBINING_MARKS);
    expect(marks(value)).toBe(MAX_COMBINING_MARKS);
    for (const char of value.slice(1)) expect(ZALGO).toContain(char);
  });

  it("4 marques consécutives : gardées ; 5 : réduites à 4 ; chaque suite est plafonnée à part", () => {
    const four = text(0x78, 0x0351, 0x0352, 0x0353, 0x0354);
    expect(capCombiningMarks(four)).toBe(four);
    expect(capCombiningMarks(text(0x78, 0x0351, 0x0352, 0x0353, 0x0354, 0x0355))).toBe(four);
    const twoRuns = `${ZALGO} ${ZALGO}`;
    const capped = capCombiningMarks(twoRuns);
    expect(capped.split(" ").map(longestMarkRun)).toEqual([4, 4]);
  });

  it("compte aussi les marques espacées (Mc) et englobantes (Me)", () => {
    const spacing = text(0x0915, 0x093e, 0x093e, 0x093e, 0x093e, 0x093e, 0x093e);
    expect(longestMarkRun(capCombiningMarks(spacing))).toBe(4);
    const enclosing = text(0x31, 0x20e3, 0x20e3, 0x20e3, 0x20e3, 0x20e3, 0x20e3);
    expect(longestMarkRun(capCombiningMarks(enclosing))).toBe(4);
  });

  it("une marque seule ne rend pas visible un texte invisible", () => {
    expect(sanitizeText(text(0xfffc, 0x0301), bounds)).toEqual({ ok: false, reason: "too-short" });
  });

  it("la borne de longueur porte sur le texte réduit : 40 lettres zalgo de 4 marques passent", () => {
    // 5 points de code par lettre : 8 lettres font 40 points de code, 9 en font 45.
    const letter = text(0x7a, 0x0351, 0x0352, 0x0353, 0x0354, 0x0355, 0x0356);
    expect(sanitizeText(letter.repeat(8), { min: 1, max: 40 }).ok).toBe(true);
    expect(sanitizeText(letter.repeat(9), { min: 1, max: 40 })).toEqual({
      ok: false,
      reason: "too-long",
    });
  });
});

describe("sanitizeText · ordre retrait, NFC, trim (forme propre stable)", () => {
  it("un caractère interdit entre une lettre et son accent : retiré, puis la paire est composée", () => {
    const input = text(0x65, 0x202e, 0x0301);
    expect(sanitizeText(input, bounds)).toEqual({ ok: true, value: text(0xe9) });
  });

  it("des espaces cachés derrière des contrôles sont rognés", () => {
    expect(sanitizeText(text(0x20, 0x00, 0x4b, 0x20, 0x202e), bounds)).toEqual({
      ok: true,
      value: "K",
    });
  });

  const unstableBefore: readonly (readonly [string, string])[] = [
    ["accent séparé par un bidi", text(0x65, 0x202e, 0x0301, 0x61, 0x200f, 0x0300)],
    ["zalgo", ZALGO],
    [
      "zalgo derrière des contrôles",
      text(0x20, 0x61, 0x00, ...Array.from({ length: 12 }, (_, i) => 0x0300 + i), 0x20),
    ],
    ["hébreu non ordonné", text(0x05e9, 0x05c1, 0x05b8, 0x05e9, 0x0596, 0x05c1, 0x05b4)],
    ...LEGIT_TEXTS,
  ];

  it.each(unstableBefore)("nettoyer deux fois ne change rien : %s", (_label, input) => {
    const once = sanitizeText(input, { min: 1, max: 40 });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(sanitizeText(once.value, { min: 1, max: 40 })).toEqual(once);
    expect(once.value).toBe(once.value.normalize("NFC"));
  });
});
