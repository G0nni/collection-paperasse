import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NBSP } from "@paperasse/shared/typography";
import { canonicalJson, type Deed } from "./deed";
import { crockfordOfHex, expectedDeedNumber } from "../../../../tests/e2e/support/crockford";
import {
  CROCKFORD_ALPHABET,
  UNSEALED_NUMBER,
  WAX_PALETTE,
  browserDigest,
  crockfordBase32,
  deedNumber,
  fingerprint,
  numberSegments,
  waxIndex,
  type Digest,
} from "./seal";

const DEED: Deed = {
  bettor: "Théo",
  opponent: "Sam",
  subject: "Kevin arrivera en retard à la soirée de samedi.",
  stake: "Un (1) kebab.",
  articles: ["Art. un."],
  deadline: Date.UTC(2026, 9, 17, 18),
  draftedAt: Date.UTC(2026, 9, 14, 9),
};

/** Le vrai SHA-256 du navigateur, tel que Node l'expose aussi. */
const digest = browserDigest(globalThis.crypto);
/** Oracle indépendant : node:crypto. */
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("fingerprint", () => {
  it("SHA-256 du JSON canonique, en hexadécimal minuscule", async () => {
    expect(digest).not.toBeNull();
    expect(await fingerprint(DEED, digest)).toBe(sha256(canonicalJson(DEED)));
  });

  it("CL-6 · sans crypto.subtle, ou si le calcul échoue : null", async () => {
    expect(browserDigest(undefined)).toBeNull();
    expect(browserDigest({ subtle: undefined })).toBeNull();
    expect(await fingerprint(DEED, null)).toBeNull();
    const refused: Digest = () => Promise.reject(new Error("refusé"));
    expect(await fingerprint(DEED, refused)).toBeNull();
    const short: Digest = async () => new ArrayBuffer(4);
    expect(await fingerprint(DEED, short)).toBeNull();
  });
});

/** Octets d'une chaîne hexadécimale, pour comparer l'app à l'oracle. */
const bytesOf = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
/** Octets d'un texte ASCII, en hexadécimal (vecteurs RFC 4648). */
const asciiHex = (text: string) => Buffer.from(text, "latin1").toString("hex");

describe("base32 Crockford", () => {
  // Vecteurs de RFC 4648 (section 10, base32), transposés dans l'alphabet de Crockford position
  // par position : « foobar » → MZXW6YTBOI devient CSQPYRK1E8, valeur publiée par les
  // implémentations de référence de Crockford.
  const RFC_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const toCrockford = (rfc: string) =>
    Array.from(rfc, (digit) => CROCKFORD_ALPHABET.charAt(RFC_ALPHABET.indexOf(digit))).join("");
  const RFC_VECTORS = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ] as const;

  it("alphabet : 32 caractères, sans I, L, O, U", () => {
    expect(CROCKFORD_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    expect(new Set(CROCKFORD_ALPHABET).size).toBe(32);
    expect(CROCKFORD_ALPHABET).not.toMatch(/[ILOU]/u);
  });

  it.each(RFC_VECTORS)("vecteur RFC 4648 « %s » : oracle et app d'accord", (text, rfc) => {
    const expected = toCrockford(rfc);
    expect(crockfordOfHex(asciiHex(text))).toBe(expected);
    expect(crockfordBase32(bytesOf(asciiHex(text)))).toBe(expected);
  });

  it("vecteurs connus : « foobar » → CSQPYRK1E8 ; 128 bits à 0 ou à 1", () => {
    expect(crockfordOfHex(asciiHex("foobar"))).toBe("CSQPYRK1E8");
    expect(crockfordOfHex("00".repeat(16))).toBe("0".repeat(26));
    expect(crockfordBase32(new Uint8Array(16))).toBe("0".repeat(26));
    // 128 = 25 × 5 + 3 : 25 « Z », puis 111 complété de 00, soit 28 = W.
    expect(crockfordOfHex("ff".repeat(16))).toBe(`${"Z".repeat(25)}W`);
    expect(crockfordBase32(new Uint8Array(16).fill(255))).toBe(`${"Z".repeat(25)}W`);
  });

  it("chaque bit de 128 compte : 128 empreintes à un seul bit, 128 codes distincts et conformes", () => {
    const codes = new Set<string>();
    for (let bit = 0; bit < 128; bit += 1) {
      const bytes = new Uint8Array(16);
      bytes[bit >> 3] = 0x80 >> (bit & 7);
      const code = crockfordBase32(bytes);
      expect(code).toBe(crockfordOfHex(Buffer.from(bytes).toString("hex")));
      codes.add(code);
    }
    expect(codes.size).toBe(128);
  });

  it("concorde avec l'oracle sur des empreintes SHA-256 réelles (node:crypto)", () => {
    for (let index = 0; index < 200; index += 1) {
      const head = sha256(`acte ${index}`).slice(0, 32);
      expect(crockfordBase32(bytesOf(head))).toBe(crockfordOfHex(head));
    }
  });
});

describe("deedNumber", () => {
  it("N° AAAA- puis 26 caractères base32 par groupes de 4, le dernier de 2", () => {
    const fingerprintHex = "ff".repeat(16) + "0".repeat(32);
    expect(deedNumber(fingerprintHex, DEED.draftedAt)).toBe(
      `N°${NBSP}2026-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZW`,
    );
    expect(deedNumber("0".repeat(64), DEED.draftedAt)).toBe(
      `N°${NBSP}2026-0000-0000-0000-0000-0000-0000-00`,
    );
  });

  it("128 bits : un bit changé au 128e change le numéro, un bit au-delà ne le change pas", () => {
    const zero = "0".repeat(64);
    const bit128 = `${"0".repeat(31)}1${"0".repeat(32)}`;
    const bit129 = `${"0".repeat(32)}8${"0".repeat(31)}`;
    expect(deedNumber(bit128, DEED.draftedAt)).not.toBe(deedNumber(zero, DEED.draftedAt));
    expect(deedNumber(bit129, DEED.draftedAt)).toBe(deedNumber(zero, DEED.draftedAt));
    // Les bits 65 à 128, absents du numéro à 64 bits, y sont désormais.
    const bit65 = `${"0".repeat(16)}8${"0".repeat(47)}`;
    expect(deedNumber(bit65, DEED.draftedAt)).not.toBe(deedNumber(zero, DEED.draftedAt));
  });

  it("l'année est celle de t en UTC, pas dans le fuseau de l'appareil", () => {
    // 31/12/2026 23:30 UTC : déjà 2027 à Paris, encore 2026 en UTC.
    const fingerprintHex = "f".repeat(64);
    expect(deedNumber(fingerprintHex, Date.UTC(2026, 11, 31, 23, 30))).toBe(
      `N°${NBSP}2026-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZW`,
    );
  });

  it("CA-3 · le numéro suit l'oracle node:crypto + base32 sur un acte réel", async () => {
    const hex = sha256(canonicalJson(DEED));
    const shown = deedNumber(await fingerprint(DEED, digest), DEED.draftedAt);
    expect(shown).toBe(expectedDeedNumber(hex, DEED.draftedAt));
    expect(shown).toMatch(
      new RegExp(
        `^N°${NBSP}2026(?:-[${CROCKFORD_ALPHABET}]{4}){6}-[${CROCKFORD_ALPHABET}]{2}$`,
        "u",
      ),
    );
  });

  it("CL-6 · sans empreinte : « N° NON-SCELLÉ »", () => {
    expect(deedNumber(null, DEED.draftedAt)).toBe(UNSEALED_NUMBER);
    expect(UNSEALED_NUMBER).toBe(`N°${NBSP}NON-SCELLÉ`);
  });

  it("CA-3 · un seul caractère modifié change le numéro", async () => {
    const original = deedNumber(await fingerprint(DEED, digest), DEED.draftedAt);
    const variants: Deed[] = [
      { ...DEED, bettor: "Théa" },
      { ...DEED, opponent: "Sal" },
      { ...DEED, subject: DEED.subject.replace("samedi", "Samedi") },
      { ...DEED, stake: "Un (2) kebab." },
      { ...DEED, articles: ["Art. un!"] },
      { ...DEED, articles: [] },
      { ...DEED, deadline: DEED.deadline + 1 },
      { ...DEED, draftedAt: DEED.draftedAt + 1 },
    ];
    const numbers = new Set([original]);
    for (const variant of variants) {
      numbers.add(deedNumber(await fingerprint(variant, digest), variant.draftedAt));
    }
    expect(numbers.size).toBe(variants.length + 1);
  });
});

describe("numberSegments", () => {
  it("coupe après chaque tiret, sans rien perdre ni ajouter", () => {
    const number = `N°${NBSP}2026-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZW`;
    const segments = numberSegments(number);
    expect(segments).toEqual([
      `N°${NBSP}2026-`,
      "ZZZZ-",
      "ZZZZ-",
      "ZZZZ-",
      "ZZZZ-",
      "ZZZZ-",
      "ZZZZ-",
      "ZW",
    ]);
    expect(segments.join("")).toBe(number);
    expect(numberSegments(UNSEALED_NUMBER).join("")).toBe(UNSEALED_NUMBER);
  });
});

describe("waxIndex", () => {
  it("palette fixe de 4 teintes, choisie par l'empreinte ; défaut sans empreinte", () => {
    expect(WAX_PALETTE).toEqual(["#9E2A24", "#1E4636", "#2B3A67", "#7A4B12"]);
    expect(waxIndex(null)).toBe(0);
    expect(waxIndex(`${"0".repeat(62)}00`)).toBe(0);
    expect(waxIndex(`${"0".repeat(62)}01`)).toBe(1);
    expect(waxIndex(`${"0".repeat(62)}fe`)).toBe(2);
    expect(waxIndex(`${"0".repeat(62)}ff`)).toBe(3);
  });

  it("les 4 teintes sortent sur des actes réels", async () => {
    const seen = new Set<number>();
    for (let index = 0; index < 40; index += 1) {
      seen.add(waxIndex(await fingerprint({ ...DEED, bettor: `Théo ${index}` }, digest)));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});
