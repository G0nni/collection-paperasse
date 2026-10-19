// Lecture et écriture du hash (specs/jure-crache.md, « Format d'URL (fait foi) ») :
//
//   #1.<payload>        acte
//   #1.<payload>.p      acte jugé (p : le parieur gagne, c : le contre-parieur, n : match nul)
//
// <payload> = LZString.compressToEncodedURIComponent(JSON canonique de l'acte). Le hash est
// hostile (CLAUDE.md, Sécurité) : taille bornée avant tout décodage, puis après décompression,
// JSON lu sans jamais lever d'exception, schéma strict (deed.ts).
import LZString from "lz-string";
import { MAX_URL_PAYLOAD, isPayloadTooLong, parseEnum } from "@paperasse/shared/url";
import { canonicalJson, readDeed, type Deed, type DeedError } from "./deed";

export const VERDICTS = ["p", "c", "n"] as const;
/** `p` : le parieur gagne ; `c` : le contre-parieur ; `n` : match nul. */
export type Verdict = (typeof VERDICTS)[number];

/** Seule version du format. */
export const FORMAT_VERSION = "1";

/**
 * Taille maximale du JSON décompressé, en unités UTF-16 (`decoded.length`, spec « Format
 * d'URL »). En octets UTF-8, un acte d'emoji aux bornes (4 octets par emoji) aurait été refusé ;
 * en unités UTF-16, un point de code en vaut au plus 2 et un acte aux bornes tient toujours.
 */
export const MAX_DECODED_LENGTH = MAX_URL_PAYLOAD;

/** Alphabet de `compressToEncodedURIComponent` : rien d'autre n'est un payload. */
const PAYLOAD_ALPHABET = /^[A-Za-z0-9+$-]+$/u;

export type UnreadableReason =
  /** Hash brut, ou sa forme propre, de plus de 4 Ko (CLAUDE.md). */
  | "too-long"
  /** JSON décompressé de plus de 4 Ko. */
  | "decoded-too-long"
  /** Pas de la forme `#1.<payload>` : caractère hors alphabet, version illisible. */
  | "format"
  /** lz-string renvoie `null` ou `""`. */
  | "decompress"
  /** Le texte décompressé n'est pas du JSON. */
  | "json"
  /** JSON valide mais acte refusé par le schéma. */
  | DeedError;

export type Notice =
  /** CL-1 : suffixe de verdict inconnu (`#1.xxx.z`), ignoré. */
  "unknown-verdict";

export type LinkState =
  /** Pas de hash, `#`, `#1` ou `#1.` (CL-1) : écran Rédaction. */
  | { readonly screen: "draft" }
  /** CL-1 : `#2.xxx`. L'adresse n'est pas réécrite : elle vient peut-être d'une version plus récente. */
  | { readonly screen: "unknown-version" }
  | { readonly screen: "unreadable"; readonly reason: UnreadableReason }
  | {
      readonly screen: "deed";
      readonly deed: Deed;
      readonly verdict: Verdict | null;
      readonly notices: readonly Notice[];
      /** Forme propre du hash (« #1.… »), à remettre dans la barre d'adresse. */
      readonly hash: string;
    };

/** Hash brut, sans le « # » de tête, jamais décodé ici. */
function rawHash(hash: string): string {
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

function safeDecompress(payload: string): string | null {
  try {
    return LZString.decompressFromEncodedURIComponent(payload);
  } catch {
    return null;
  }
}

function safeJsonParse(text: string): { value: unknown } | null {
  try {
    const value: unknown = JSON.parse(text);
    return { value };
  } catch {
    return null;
  }
}

/** Compresse un JSON pour le hash (alphabet sûr dans une URL, rien à encoder). */
export function compressPayload(json: string): string {
  return LZString.compressToEncodedURIComponent(json);
}

/** Payload de l'acte : le JSON canonique compressé. */
export function encodeDeed(deed: Deed): string {
  return compressPayload(canonicalJson(deed));
}

/** Hash complet d'un acte, avec le « # » : « #1.<payload>[.p|.c|.n] ». */
export function buildHash(deed: Deed, verdict: Verdict | null): string {
  const suffix = verdict === null ? "" : `.${verdict}`;
  return `#${FORMAT_VERSION}.${encodeDeed(deed)}${suffix}`;
}

/**
 * Vrai si l'acte tient dans un lien qui sera relu : hash brut et JSON décompressé de 4 Ko au
 * plus. Le formulaire refuse de sceller un acte qui ne passerait pas (textes très exotiques).
 */
export function fitsInLink(deed: Deed): boolean {
  // Le suffixe de verdict le plus long (« .p ») compte déjà : juger l'acte ne le casse pas.
  const longest = buildHash(deed, "p");
  return !isPayloadTooLong(rawHash(longest)) && canonicalJson(deed).length <= MAX_DECODED_LENGTH;
}

/**
 * Lit le hash (`location.hash`). `nowMs` est l'heure de l'appareil, passée en paramètre pour
 * rester testable. Ne lève jamais d'exception.
 */
export function parseHash(hash: string, nowMs: number): LinkState {
  const raw = rawHash(hash);
  const unreadable = (reason: UnreadableReason): LinkState => ({ screen: "unreadable", reason });
  // Borné sur le hash brut, avant tout décodage (CLAUDE.md).
  if (isPayloadTooLong(raw)) return unreadable("too-long");
  if (raw === "") return { screen: "draft" };

  const [version = "", payload = "", ...rest] = raw.split(".");
  if (version !== FORMAT_VERSION) {
    return /^\d{1,9}$/u.test(version) ? { screen: "unknown-version" } : unreadable("format");
  }
  if (payload === "") return { screen: "draft" };
  if (!PAYLOAD_ALPHABET.test(payload)) return unreadable("format");

  const decoded = safeDecompress(payload);
  if (decoded === null || decoded === "") return unreadable("decompress");
  if (decoded.length > MAX_DECODED_LENGTH) return unreadable("decoded-too-long");
  const json = safeJsonParse(decoded);
  if (json === null) return unreadable("json");
  const result = readDeed(json.value, nowMs);
  if (!result.ok) return unreadable(result.error);

  // Tout ce qui suit le payload est le verdict : « .p », « .c », « .n ». Le reste est ignoré.
  const rawVerdict = rest.length === 0 ? null : rest.join(".");
  const verdict = parseEnum(rawVerdict, VERDICTS);
  const notices: Notice[] = rawVerdict !== null && verdict === null ? ["unknown-verdict"] : [];

  const clean = buildHash(result.deed, verdict);
  // La forme propre peut différer du lien lu (textes nettoyés, autre compression) : au-delà de
  // 4 Ko, elle serait refusée à l'ouverture suivante. On la refuse tout de suite.
  if (isPayloadTooLong(rawHash(clean))) return unreadable("too-long");
  return { screen: "deed", deed: result.deed, verdict, notices, hash: clean };
}
