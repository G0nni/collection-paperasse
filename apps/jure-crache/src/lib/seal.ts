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

/** Alphabet base32 de Crockford : chiffres et lettres sans I, L, O, U (pas de confusion). */
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Base32 Crockford d'octets, bits de poids fort d'abord ; le dernier caractère est complété par
 * des bits à zéro (16 octets → 26 caractères).
 */
export function crockfordBase32(bytes: Uint8Array): string {
  let text = "";
  let buffer = 0;
  let bufferedBits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bufferedBits += 8;
    while (bufferedBits >= 5) {
      bufferedBits -= 5;
      text += CROCKFORD_ALPHABET.charAt((buffer >> bufferedBits) & 31);
    }
    // Seuls les bits pas encore écrits restent : le tampon ne dépasse jamais 12 bits.
    buffer &= (1 << bufferedBits) - 1;
  }
  if (bufferedBits > 0) text += CROCKFORD_ALPHABET.charAt((buffer << (5 - bufferedBits)) & 31);
  return text;
}

/** Octets d'une chaîne hexadécimale valide (longueur paire). */
function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

/**
 * « N° AAAA-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX » : année UTC de la rédaction (le même numéro sur
 * tous les appareils, quel que soit leur fuseau) et 128 premiers bits de l'empreinte en base32
 * Crockford (26 caractères), groupés par 4. À 64 bits, l'auteur pouvait préparer deux versions
 * au même numéro en ~2^32 calculs (rapport security, tour 2). Insécable après « N° » : le
 * numéro ne part pas seul à la ligne.
 */
export function deedNumber(fingerprintHex: string | null, draftedAt: number): string {
  if (fingerprintHex === null) return UNSEALED_NUMBER;
  const year = String(new Date(draftedAt).getUTCFullYear());
  const code = crockfordBase32(hexBytes(fingerprintHex.slice(0, 32)));
  const groups = code.match(/.{1,4}/gu) ?? [];
  return `N°${NBSP}${year}-${groups.join("-")}`;
}

/**
 * Morceaux du numéro, chacun finissant par son tiret : l'écran ne peut passer à la ligne
 * qu'entre deux morceaux, jamais au milieu d'un groupe (à 360 px, le numéro ne tient pas sur
 * une ligne).
 */
export function numberSegments(number: string): string[] {
  return number.split(/(?<=-)/u);
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
