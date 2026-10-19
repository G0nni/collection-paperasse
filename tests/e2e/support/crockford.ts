// Oracle de test du numéro d'acte de Juré Craché (specs/jure-crache.md, « Empreinte et numéro
// d'acte ») : base32 Crockford calculé autrement que l'app (BigInt et `toString(32)` plutôt
// qu'un tampon de bits), vérifié sur des vecteurs connus par les tests unitaires de seal.ts.
// Partagé par les tests unitaires et e2e, pour que le format n'existe qu'à un endroit côté tests.

const RADIX_32 = "0123456789abcdefghijklmnopqrstuv";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Base32 Crockford d'une suite d'octets donnée en hexadécimal, bits de poids fort d'abord,
 * complétée de bits à zéro à droite jusqu'à un multiple de 5 (comme RFC 4648, sans `=`).
 */
export function crockfordOfHex(hex: string): string {
  if (!/^(?:[0-9a-fA-F]{2})*$/u.test(hex)) throw new Error(`hexadécimal invalide : ${hex}`);
  if (hex === "") return "";
  const bits = hex.length * 4;
  const padding = (5 - (bits % 5)) % 5;
  const digits = (bits + padding) / 5;
  const value = BigInt(`0x${hex}`) << BigInt(padding);
  return Array.from(value.toString(32).padStart(digits, "0"), (digit) =>
    CROCKFORD.charAt(RADIX_32.indexOf(digit)),
  ).join("");
}

/**
 * Numéro attendu pour une empreinte SHA-256 (hexadécimal) et une date de rédaction :
 * « N° AAAA- » puis les 128 premiers bits en base32 Crockford (26 caractères), par 4.
 */
export function expectedDeedNumber(fingerprintHex: string, draftedAt: number): string {
  const code = crockfordOfHex(fingerprintHex.slice(0, 32));
  const groups = code.match(/.{1,4}/gu) ?? [];
  return `N°${String.fromCodePoint(0xa0)}${new Date(draftedAt).getUTCFullYear()}-${groups.join("-")}`;
}

/** Forme du numéro scellé ; `\s` couvre l'espace insécable comme l'espace normale après « N° ». */
export const DEED_NUMBER_SHAPE = /^N°\s\d{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){6}-[0-9A-HJKMNP-TV-Z]{2}$/u;
