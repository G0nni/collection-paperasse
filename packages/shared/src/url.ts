/** Taille maximale acceptée pour une query ou un hash, avant tout décodage. */
export const MAX_URL_PAYLOAD = 4096;

export function isPayloadTooLong(raw: string): boolean {
  return raw.length > MAX_URL_PAYLOAD;
}

/**
 * Entier strict en base 10 : uniquement des chiffres, sans signe, sans espace, sans exposant.
 * « 12 », oui ; « 1e3 », « 12.0 », « -4 », « 0x10 », « 12abc », non.
 */
export function parseStrictInt(
  raw: string | null | undefined,
  min: number,
  max: number,
): number | null {
  if (raw === null || raw === undefined || !/^\d{1,15}$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return null;
  }
  return value;
}

/** Valeur prise dans une liste blanche, sinon null. */
export function parseEnum<const T extends string>(
  raw: string | null | undefined,
  allowed: readonly T[],
): T | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  return allowed.find((candidate) => candidate === raw) ?? null;
}

/** Premier paramètre de ce nom (les doublons sont ignorés, comme dit la spec). */
export function firstParam(params: URLSearchParams, name: string): string | null {
  return params.get(name);
}
