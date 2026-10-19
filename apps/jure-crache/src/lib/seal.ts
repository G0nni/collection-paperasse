// Empreinte, numéro d'acte et couleur de la cire (specs/jure-crache.md, « Empreinte et numéro
// d'acte »). Le verdict n'entre jamais dans l'empreinte : il est déclaratif.
import { NBSP } from "@paperasse/shared/typography";
import { canonicalJson, type Deed } from "./deed";

/** SHA-256 d'octets : `crypto.subtle.digest` dans le navigateur, injecté pour les tests. */
export type Digest = (data: Uint8Array<ArrayBuffer>) => Promise<ArrayBuffer>;

/** Palette fixe de la cire (Design) ; la première est la cire par défaut. */
export const WAX_PALETTE = ["#9E2A24", "#1E4636", "#2B3A67", "#7A4B12"] as const;
export type WaxIndex = 0 | 1 | 2 | 3;

/** Numéro affiché quand l'empreinte ne peut pas être calculée (CL-6). */
export const UNSEALED_NUMBER = `N°${NBSP}NON-SCELLÉ`;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * `crypto.subtle.digest` lié à son objet, ou `null` s'il n'existe pas : hors contexte sécurisé
 * (http:// autre que localhost), `crypto.subtle` vaut `undefined` malgré le typage (CL-6).
 */
export function browserDigest(
  cryptoObject: { readonly subtle?: SubtleCrypto | undefined } | undefined,
): Digest | null {
  const subtle = cryptoObject?.subtle;
  if (typeof subtle?.digest !== "function") return null;
  return (data) => subtle.digest("SHA-256", data);
}

/**
 * Empreinte hexadécimale (64 caractères, minuscules) du JSON canonique, ou `null` si le calcul
 * est impossible (pas de `crypto.subtle`, ou refus). Ne lève jamais d'exception.
 */
export async function fingerprint(deed: Deed, digest: Digest | null): Promise<string | null> {
  if (digest === null) return null;
  try {
    const hex = toHex(await digest(new TextEncoder().encode(canonicalJson(deed))));
    return /^[0-9a-f]{64}$/u.test(hex) ? hex : null;
  } catch {
    return null;
  }
}

/**
 * « N° AAAA-XXXX-XXXX-XXXX-XXXX » : année UTC de la rédaction (le même numéro sur tous les
 * appareils, quel que soit leur fuseau) et 16 premiers caractères de l'empreinte (64 bits), en
 * majuscules. À 32 bits, forger un autre acte au même numéro prenait quelques minutes de calcul
 * (rapport security, tour 1). Insécable après « N° » : le numéro ne part pas seul à la ligne.
 */
export function deedNumber(fingerprintHex: string | null, draftedAt: number): string {
  if (fingerprintHex === null) return UNSEALED_NUMBER;
  const year = String(new Date(draftedAt).getUTCFullYear());
  const head = fingerprintHex.slice(0, 16).toUpperCase();
  const groups = [0, 4, 8, 12].map((start) => head.slice(start, start + 4));
  return `N°${NBSP}${year}-${groups.join("-")}`;
}

/**
 * Teinte de la cire, tirée du dernier octet de l'empreinte (indépendant des chiffres affichés).
 * Sans empreinte : la cire par défaut.
 */
export function waxIndex(fingerprintHex: string | null): WaxIndex {
  if (fingerprintHex === null) return 0;
  const byte = Number.parseInt(fingerprintHex.slice(-2), 16);
  const index = Number.isInteger(byte) ? byte % WAX_PALETTE.length : 0;
  return index === 1 ? 1 : index === 2 ? 2 : index === 3 ? 3 : 0;
}
