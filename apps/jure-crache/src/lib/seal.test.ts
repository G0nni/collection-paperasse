import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { NBSP } from "@paperasse/shared/typography";
import { canonicalJson, type Deed } from "./deed";
import {
  UNSEALED_NUMBER,
  WAX_PALETTE,
  browserDigest,
  deedNumber,
  fingerprint,
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

describe("deedNumber", () => {
  it("N° AAAA-XXXX-XXXX-XXXX-XXXX : année UTC de t, 16 premiers caractères (64 bits) en majuscules", () => {
    const fingerprintHex = "1a2b3c4d5e6f7a8b" + "9".repeat(48);
    expect(deedNumber(fingerprintHex, DEED.draftedAt)).toBe(`N°${NBSP}2026-1A2B-3C4D-5E6F-7A8B`);
  });

  it("deux empreintes qui ne diffèrent qu'au 9e caractère ont deux numéros (64 bits, pas 32)", () => {
    const first = `${"0".repeat(8)}1${"0".repeat(55)}`;
    const second = `${"0".repeat(8)}2${"0".repeat(55)}`;
    expect(deedNumber(first, DEED.draftedAt)).not.toBe(deedNumber(second, DEED.draftedAt));
  });

  it("l'année est celle de t en UTC, pas dans le fuseau de l'appareil", () => {
    // 31/12/2026 23:30 UTC : déjà 2027 à Paris, encore 2026 en UTC.
    const fingerprintHex = "f".repeat(64);
    expect(deedNumber(fingerprintHex, Date.UTC(2026, 11, 31, 23, 30))).toBe(
      `N°${NBSP}2026-FFFF-FFFF-FFFF-FFFF`,
    );
  });

  it("le numéro suit l'oracle node:crypto sur un acte réel", async () => {
    const hex = sha256(canonicalJson(DEED)).toUpperCase();
    expect(deedNumber(await fingerprint(DEED, digest), DEED.draftedAt)).toBe(
      `N°${NBSP}2026-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`,
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
