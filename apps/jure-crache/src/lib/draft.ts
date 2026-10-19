// Formulaire de rédaction (écran 1, CA-1, CA-10, CL-4, CL-5). Les règles sont celles du lien
// (deed.ts) : un acte accepté par le formulaire est toujours relu à l'identique depuis l'URL.
import { sanitizeText, type TextBounds } from "@paperasse/shared/text";
import { NBSP } from "@paperasse/shared/typography";
import { LIMITS, TEXT_BOUNDS, latestDeadline, sameName, type Deed } from "./deed";
import { compressPayload, fitsInLink } from "./link";

/** CA-10 : les 3 articles proposés par défaut, modifiables. */
export const DEFAULT_ARTICLES = [
  "Le retard est constaté au-delà de dix (10) minutes après l'heure convenue.",
  `Le message «${NBSP}j'suis en bas${NBSP}» ne vaut pas arrivée.`,
  "Toute excuse impliquant la SNCF sera examinée par le tribunal des potes, qui statue en dernier ressort.",
] as const;

/** Heure locale qui n'existe pas sur l'appareil : sautée au passage à l'heure d'été. */
export const NONEXISTENT_TIME = "nonexistent";

/**
 * Le formulaire tel que tapé. `deadline` vaut `null` si le champ date est vide ou illisible,
 * `NONEXISTENT_TIME` si l'heure tapée n'existe pas dans le fuseau de l'appareil.
 */
export type Draft = {
  readonly bettor: string;
  readonly opponent: string;
  readonly subject: string;
  readonly stake: string;
  readonly articles: readonly string[];
  readonly deadline: number | typeof NONEXISTENT_TIME | null;
};

/** Champs de texte libre du formulaire. */
export type TextField = "bettor" | "opponent" | "subject" | "stake" | "article";
export type FieldName = TextField | "deadline";

export type TextErrorCode =
  /** Vide après nettoyage (ou que des caractères invisibles). */
  | "empty"
  /** Plus long que la borne, en points de code. */
  | "too-long"
  /** CL-4 : même nom que le parieur. */
  | "same-names"
  /** L'acte entier ne tient pas dans un lien : posé sur le texte qui y prend le plus de place. */
  | "link-too-long";

export type DeadlineErrorCode =
  /** Champ date vide ou illisible. */
  | "missing-date"
  /** Heure sautée au passage à l'heure d'été (2 h 30 un dimanche de mars, à Paris). */
  | "nonexistent-time"
  /** CL-5 : échéance déjà passée (ou maintenant). */
  | "past-date"
  /** Plus de 10 ans après la rédaction. */
  | "too-far";

export type FieldErrorCode = TextErrorCode | DeadlineErrorCode;

export type FieldError =
  | {
      readonly field: TextField;
      /** Position de l'article (0 à 4) ; 0 pour les autres champs. */
      readonly index: number;
      readonly code: TextErrorCode;
    }
  | { readonly field: "deadline"; readonly index: 0; readonly code: DeadlineErrorCode };

export type DraftResult =
  | { readonly ok: true; readonly deed: Deed }
  | {
      readonly ok: false;
      readonly reason: "fields";
      /** Dans l'ordre du formulaire : le premier reçoit le focus (CA-1). */
      readonly errors: readonly [FieldError, ...FieldError[]];
    }
  | {
      readonly ok: false;
      /** L'horloge de l'appareil est avant 2026 : aucun acte ne serait relu. */
      readonly reason: "clock";
      /** Aucun champ n'est en cause. */
      readonly errors: readonly [];
    };

function checkText(value: string, bounds: TextBounds): { value: string } | TextErrorCode {
  const result = sanitizeText(value, bounds);
  if (result.ok) return { value: result.value };
  return result.reason === "too-long" ? "too-long" : "empty";
}

/** L'échéance en ms si elle est acceptable, sinon la raison du refus. */
function checkDeadline(deadline: Draft["deadline"], nowMs: number): number | DeadlineErrorCode {
  if (deadline === NONEXISTENT_TIME) return "nonexistent-time";
  if (deadline === null || !Number.isSafeInteger(deadline)) return "missing-date";
  if (deadline <= nowMs) return "past-date";
  if (deadline > latestDeadline(nowMs)) return "too-far";
  return deadline;
}

/**
 * Le texte libre qui prend le plus de place dans le lien, une fois compressé comme dans le hash :
 * c'est lui qu'il faut raccourcir quand l'acte ne tient pas. À égalité, le premier du formulaire.
 */
export function largestText(deed: Deed): { readonly field: TextField; readonly index: number } {
  type Candidate = { field: TextField; index: number; text: string };
  const candidates: Candidate[] = [
    { field: "bettor", index: 0, text: deed.bettor },
    { field: "opponent", index: 0, text: deed.opponent },
    { field: "subject", index: 0, text: deed.subject },
    { field: "stake", index: 0, text: deed.stake },
    ...deed.articles.map((text, index): Candidate => ({ field: "article", index, text })),
  ];
  let largest: { field: TextField; index: number; size: number } = {
    field: "bettor",
    index: 0,
    size: -1,
  };
  for (const { field, index, text } of candidates) {
    const size = compressPayload(text).length;
    if (size > largest.size) largest = { field, index, size };
  }
  return { field: largest.field, index: largest.index };
}

/**
 * Valide le formulaire. `nowMs` devient la date de rédaction `t`. Toutes les erreurs de champ
 * sont renvoyées d'un coup, dans l'ordre des champs, pour les afficher toutes.
 */
export function validateDraft(draft: Draft, nowMs: number): DraftResult {
  const errors: FieldError[] = [];
  const text = (field: TextField, value: string, bounds: TextBounds, index = 0): string => {
    const checked = checkText(value, bounds);
    if (typeof checked === "string") {
      errors.push({ field, index, code: checked });
      return "";
    }
    return checked.value;
  };

  const bettor = text("bettor", draft.bettor, TEXT_BOUNDS.bettor);
  const opponent = text("opponent", draft.opponent, TEXT_BOUNDS.opponent);
  if (bettor !== "" && opponent !== "" && sameName(bettor, opponent)) {
    errors.push({ field: "opponent", index: 0, code: "same-names" });
  }
  const subject = text("subject", draft.subject, TEXT_BOUNDS.subject);
  const stake = text("stake", draft.stake, TEXT_BOUNDS.stake);
  // L'interface ne propose jamais plus de 5 articles ; un 6e éventuel est ignoré.
  const articles = draft.articles
    .slice(0, LIMITS.articlesMax)
    .map((article, index) => text("article", article, TEXT_BOUNDS.article, index));

  const deadline = checkDeadline(draft.deadline, nowMs);
  if (typeof deadline === "string") {
    const deadlineError: FieldError = { field: "deadline", index: 0, code: deadline };
    // Le champ date vient en dernier dans le formulaire. La valeur par défaut ne sert qu'au
    // typage : la liste contient au moins l'erreur de date.
    const [first = deadlineError, ...rest] = [...errors, deadlineError];
    return { ok: false, reason: "fields", errors: [first, ...rest] };
  }
  const [first, ...rest] = errors;
  if (first !== undefined) return { ok: false, reason: "fields", errors: [first, ...rest] };
  if (!Number.isSafeInteger(nowMs) || nowMs < LIMITS.earliestDraft) {
    return { ok: false, reason: "clock", errors: [] };
  }

  const deed: Deed = {
    bettor,
    opponent,
    subject,
    stake,
    articles,
    deadline,
    draftedAt: nowMs,
  };
  // Textes très exotiques (idéogrammes rares) : l'acte respecte les bornes mais son lien
  // dépasserait 4 Ko. L'erreur va sur le texte à raccourcir, comme les autres (CA-1).
  if (!fitsInLink(deed)) {
    return {
      ok: false,
      reason: "fields",
      errors: [{ ...largestText(deed), code: "link-too-long" }],
    };
  }
  return { ok: true, deed };
}

// ---------------------------------------------------------------------------------------------
// Champ date (<input type="datetime-local">) : l'heure locale de l'appareil.
// ---------------------------------------------------------------------------------------------

export type LocalDateTime = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/u;

/** Lit la valeur d'un champ datetime-local (« 2026-10-17T20:00 »). Les secondes sont ignorées. */
export function parseLocalDateTime(value: string): LocalDateTime | null {
  const match = LOCAL_DATE_TIME.exec(value);
  if (match === null) return null;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/**
 * Instant (ms UTC) d'une heure locale, dans le fuseau du moteur qui exécute le code (celui de
 * l'appareil, dans le navigateur). `null` pour une date qui n'existe pas au calendrier
 * (31 février) ; `NONEXISTENT_TIME` pour une heure que l'horloge locale saute (passage à l'heure
 * d'été : à Paris, le 29 mars 2026, on passe de 1 h 59 à 3 h 00).
 */
export function localToEpoch(local: LocalDateTime): number | typeof NONEXISTENT_TIME | null {
  // Le calendrier d'abord, en UTC (pas d'heure sautée) : le constructeur reporte les
  // débordements (31/02 → 03/03) ; on refuse plutôt que deviner.
  const calendar = new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute),
  );
  if (
    calendar.getUTCFullYear() !== local.year ||
    calendar.getUTCMonth() !== local.month - 1 ||
    calendar.getUTCDate() !== local.day ||
    calendar.getUTCHours() !== local.hour ||
    calendar.getUTCMinutes() !== local.minute
  ) {
    return null;
  }
  const date = new Date(local.year, local.month - 1, local.day, local.hour, local.minute);
  const time = date.getTime();
  if (!Number.isSafeInteger(time)) return null;
  // Date valide au calendrier mais relue autrement en heure locale : l'heure n'existe pas ici
  // (le moteur l'a décalée d'une heure plutôt que de refuser).
  const sameLocal =
    date.getFullYear() === local.year &&
    date.getMonth() === local.month - 1 &&
    date.getDate() === local.day &&
    date.getHours() === local.hour &&
    date.getMinutes() === local.minute;
  return sameLocal ? time : NONEXISTENT_TIME;
}

/** Valeur d'un champ datetime-local pour l'instant `ms`, en heure locale : « 2026-10-17T20:00 ». */
export function toLocalInputValue(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-` +
    `${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Échéance proposée : dans 7 jours, à 20 h, heure locale (« la soirée de samedi »). */
export function defaultDeadline(nowMs: number): number {
  const date = new Date(nowMs);
  date.setDate(date.getDate() + 7);
  date.setHours(20, 0, 0, 0);
  return date.getTime();
}
