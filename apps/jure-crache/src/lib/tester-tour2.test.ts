// Tests unitaires du tour 2 (agent tester), écrits à partir de la spec mise à jour après le tour 1
// (specs/jure-crache.md) : numéro en année UTC (ligne 49 ; 128 bits en base32 depuis le tour 3), 4 Ko décodés mesurés en
// unités UTF-16 (ligne 41), acte d'emoji aux bornes, heure inexistante au passage à l'heure d'été,
// erreur « lien trop long » posée sur le texte à raccourcir (CA-1).
import { createHash, webcrypto } from "node:crypto";
import LZString from "lz-string";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson, type Deed } from "./deed";
import {
  DEFAULT_ARTICLES,
  MISSING_DEADLINE,
  deadlineAt,
  localToEpoch,
  parseLocalDateTime,
  validateDraft,
  type Draft,
} from "./draft";
import { formatDate } from "./format";
import { buildHash, fitsInLink, parseHash, type LinkState } from "./link";
import { TEXT, fieldErrorText, formErrorText, judgedLine } from "./messages";
import { deedNumber, fingerprint, type Digest } from "./seal";
import { DEED_NUMBER_SHAPE, expectedDeedNumber } from "../../../../tests/e2e/support/crockford";

/** Mercredi 14 octobre 2026, 10:00 à Paris. */
const NOW = Date.UTC(2026, 9, 14, 8, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NBSP = String.fromCodePoint(0xa0);

type DeedJson = { p: string; c: string; o: string; e: string; a: string[]; d: number; t: number };

const BASE: DeedJson = {
  p: "Théo",
  c: "Inès",
  o: "Kevin arrivera en retard à la soirée de samedi.",
  e: "Un (1) kebab, sauce au choix du gagnant.",
  a: ["Le retard est constaté au-delà de dix minutes."],
  d: NOW + 3 * DAY,
  t: NOW - 2 * HOUR,
};

function canonical(deed: DeedJson): string {
  return JSON.stringify({
    p: deed.p,
    c: deed.c,
    o: deed.o,
    e: deed.e,
    a: deed.a,
    d: deed.d,
    t: deed.t,
  });
}

function hashOfJson(json: string, suffix = ""): string {
  return `#1.${LZString.compressToEncodedURIComponent(json)}${suffix}`;
}

function deedOf(state: LinkState): Deed {
  if (state.screen !== "deed") throw new Error(`écran ${state.screen} au lieu de l'acte`);
  return state.deed;
}

const nodeDigest: Digest = (data) => webcrypto.subtle.digest("SHA-256", data);

/** Emoji d'un seul point de code (les plus larges à l'écran) et séquences ZWJ / drapeaux. */
const EMOJI = [
  "🎉",
  "😂",
  "🍕",
  "🚆",
  "⏰",
  "🥙",
  "🤝",
  "🏆",
  "😤",
  "🙏",
  "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
  "🇫🇷",
];
/** Texte d'emoji de `length` points de code exactement. */
function emoji(length: number, seed: number): string {
  const out: string[] = [];
  for (let index = seed; out.length < length; index += 5) {
    const next = Array.from(EMOJI[index % EMOJI.length] ?? "🎉");
    out.push(...(out.length + next.length <= length ? next : ["🎉"]));
  }
  return out.join("");
}

const EMOJI_AT_BOUNDS: DeedJson = {
  p: emoji(40, 1),
  c: emoji(40, 2),
  o: emoji(200, 3),
  e: emoji(120, 4),
  a: [5, 6, 7, 8, 9].map((seed) => emoji(160, seed)),
  d: BASE.d,
  t: BASE.t,
};

/** Idéogrammes tous différents : ils se compressent mal (lien long, bornes respectées). */
function distinctIdeographs(start: number) {
  let next = start;
  return {
    bmp: (length: number) =>
      Array.from({ length }, () => String.fromCodePoint(0x4e00 + ((next++ * 7919) % 20_000))).join(
        "",
      ),
    astral: (length: number) =>
      Array.from({ length }, () => String.fromCodePoint(0x20000 + ((next++ * 7919) % 40_000))).join(
        "",
      ),
  };
}

const draftOf = (changes: Partial<Draft>): Draft => ({
  bettor: "Théo",
  opponent: "Inès",
  subject: "Kevin sera en retard.",
  stake: "Un kebab.",
  articles: [...DEFAULT_ARTICLES],
  // Tour 3 (builder) : le champ date est lu en type discriminé (deadlineAt, MISSING_DEADLINE).
  deadline: deadlineAt(NOW + DAY),
  ...changes,
});

/**
 * Brouillon aux bornes, en idéogrammes tous différents, dont le lien dépasse 4 Ko. L'article 2
 * (idéogrammes hors du plan de base, 2 unités UTF-16 chacun) est de loin le plus lourd.
 */
function heavyDraft(): Draft {
  const gen = distinctIdeographs(1);
  const bmp = gen.bmp;
  const bettor = bmp(40);
  const opponent = bmp(40);
  const subject = bmp(200);
  const stake = bmp(120);
  const first = bmp(160);
  const second = distinctIdeographs(1).astral(160);
  const third = bmp(150);
  const fourth = bmp(100);
  return draftOf({ bettor, opponent, subject, stake, articles: [first, second, third, fourth] });
}

// ---------------------------------------------------------------------------------------------

let savedTimeZone: string | undefined;
beforeEach(() => {
  savedTimeZone = process.env["TZ"];
});
afterEach(() => {
  if (savedTimeZone === undefined) delete process.env["TZ"];
  else process.env["TZ"] = savedTimeZone;
});

// Mis à jour au tour 3 par le builder : la spec (ligne 49) passe à 128 bits en base32 Crockford.
describe("CA-3 · numéro sur 128 bits, année UTC (spec ligne 49)", () => {
  it.each(["Europe/Paris", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"])(
    "CA-3 · rédigé le 31/12/2026 à 23:30 UTC : année 2026 dans le numéro, fuseau %s",
    async (zone) => {
      process.env["TZ"] = zone;
      const deed: DeedJson = {
        ...BASE,
        t: Date.UTC(2026, 11, 31, 23, 30),
        d: Date.UTC(2027, 0, 5),
      };
      const parsed = deedOf(parseHash(hashOfJson(canonical(deed)), Date.UTC(2027, 0, 1, 1)));
      const shown = deedNumber(await fingerprint(parsed, nodeDigest), parsed.draftedAt);
      const hex = createHash("sha256").update(canonical(deed), "utf8").digest("hex");
      expect(shown).toBe(expectedDeedNumber(hex, deed.t));
      expect(shown.startsWith(`N°${NBSP}2026-`)).toBe(true);
    },
  );

  it("CA-3 · le numéro a exactement la forme N° AAAA-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XX (base32 Crockford)", async () => {
    const parsed = deedOf(parseHash(hashOfJson(canonical(BASE)), NOW));
    const shown = deedNumber(await fingerprint(parsed, nodeDigest), parsed.draftedAt);
    expect(shown).toMatch(DEED_NUMBER_SHAPE);
    expect(shown.startsWith(`N°${NBSP}2026-`)).toBe(true);
  });
});

describe("Format d'URL · 4 Ko décodés en unités UTF-16 (spec ligne 41)", () => {
  it("un JSON de 4096 unités UTF-16 mais de plus de 4096 octets UTF-8 (emoji) est accepté", () => {
    const deed: DeedJson = { ...BASE, o: emoji(200, 0) };
    const json = canonical(deed);
    const padded = `${json.slice(0, -1)}${" ".repeat(4096 - json.length)}}`;
    expect(padded.length).toBe(4096);
    expect(new TextEncoder().encode(padded).length).toBeGreaterThan(4096);
    expect(deedOf(parseHash(hashOfJson(padded), NOW)).subject).toBe(deed.o);
  });

  it("4097 unités UTF-16 décodées, emoji compris → Acte illisible", () => {
    const json = canonical({ ...BASE, o: emoji(200, 0) });
    const padded = `${json.slice(0, -1)}${" ".repeat(4097 - json.length)}}`;
    expect(parseHash(hashOfJson(padded), NOW).screen).toBe("unreadable");
  });

  it("acte d'emoji aux bornes (1200 points de code, plus de 4 Ko en UTF-8) : accepté par le lien", () => {
    const json = canonical(EMOJI_AT_BOUNDS);
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(4096);
    const deed = deedOf(parseHash(hashOfJson(json), NOW));
    expect(Array.from(deed.subject)).toHaveLength(200);
    expect(deed.articles).toHaveLength(5);
  });

  it("acte d'emoji aux bornes tapé dans le formulaire : scellé, puis relu à l'identique", () => {
    const result = validateDraft(
      draftOf({
        bettor: EMOJI_AT_BOUNDS.p,
        opponent: EMOJI_AT_BOUNDS.c,
        subject: EMOJI_AT_BOUNDS.o,
        stake: EMOJI_AT_BOUNDS.e,
        articles: EMOJI_AT_BOUNDS.a,
      }),
      NOW,
    );
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(fitsInLink(result.deed)).toBe(true);
    for (const verdict of [null, "p", "c", "n"] as const) {
      expect(deedOf(parseHash(buildHash(result.deed, verdict), NOW))).toEqual(result.deed);
    }
  });

  it('le JSON canonique de tout acte aux bornes tient sous 4096 unités, même fait de " et de \\', () => {
    const deed: Deed = {
      bettor: '"'.repeat(40),
      opponent: "\\".repeat(40),
      subject: '"'.repeat(200),
      stake: "\\".repeat(120),
      articles: Array.from({ length: 5 }, () => '"'.repeat(160)),
      deadline: BASE.d,
      draftedAt: BASE.t,
    };
    expect(canonicalJson(deed).length).toBeLessThanOrEqual(4096);
  });
});

describe("CA-1 · acte trop long pour un lien : erreur sur le texte à raccourcir", () => {
  it("CA-1 · l'erreur est posée sur un seul champ, l'article 2 (le plus lourd), avec le message du lien", () => {
    const draft = heavyDraft();
    const result = validateDraft(draft, NOW);
    if (result.ok || result.reason !== "fields")
      throw new Error("accepté alors que le lien dépasse 4 Ko");
    expect(result.errors).toEqual([{ field: "article", index: 1, code: "link-too-long" }]);
    expect(formErrorText(result.errors)).toBe(TEXT.linkTooLong);
    const [error] = result.errors;
    expect(fieldErrorText(error)).toMatch(/lien/u);
  });

  it("CA-1 · raccourcir le texte signalé suffit : l'acte se scelle et se relit", () => {
    const draft = heavyDraft();
    const result = validateDraft(draft, NOW);
    if (result.ok || result.reason !== "fields") throw new Error("accepté");
    const [error] = result.errors;
    if (error.field !== "article") throw new Error(`champ signalé : ${error.field}`);
    const articles = draft.articles.map((text, index) => (index === error.index ? "Court." : text));
    const shortened = validateDraft({ ...draft, articles }, NOW);
    if (!shortened.ok) throw new Error(JSON.stringify(shortened.errors));
    expect(deedOf(parseHash(buildHash(shortened.deed, "p"), NOW))).toEqual(shortened.deed);
  });

  it("CA-1 · un acte que le formulaire accepte n'est jamais refusé par le lien, verdict compris", () => {
    // Juste sous la limite : on retire des articles du brouillon lourd jusqu'à ce qu'il passe.
    const draft = heavyDraft();
    for (let count = draft.articles.length; count >= 0; count -= 1) {
      const result = validateDraft({ ...draft, articles: draft.articles.slice(0, count) }, NOW);
      if (!result.ok) continue;
      for (const verdict of [null, "p", "c", "n"] as const) {
        expect(parseHash(buildHash(result.deed, verdict), NOW).screen).toBe("deed");
      }
      return;
    }
    throw new Error("aucune variante acceptée");
  });
});

describe("Échéance · heure qui n'existe pas au passage à l'heure d'été", () => {
  const typed = (value: string) => {
    const local = parseLocalDateTime(value);
    if (local === null) throw new Error(`illisible : ${value}`);
    return localToEpoch(local);
  };

  it.each([
    ["Europe/Paris", "2027-03-28T02:30"],
    ["Europe/Paris", "2027-03-28T02:00"],
    ["America/New_York", "2027-03-14T02:30"],
    // Lord Howe avance d'une demi-heure seulement : 2 h 00 → 2 h 30.
    ["Australia/Lord_Howe", "2027-10-03T02:15"],
  ])("%s, %s : refusée sur l'échéance, avec un message qui le dit", (zone, value) => {
    process.env["TZ"] = zone;
    const result = validateDraft(draftOf({ deadline: typed(value) }), NOW);
    if (result.ok) throw new Error(`accepté : ${new Date(result.deed.deadline).toISOString()}`);
    if (result.reason !== "fields") throw new Error("horloge");
    expect(result.errors).toHaveLength(1);
    const [error] = result.errors;
    expect(error.field).toBe("deadline");
    expect(fieldErrorText(error)).toMatch(/heure/u);
    expect(fieldErrorText(error)).not.toMatch(/passée/u);
  });

  it.each([
    ["Europe/Paris", "2027-03-28T03:00", Date.UTC(2027, 2, 28, 1, 0)],
    ["Europe/Paris", "2027-03-28T01:59", Date.UTC(2027, 2, 28, 0, 59)],
    ["Asia/Tokyo", "2027-03-28T02:30", Date.UTC(2027, 2, 27, 17, 30)],
    ["America/New_York", "2027-03-28T02:30", Date.UTC(2027, 2, 28, 6, 30)],
    ["Australia/Lord_Howe", "2027-10-03T02:30", Date.UTC(2027, 9, 2, 15, 30)],
  ])("%s, %s : acceptée à l'instant attendu", (zone, value, expected) => {
    process.env["TZ"] = zone;
    const result = validateDraft(draftOf({ deadline: typed(value) }), NOW);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.deed.deadline).toBe(expected);
  });

  it("Europe/Paris, 2026-10-25T02:30 (heure qui existe deux fois) : acceptée, relue à 02:30", () => {
    process.env["TZ"] = "Europe/Paris";
    const result = validateDraft(draftOf({ deadline: typed("2026-10-25T02:30") }), NOW);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(new Date(result.deed.deadline).getHours()).toBe(2);
    expect(new Date(result.deed.deadline).getMinutes()).toBe(30);
  });

  it.each(["2027-02-29T20:00", "2026-11-31T20:00", "2026-10-20T24:00", "2026-10-20T20:60"])(
    "%s : date impossible au calendrier, refusée",
    (value) => {
      process.env["TZ"] = "Europe/Paris";
      const local = parseLocalDateTime(value);
      const deadline = local === null ? MISSING_DEADLINE : localToEpoch(local);
      const result = validateDraft(draftOf({ deadline }), NOW);
      expect(result.ok).toBe(false);
    },
  );
});

describe("Écran 3 · « Verdict déclaré. Échéance du pari : <date> » (spec ligne 14)", () => {
  it("la ligne de l'acte jugé ne porte que la date d'échéance", () => {
    const deadline = Date.UTC(2026, 9, 17, 18, 0);
    const line = judgedLine(formatDate(deadline, "Europe/Paris"));
    expect(line).toMatch(
      new RegExp(`^Verdict déclaré\\. Échéance du pari${NBSP}: 17 octobre 2026\\.?$`, "u"),
    );
  });

  it("dans le fuseau de l'appareil : l'échéance du 17 à 20 h (Paris) tombe le 18 à Auckland", () => {
    const deadline = Date.UTC(2026, 9, 17, 18, 0);
    expect(judgedLine(formatDate(deadline, "Pacific/Auckland"))).toContain("18 octobre 2026");
  });
});
