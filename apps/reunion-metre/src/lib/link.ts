// Lecture et écriture du lien (specs/reunion-metre.md, « Format d'URL (fait foi) »).
// Le lien est hostile tant qu'il n'est pas validé (CLAUDE.md, Sécurité) : chaque paramètre passe
// par un validateur explicite, rien ne lève d'exception, et toute valeur refusée laisse une trace
// visible (`Notice`).
import { sanitizeText } from "@paperasse/shared/text";
import { firstParam, isPayloadTooLong, parseEnum, parseStrictInt } from "@paperasse/shared/url";
import {
  LIMITS,
  LINK_DEFAULT_TARIFF,
  TARIFF_CODES,
  defaultMeeting,
  screenOf,
  type Meeting,
  type Participant,
  type Screen,
} from "./meeting";

export type NoticeCode =
  /** `v` absent ou différent de 1 alors que le lien porte des paramètres. */
  | "unknown-version"
  /** Query de plus de 4 Ko (CL-8). */
  | "too-long"
  /** `s` plus de 60 s dans le futur (CL-1). */
  | "future-start"
  /** `s` illisible ou antérieur à 2020. */
  | "bad-start"
  /** `e` illisible ou hors de ]s, s + 24 h] (CL-3). */
  | "bad-end"
  /** `e` plus de 60 s dans le futur (CL-3) : un ticket ne se termine pas à l'avance. */
  | "future-end"
  /** `t` hors liste blanche : tarif A. */
  | "bad-tariff"
  /** `n` trop long après nettoyage. */
  | "bad-title"
  /** 31 paramètres `p` ou plus (CL-4). */
  | "too-many-participants"
  /** Des `p` refusés (CL-5) ; `count` dit combien. */
  | "ignored-participants"
  /** Aucun `p` valide : retour à la Configuration. */
  | "no-participants";

export type Notice = { readonly code: NoticeCode; readonly count: number };

export type ParsedLink = {
  readonly meeting: Meeting;
  readonly screen: Screen;
  readonly notices: readonly Notice[];
  /**
   * Forme propre du lien, à remettre dans la barre d'adresse (spec, « Écrans ») : paramètres
   * inconnus, doublons et participants invalides retirés. Chaîne vide quand le lien est ignoré
   * en entier (aucun paramètre du format, version inconnue, trop long).
   */
  readonly query: string;
};

/** Paramètres du format. Un lien qui n'en porte aucun est une Configuration vierge (CA-1). */
const KNOWN_PARAMS = ["v", "t", "p", "s", "e", "n"] as const;

const notice = (code: NoticeCode, count = 1): Notice => ({ code, count });

/** Query brute (encodée, jamais décodée ici), sans le « ? » de tête. */
function rawQuery(search: string): string {
  return search.startsWith("?") ? search.slice(1) : search;
}

/**
 * Un paramètre `p` : `taux|libellé`. Le séparateur est le premier `|`, un `|` dans le libellé
 * reste du texte. Taux entier strict de 0 à 1000, libellé nettoyé de 1 à 40 caractères.
 */
export function parseParticipant(raw: string): Participant | null {
  const separator = raw.indexOf("|");
  if (separator === -1) return null;
  const rate = parseStrictInt(raw.slice(0, separator), LIMITS.minRate, LIMITS.maxRate);
  const label = sanitizeText(raw.slice(separator + 1), {
    min: LIMITS.labelMin,
    max: LIMITS.labelMax,
  });
  if (rate === null || !label.ok) return null;
  return { rate, label: label.value };
}

/** Nettoie un titre libre (`n`) : 0 à 60 caractères, contrôles et bidi retirés. */
export function parseTitle(raw: unknown): string | null {
  const title = sanitizeText(raw, { min: 0, max: LIMITS.titleMax });
  return title.ok ? title.value : null;
}

function readParticipants(params: URLSearchParams) {
  const all = params.getAll("p");
  const considered = all.slice(0, LIMITS.maxParticipants);
  const participants = considered
    .map(parseParticipant)
    .filter((participant) => participant !== null);
  return {
    participants,
    tooMany: all.length > LIMITS.maxParticipants,
    ignored: considered.length - participants.length,
  };
}

/** Début de réunion lu dans `s`, ou la raison du refus. */
function readStart(raw: string | null, nowSeconds: number): number | NoticeCode | null {
  if (raw === null) return null;
  const start = parseStrictInt(raw, LIMITS.earliestStart, Number.MAX_SAFE_INTEGER);
  if (start === null) return "bad-start";
  if (start > nowSeconds + LIMITS.futureTolerance) return "future-start";
  return start;
}

/**
 * Fin de réunion lue dans `e`, ou `null` (ignorée) avec la raison dans `notices` : hors de
 * ]s, s + 24 h], ou plus de 60 s dans le futur (CL-3).
 */
function readEnd(
  raw: string | null,
  start: number,
  nowSeconds: number,
  notices: Notice[],
): number | null {
  if (raw === null) return null;
  const end = parseStrictInt(raw, start + 1, start + LIMITS.maxDuration);
  if (end === null) {
    notices.push(notice("bad-end"));
    return null;
  }
  if (end > nowSeconds + LIMITS.futureTolerance) {
    notices.push(notice("future-end"));
    return null;
  }
  return end;
}

/**
 * Lit un lien. `search` est `location.search` ; `nowMs` l'heure de l'appareil en millisecondes
 * (passée en paramètre pour rester testable).
 */
export function parseLink(search: string, nowMs: number): ParsedLink {
  const raw = rawQuery(search);
  const blank = { meeting: defaultMeeting(), screen: "setup" as const, query: "" };
  // Borné sur la query brute, avant tout décodage (CL-8, CLAUDE.md).
  if (isPayloadTooLong(raw)) {
    return { ...blank, notices: [notice("too-long")] };
  }
  const params = new URLSearchParams(raw);
  if (!KNOWN_PARAMS.some((name) => params.has(name))) {
    return { ...blank, notices: [] };
  }
  if (parseStrictInt(firstParam(params, "v"), 1, 1) === null) {
    return { ...blank, notices: [notice("unknown-version")] };
  }

  const notices: Notice[] = [];
  const rawTariff = firstParam(params, "t");
  const tariff = parseEnum(rawTariff, TARIFF_CODES);
  if (rawTariff !== null && tariff === null) notices.push(notice("bad-tariff"));

  const rawTitle = firstParam(params, "n");
  const title = rawTitle === null ? "" : parseTitle(rawTitle);
  if (title === null) notices.push(notice("bad-title"));

  const { participants, tooMany, ignored } = readParticipants(params);
  if (tooMany) notices.push(notice("too-many-participants"));

  const base = { tariff: tariff ?? LINK_DEFAULT_TARIFF, title: title ?? "" };
  if (participants.length === 0) {
    notices.push(notice("no-participants"));
    const meeting = {
      ...base,
      participants: defaultMeeting().participants,
      start: null,
      end: null,
    };
    return { meeting, screen: "setup", notices, query: buildQuery(meeting) };
  }
  if (ignored > 0) notices.push(notice("ignored-participants", ignored));

  const nowSeconds = Math.floor(nowMs / 1000);
  const start = readStart(firstParam(params, "s"), nowSeconds);
  if (typeof start === "string") notices.push(notice(start));
  const validStart = typeof start === "number" ? start : null;

  const meeting: Meeting =
    validStart === null
      ? { ...base, participants, start: null, end: null }
      : {
          ...base,
          participants,
          start: validStart,
          end: readEnd(firstParam(params, "e"), validStart, nowSeconds, notices),
        };
  return { meeting, screen: screenOf(meeting), notices, query: buildQuery(meeting) };
}

/**
 * Encode un texte libre pour la query. `'` est encodé en plus d'`encodeURIComponent` : le
 * navigateur l'encode de toute façon dans la query d'une URL http(s) (WHATWG, « special-query
 * percent-encode set »). Ce qu'on écrit est donc exactement ce que `location.search` relira, et
 * la mesure des 4 Ko (CL-8) porte sur la vraie longueur du lien.
 */
function encodeText(text: string): string {
  return encodeURIComponent(text).replaceAll("'", "%27");
}

/**
 * Écrit la query d'une réunion, dans l'ordre de l'exemple de la spec :
 * `?v=1&t=B&p=68|Cheffe%20de%20projet&s=1760425200&n=Point%20rapide`. Le `|` reste en clair
 * (il ne fait pas partie de l'ensemble encodé des query WHATWG).
 */
export function buildQuery(meeting: Meeting): string {
  const parts = [
    "v=1",
    `t=${meeting.tariff}`,
    ...meeting.participants.map(
      (participant) => `p=${participant.rate}|${encodeText(participant.label)}`,
    ),
  ];
  if (meeting.start !== null) {
    parts.push(`s=${meeting.start}`);
    if (meeting.end !== null) parts.push(`e=${meeting.end}`);
  }
  if (meeting.title !== "") parts.push(`n=${encodeText(meeting.title)}`);
  return `?${parts.join("&")}`;
}

/** Vrai si l'app peut écrire ce lien sans qu'il soit refusé à l'ouverture (CL-8). */
export function fitsInLink(meeting: Meeting): boolean {
  return !isPayloadTooLong(rawQuery(buildQuery(meeting)));
}
