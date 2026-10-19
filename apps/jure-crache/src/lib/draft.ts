// Formulaire de rédaction (écran 1, CA-1, CA-10, CL-4, CL-5). Les règles sont celles du lien
// (deed.ts) : un acte accepté par le formulaire est toujours relu à l'identique depuis l'URL.
import { sanitizeText, type TextBounds } from "@paperasse/shared/text";
import { LIMITS, TEXT_BOUNDS, latestDeadline, sameName, type Deed } from "./deed";
import { NBSP } from "@paperasse/shared/typography";

/** CA-10 : les 3 articles proposés par défaut, modifiables. */
export const DEFAULT_ARTICLES = [
  "Le retard est constaté au-delà de dix (10) minutes après l'heure convenue.",
  `Le message «${NBSP}j'suis en bas${NBSP}» ne vaut pas arrivée.`,
  "Toute excuse impliquant la SNCF sera examinée par le tribunal des potes, qui statue en dernier ressort.",
] as const;

/** Le formulaire tel que tapé. `deadline` vaut `null` si le champ date est vide ou illisible. */
export type Draft = {
  readonly bettor: string;
  readonly opponent: string;
  readonly subject: string;
  readonly stake: string;
  readonly articles: readonly string[];
  readonly deadline: number | null;
};

export type FieldName = "bettor" | "opponent" | "subject" | "stake" | "article" | "deadline";

export type FieldErrorCode =
  /** Vide après nettoyage (ou que des caractères invisibles). */
  | "empty"
  /** Plus long que la borne, en points de code. */
  | "too-long"
  /** CL-4 : même nom que le parieur. */
  | "same-names"
  /** Champ date vide ou illisible. */
  | "missing-date"
  /** CL-5 : échéance déjà passée (ou maintenant). */
  | "past-date"
  /** Plus de 10 ans après la rédaction. */
  | "too-far";

export type FieldError = {
  readonly field: FieldName;
  /** Position de l'article (0 à 4) ; 0 pour les autres champs. */
  readonly index: number;
  readonly code: FieldErrorCode;
};

export type DraftResult =
  | { readonly ok: true; readonly deed: Deed }
  | {
      readonly ok: false;
      /** Dans l'ordre du formulaire : le premier reçoit le focus (CA-1). */
      readonly errors: readonly FieldError[];
      /** L'horloge de l'appareil est avant 2026 : aucun acte ne serait relu. */
      readonly clock: boolean;
    };

function checkText(value: string, bounds: TextBounds): { value: string } | FieldErrorCode {
  const result = sanitizeText(value, bounds);
  if (result.ok) return { value: result.value };
  return result.reason === "too-long" ? "too-long" : "empty";
}

/**
 * Valide le formulaire. `nowMs` devient la date de rédaction `t`. Toutes les erreurs sont
 * renvoyées d'un coup, dans l'ordre des champs, pour les afficher toutes.
 */
export function validateDraft(draft: Draft, nowMs: number): DraftResult {
  const errors: FieldError[] = [];
  const text = (field: FieldName, value: string, bounds: TextBounds, index = 0): string => {
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

  const deadline = draft.deadline;
  if (deadline === null || !Number.isSafeInteger(deadline)) {
    errors.push({ field: "deadline", index: 0, code: "missing-date" });
  } else if (deadline <= nowMs) {
    errors.push({ field: "deadline", index: 0, code: "past-date" });
  } else if (deadline > latestDeadline(nowMs)) {
    errors.push({ field: "deadline", index: 0, code: "too-far" });
  }

  const clock = !Number.isSafeInteger(nowMs) || nowMs < LIMITS.earliestDraft;
  if (errors.length > 0 || clock || deadline === null) {
    return { ok: false, errors, clock };
  }
  return {
    ok: true,
    deed: { bettor, opponent, subject, stake, articles, deadline, draftedAt: nowMs },
  };
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
 * l'appareil, dans le navigateur). `null` pour une date qui n'existe pas (31 février).
 */
export function localToEpoch(local: LocalDateTime): number | null {
  const date = new Date(local.year, local.month - 1, local.day, local.hour, local.minute);
  // Le constructeur reporte les débordements (31/02 → 03/03) : on refuse plutôt que deviner.
  if (date.getFullYear() !== local.year || date.getMonth() !== local.month - 1) return null;
  if (date.getDate() !== local.day) return null;
  const time = date.getTime();
  return Number.isSafeInteger(time) ? time : null;
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
