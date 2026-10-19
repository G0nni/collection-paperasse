// Tests unitaires de Juré Craché écrits par l'agent tester à partir de specs/jure-crache.md
// (Format d'URL, Empreinte, CA-3, CA-4, CA-10, CL-1, CL-2, CL-4, CL-5, CL-6) et de CLAUDE.md
// (Sécurité). Ils prennent la logique pure par ses entrées réelles : un hash brut, comme
// `location.hash`, et l'heure de l'appareil.
import { createHash, webcrypto } from "node:crypto";
import LZString from "lz-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countdown, spokenCountdown, stubs } from "./countdown";
import { canonicalJson, type Deed } from "./deed";
import { DEFAULT_ARTICLES, validateDraft, type Draft } from "./draft";
import { buildHash, fitsInLink, parseHash, type LinkState } from "./link";
import { TEXT } from "./messages";
import {
  UNSEALED_NUMBER,
  WAX_PALETTE,
  deedNumber,
  fingerprint,
  waxIndex,
  type Digest,
} from "./seal";
import { signaturePath } from "./signature";

/** Mercredi 14 octobre 2026, 10:00 à Paris. */
const NOW = Date.UTC(2026, 9, 14, 8, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NBSP = String.fromCodePoint(0xa0);
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const NUL = String.fromCodePoint(0);

type DeedJson = { p: string; c: string; o: string; e: string; a: string[]; d: number; t: number };

const BASE: DeedJson = {
  p: "Théo",
  c: "Inès",
  o: "Kevin arrivera en retard à la soirée de samedi.",
  e: "Un (1) kebab, sauce au choix du gagnant.",
  a: ["Le retard est constaté au-delà de dix minutes.", "Un message vocal ne vaut pas arrivée."],
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

function hashOf(deed: DeedJson, suffix = ""): string {
  return hashOfJson(canonical(deed), suffix);
}

function deedOf(state: LinkState): Deed {
  if (state.screen !== "deed") throw new Error(`écran ${state.screen} au lieu de l'acte`);
  return state.deed;
}

const nodeDigest: Digest = (data) => webcrypto.subtle.digest("SHA-256", data);

/** Numéro attendu d'après la spec, calculé indépendamment (node:crypto). */
function specNumber(deed: DeedJson): string {
  const hex = createHash("sha256").update(canonical(deed), "utf8").digest("hex").toUpperCase();
  return `N°${NBSP}${new Date(deed.t).getUTCFullYear()}-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

async function shownNumber(hash: string, now = NOW): Promise<string> {
  const deed = deedOf(parseHash(hash, now));
  return deedNumber(await fingerprint(deed, nodeDigest), deed.draftedAt);
}

/** Quelques centaines d'octets compressés qui se décompressent en 200 000 caractères. */
const BOMB_JSON = `"${"a".repeat(200_000)}"`;

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------------------------
// CL-1 · formes du hash
// ---------------------------------------------------------------------------------------------

describe("CL-1 · formes du hash", () => {
  it.each(["", "#", "#1", "#1."])("CL-1 · « %s » → Rédaction", (hash) => {
    expect(parseHash(hash, NOW).screen).toBe("draft");
  });

  it.each([
    "#2.xxx",
    "#2",
    "#2.",
    `#2.${LZString.compressToEncodedURIComponent(canonical(BASE))}`,
    "#10.abc",
  ])("CL-1 · « %s » → version inconnue", (hash) => {
    expect(parseHash(hash, NOW).screen).toBe("unknown-version");
  });

  it.each([
    [".p", "p"],
    [".c", "c"],
    [".n", "n"],
  ] as const)("CL-1 · suffixe « %s » → verdict %s, forme propre identique", (suffix, verdict) => {
    const state = parseHash(hashOf(BASE, suffix), NOW);
    if (state.screen !== "deed") throw new Error(state.screen);
    expect(state.verdict).toBe(verdict);
    expect(state.notices).toEqual([]);
    expect(state.hash).toBe(hashOf(BASE, suffix));
  });

  it.each([".z", ".P", ".N", ".pp", ".p.c", ".", "..p", ".%70", ".é"])(
    "CL-1 · verdict inconnu « %s » → acte sans verdict, signalé, retiré de la forme propre",
    (suffix) => {
      const state = parseHash(`${hashOf(BASE)}${suffix}`, NOW);
      if (state.screen !== "deed") throw new Error(state.screen);
      expect(state.verdict).toBeNull();
      expect(state.notices).toEqual(["unknown-verdict"]);
      expect(state.hash).toBe(hashOf(BASE));
    },
  );
});

// ---------------------------------------------------------------------------------------------
// CL-2 · payloads hostiles
// ---------------------------------------------------------------------------------------------

describe("CL-2 · payload hostile", () => {
  const valid = canonical(BASE);
  it.each([
    ["tableau", "[]"],
    ["tableau contenant l'acte", `[${valid}]`],
    ["nombre", "42"],
    ["null", "null"],
    ["chaîne", '"acte"'],
    ["booléen", "false"],
    ["objet vide", "{}"],
    ["__proto__ en plus", `{"__proto__":{"polluted":1},${valid.slice(1)}`],
    ["__proto__ à la place de p", valid.replace('"p":', '"__proto__":')],
    ["constructor.prototype", `{"constructor":{"prototype":{"polluted":1}},${valid.slice(1)}`],
    ["prototype", `{"prototype":{"polluted":1},${valid.slice(1)}`],
    ["toString", `{"toString":"x",${valid.slice(1)}`],
    ["JSON invalide", "{p:1}"],
    ["JSON tronqué", valid.slice(0, -1)],
    ["clé en double inconnue", `${valid.slice(0, -1)},"P":"x"}`],
    ["> 4 Ko décompressés (blancs)", `${valid}${" ".repeat(4096)}`],
    ["bombe de décompression", BOMB_JSON],
  ])("CL-2 · %s → Acte illisible, sans pollution de prototype", (_label, json) => {
    const state = parseHash(hashOfJson(json), NOW);
    expect(state.screen).toBe("unreadable");
    const probe: Record<string, unknown> = {};
    expect(probe["polluted"]).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("CL-2 · un payload qui décompresse en 4096 octets UTF-8 exactement est accepté", () => {
    const json = canonical(BASE);
    const padded = `${json.slice(0, -1)}${" ".repeat(4096 - new TextEncoder().encode(json).length)}}`;
    expect(new TextEncoder().encode(padded).length).toBe(4096);
    expect(parseHash(hashOfJson(padded), NOW).screen).toBe("deed");
  });

  it("CL-2 · 4097 octets décompressés → Acte illisible", () => {
    const json = canonical(BASE);
    const padded = `${json.slice(0, -1)}${" ".repeat(4097 - new TextEncoder().encode(json).length)}}`;
    expect(parseHash(hashOfJson(padded), NOW).screen).toBe("unreadable");
  });

  it("CL-2 · lz-string qui renvoie null ou une chaîne vide → Acte illisible", () => {
    for (const payload of ["A", "Q", "AAAA", "-", "$$$$", "+"]) {
      const decoded = LZString.decompressFromEncodedURIComponent(payload);
      if (decoded === null || decoded === "") {
        expect(parseHash(`#1.${payload}`, NOW).screen, payload).toBe("unreadable");
      }
    }
  });

  it("CL-2 · hash brut de 4097 caractères refusé avant tout décodage, 4096 lu", () => {
    const decompress = vi.spyOn(LZString, "decompressFromEncodedURIComponent");
    // « 1. » + 4095 = 4097 caractères bruts (sans le « # »).
    expect(parseHash(`#1.${"A".repeat(4095)}`, NOW).screen).toBe("unreadable");
    expect(decompress).not.toHaveBeenCalled();
    // 4096 caractères bruts : lu (puis refusé plus loin, mais décodé).
    parseHash(`#1.${"A".repeat(4094)}`, NOW);
    expect(decompress).toHaveBeenCalledTimes(1);
    decompress.mockRestore();
  });

  it("CL-2 · le parseur ne lève jamais : 3000 hashes aléatoires", () => {
    let seed = 42;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 2 ** 32;
    };
    const alphabet = [
      ...'ABCabc019+-$.#%{}[]":,',
      RLO,
      NUL,
      "é",
      "🎉",
      String.fromCodePoint(0xd800),
    ];
    const base = hashOf(BASE);
    for (let run = 0; run < 3000; run += 1) {
      const length = Math.floor(random() * 60);
      let mutated = random() < 0.5 ? base : "#1.";
      for (let index = 0; index < length; index += 1) {
        const position = Math.floor(random() * (mutated.length + 1));
        const char = alphabet[Math.floor(random() * alphabet.length)] ?? "A";
        mutated = mutated.slice(0, position) + char + mutated.slice(position + 1);
      }
      expect(() => parseHash(mutated, NOW)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Schéma : chaque clé, chaque borne (Format d'URL)
// ---------------------------------------------------------------------------------------------

describe("Schéma de l'acte", () => {
  const refuse = (changes: Record<string, unknown>) =>
    parseHash(hashOfJson(JSON.stringify({ ...BASE, ...changes })), NOW).screen;

  it.each(["p", "c", "o", "e", "a", "d", "t"])("clé manquante « %s » → refusé", (key) => {
    const copy = Object.fromEntries(Object.entries(BASE).filter(([name]) => name !== key));
    expect(parseHash(hashOfJson(JSON.stringify(copy)), NOW).screen).toBe("unreadable");
  });

  it.each([
    ["p vide", { p: "" }],
    ["p blancs", { p: " \t\n " }],
    ["p que des invisibles", { p: `${ZWSP}${ZWSP}` }],
    ["p que des contrôles", { p: `${NUL}${RLO}` }],
    ["p nombre", { p: 7 }],
    ["p 41", { p: "x".repeat(41) }],
    ["c 41", { c: "x".repeat(41) }],
    ["c 41 emoji", { c: "🎉".repeat(41) }],
    ["o 201", { o: "x".repeat(201) }],
    ["e 121", { e: "x".repeat(121) }],
    ["a chaîne", { a: "x" }],
    ["a null", { a: null }],
    ["a 6", { a: ["1", "2", "3", "4", "5", "6"] }],
    ["a élément vide", { a: ["ok", ""] }],
    ["a élément 161", { a: ["x".repeat(161)] }],
    ["a élément tableau", { a: [["x"]] }],
    ["d chaîne", { d: String(BASE.d) }],
    ["d flottant", { d: BASE.d + 0.5 }],
    ["d = t", { d: BASE.t }],
    ["d < t", { d: BASE.t - 1 }],
    ["d > t + 10 ans", { d: BASE.t + 3654 * DAY }],
    ["d non sûr", { d: 2 ** 53 }],
    ["t < 2026", { t: Date.UTC(2026, 0, 1) - 1 }],
    ["t > maintenant + 1 jour", { t: NOW + DAY + 1, d: NOW + 3 * DAY }],
    ["t flottant", { t: BASE.t + 0.5 }],
    ["t booléen", { t: true }],
  ])("%s → refusé", (_label, changes) => {
    expect(refuse(changes)).toBe("unreadable");
  });

  it.each([
    ["p 40", { p: "x".repeat(40) }],
    ["p 40 emoji", { p: "🎉".repeat(40) }],
    ["p arabe", { p: "ثيو" }],
    [
      "o 200, e 120, a 5 × 160",
      {
        o: "o".repeat(200),
        e: "e".repeat(120),
        a: Array.from({ length: 5 }, () => "a".repeat(160)),
      },
    ],
    ["a vide", { a: [] }],
    ["d = t + 1", { d: BASE.t + 1 }],
    ["d = t + 3650 jours", { d: BASE.t + 3650 * DAY }],
    ["t = 2026-01-01T00:00Z", { t: Date.UTC(2026, 0, 1), d: Date.UTC(2026, 0, 2) }],
    ["t = maintenant + 1 jour", { t: NOW + DAY, d: NOW + 2 * DAY }],
    ["d dans le passé", { d: NOW - DAY, t: NOW - 2 * DAY }],
  ])("%s → accepté", (_label, changes) => {
    expect(refuse(changes)).toBe("deed");
  });

  it("textes : trim, contrôles et bidi retirés, NFC, avant les bornes", () => {
    const state = parseHash(
      hashOfJson(
        JSON.stringify({
          ...BASE,
          p: `  ${RLO}Théo${NUL}  `,
          c: "Inès",
          o: `${"x".repeat(200)}${RLO}${RLO}`,
        }),
      ),
      NOW,
    );
    const deed = deedOf(state);
    expect(deed.bettor).toBe("Théo");
    expect(deed.opponent).toBe("Inès");
    expect(deed.subject).toBe("x".repeat(200));
  });

  it.each([
    ["Théo", "théo"],
    ["THÉO", "théo"],
    ["Théo", "Théo"],
    ["Théo", `Th${ZWSP}éo`],
    ["Théo", ` théo${RLO}`],
    ["STRASSE", "straße"],
  ])("CL-4 · « %s » contre « %s » arrivé par l'URL → refusé", (p, c) => {
    expect(refuse({ p, c })).toBe("unreadable");
  });

  it("CL-4 · deux noms qui ne diffèrent que par un accent restent deux personnes", () => {
    expect(refuse({ p: "Théo", c: "Theo" })).toBe("deed");
  });
});

// ---------------------------------------------------------------------------------------------
// CA-3 · Empreinte et numéro
// ---------------------------------------------------------------------------------------------

describe("CA-3 · numéro d'acte", () => {
  it("CA-3 · le JSON canonique est celui de la spec (ordre p, c, o, e, a, d, t, sans espace)", () => {
    const deed = deedOf(parseHash(hashOf(BASE), NOW));
    expect(canonicalJson(deed)).toBe(canonical(BASE));
  });

  it("CA-3 · N° AAAA-XXXX-XXXX : année de t, 8 premiers hex du SHA-256, en majuscules", async () => {
    expect(await shownNumber(hashOf(BASE))).toBe(specNumber(BASE));
  });

  it("CA-3 · chaque caractère de chaque texte modifié seul change le numéro", async () => {
    const original = await shownNumber(hashOf(BASE));
    const seen = new Set([original]);
    const fields = ["p", "c", "o", "e"] as const;
    let checked = 0;
    for (const key of fields) {
      const chars = Array.from(BASE[key]);
      for (let index = 0; index < chars.length; index += 1) {
        const replacement = chars[index] === "x" ? "y" : "x";
        const mutated = [...chars.slice(0, index), replacement, ...chars.slice(index + 1)].join("");
        // « Théo » → « Théx » : les noms doivent rester différents l'un de l'autre.
        const deed: DeedJson = { ...BASE, [key]: mutated };
        const state = parseHash(hashOf(deed), NOW);
        if (state.screen !== "deed") continue;
        const number = await shownNumber(hashOf(deed));
        expect(number, `${key}[${index}]`).toBe(specNumber(deed));
        expect(seen.has(number), `${key}[${index}] : collision`).toBe(false);
        seen.add(number);
        checked += 1;
      }
    }
    for (const [index, article] of BASE.a.entries()) {
      const chars = Array.from(article);
      for (let position = 0; position < chars.length; position += 5) {
        const replacement = chars[position] === "x" ? "y" : "x";
        const a = [...BASE.a];
        a[index] = [...chars.slice(0, position), replacement, ...chars.slice(position + 1)].join(
          "",
        );
        const number = await shownNumber(hashOf({ ...BASE, a }));
        expect(seen.has(number)).toBe(false);
        seen.add(number);
        checked += 1;
      }
    }
    for (const delta of [1, -1, 1000]) {
      for (const key of ["d", "t"] as const) {
        const number = await shownNumber(hashOf({ ...BASE, [key]: BASE[key] + delta }));
        expect(seen.has(number), `${key} ${delta}`).toBe(false);
        seen.add(number);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("CA-3 · ajouter, retirer ou réordonner un article change le numéro", async () => {
    const numbers = await Promise.all(
      [BASE.a, [...BASE.a, "Un troisième."], BASE.a.slice(0, 1), [...BASE.a].reverse(), []].map(
        (a) => shownNumber(hashOf({ ...BASE, a })),
      ),
    );
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("CA-3 · le verdict ne fait pas partie de l'empreinte", async () => {
    const numbers = await Promise.all(
      ["", ".p", ".c", ".n"].map((suffix) => shownNumber(hashOf(BASE, suffix))),
    );
    expect(new Set(numbers).size).toBe(1);
  });

  it("CA-2 · clés réordonnées, textes à nettoyer : même acte, même numéro que la forme propre", async () => {
    const shuffled = JSON.stringify({
      t: BASE.t,
      a: BASE.a,
      d: BASE.d,
      e: BASE.e,
      o: BASE.o,
      c: BASE.c,
      p: `${RLO}${BASE.p} `,
    });
    expect(await shownNumber(hashOfJson(shuffled))).toBe(specNumber(BASE));
    const state = parseHash(hashOfJson(shuffled), NOW);
    if (state.screen !== "deed") throw new Error(state.screen);
    expect(state.hash).toBe(hashOf(BASE));
  });

  it("CA-2 · année du numéro : celle de t en UTC, la même dans tous les fuseaux", async () => {
    const lateDecember = Date.UTC(2026, 11, 31, 23, 30);
    const deed = { ...BASE, t: lateDecember, d: lateDecember + DAY };
    const number = await shownNumber(hashOf(deed), lateDecember);
    expect(number.startsWith(`N°${NBSP}2026-`)).toBe(true);
  });

  it("CL-6 · sans digest : N° NON-SCELLÉ ; digest qui échoue ou renvoie n'importe quoi : idem", async () => {
    const deed = deedOf(parseHash(hashOf(BASE), NOW));
    expect(deedNumber(await fingerprint(deed, null), deed.draftedAt)).toBe(UNSEALED_NUMBER);
    expect(UNSEALED_NUMBER).toBe(`N°${NBSP}NON-SCELLÉ`);
    const failing: Digest = () => Promise.reject(new Error("refus"));
    expect(await fingerprint(deed, failing)).toBeNull();
    const short: Digest = () => Promise.resolve(new ArrayBuffer(4));
    expect(await fingerprint(deed, short)).toBeNull();
  });

  it("cire : toujours une des 4 teintes de la palette, les 4 servent, la même pour un acte donné", async () => {
    expect(WAX_PALETTE).toEqual(["#9E2A24", "#1E4636", "#2B3A67", "#7A4B12"]);
    const used = new Set<number>();
    for (let index = 0; index < 64; index += 1) {
      const deed = deedOf(parseHash(hashOf({ ...BASE, o: `Pari ${index}.` }), NOW));
      const print = await fingerprint(deed, nodeDigest);
      const wax = waxIndex(print);
      expect(WAX_PALETTE[wax]).toBeDefined();
      expect(waxIndex(await fingerprint(deed, nodeDigest))).toBe(wax);
      used.add(wax);
    }
    expect(used.size).toBe(4);
    expect(waxIndex(null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// CA-2 · ce que le formulaire accepte, le lien le relit à l'identique
// ---------------------------------------------------------------------------------------------

describe("CA-2 · aller-retour formulaire → lien", () => {
  const draft = (changes: Partial<Draft>): Draft => ({
    bettor: "Théo",
    opponent: "Inès",
    subject: "Kevin sera en retard.",
    stake: "Un kebab.",
    articles: [...DEFAULT_ARTICLES],
    deadline: NOW + DAY,
    ...changes,
  });

  it.each([
    ["défaut", {}],
    [
      "emoji ZWJ",
      {
        bettor: "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} Famille",
        opponent: "\u{1F3F3}\uFE0F\u200D\u{1F308}",
      },
    ],
    ["arabe et hébreu", { bettor: "ثيو", opponent: "שלום", subject: "مرحبا بالعالم" }],
    ["marques combinantes", { bettor: "Zé́́́́́ro" }],
    ["guillemets et antislash", { subject: 'Il a dit "non" \\ puis « oui »' }],
    ["invisibles mêlés", { bettor: `Th${ZWSP}éo`, opponent: `${RLO}Inès` }],
    [
      "bornes en prose",
      {
        subject: "é".repeat(200),
        stake: "à".repeat(120),
        articles: Array.from({ length: 5 }, () => "ç".repeat(160)),
      },
    ],
    ["0 article", { articles: [] }],
  ] as const)("%s : l'acte scellé est relu tel quel depuis l'URL", (_label, changes) => {
    const result = validateDraft(draft(changes), NOW);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(fitsInLink(result.deed)).toBe(true);
    const reread = deedOf(parseHash(buildHash(result.deed, null), NOW));
    expect(reread).toEqual(result.deed);
    // Ouvert plus tard (jusqu'à 10 ans), l'acte reste lisible.
    expect(parseHash(buildHash(result.deed, "p"), NOW + 365 * DAY).screen).toBe("deed");
  });

  it("CA-2 · l'acte relu sur un appareil en retard de 23 h reste lisible", () => {
    const result = validateDraft(draft({}), NOW);
    if (!result.ok) throw new Error("refus");
    expect(parseHash(buildHash(result.deed, null), NOW - 23 * HOUR).screen).toBe("deed");
  });
});

// ---------------------------------------------------------------------------------------------
// CA-1 / CA-10 / CL-4 / CL-5 · formulaire
// ---------------------------------------------------------------------------------------------

describe("Formulaire", () => {
  const draft = (changes: Partial<Draft>): Draft => ({
    bettor: "Théo",
    opponent: "Inès",
    subject: "Kevin sera en retard.",
    stake: "Un kebab.",
    articles: [...DEFAULT_ARTICLES],
    deadline: NOW + DAY,
    ...changes,
  });

  it("CA-10 · 3 articles par défaut : retard > 10 min, « j'suis en bas », SNCF", () => {
    expect(DEFAULT_ARTICLES).toHaveLength(3);
    const [late, downstairs, sncf] = DEFAULT_ARTICLES;
    expect(late).toMatch(/retard/iu);
    expect(late).toMatch(/\(10\) minutes|10 min/u);
    expect(downstairs).toBe(`Le message «${NBSP}j'suis en bas${NBSP}» ne vaut pas arrivée.`);
    expect(sncf).toMatch(/SNCF/u);
    expect(sncf).toMatch(/examinée par le tribunal des potes/u);
    for (const article of DEFAULT_ARTICLES) {
      expect(Array.from(article).length).toBeLessThanOrEqual(160);
    }
  });

  it("CA-1 · formulaire vide : erreurs dans l'ordre du formulaire (le premier reçoit le focus)", () => {
    const result = validateDraft(draft({ bettor: "", opponent: "", subject: "", stake: "" }), NOW);
    if (result.ok) throw new Error("accepté");
    expect(result.errors.map((error) => error.field)).toEqual([
      "bettor",
      "opponent",
      "subject",
      "stake",
    ]);
  });

  it.each([
    ["Théo", "théo"],
    ["THÉO", "théo"],
    ["Théo", "Théo"],
    ["Théo", `Théo${ZWSP}`],
  ])("CL-4 · « %s » / « %s » → erreur sur le contre-parieur", (bettor, opponent) => {
    const result = validateDraft(draft({ bettor, opponent }), NOW);
    if (result.ok) throw new Error("accepté");
    expect(result.errors).toEqual([{ field: "opponent", index: 0, code: "same-names" }]);
  });

  it.each([
    ["hier", NOW - DAY, "past-date"],
    ["maintenant", NOW, "past-date"],
    ["dans 10 ans et 1 jour", NOW + 3654 * DAY, "too-far"],
    ["vide", null, "missing-date"],
  ] as const)("CL-5 · échéance %s → erreur sur l'échéance", (_label, deadline, code) => {
    const result = validateDraft(draft({ deadline }), NOW);
    if (result.ok) throw new Error("accepté");
    expect(result.errors).toEqual([{ field: "deadline", index: 0, code }]);
  });

  it("CL-5 · échéance dans 1 ms : acceptée", () => {
    expect(validateDraft(draft({ deadline: NOW + 1 }), NOW).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// CA-4 · compte à rebours
// ---------------------------------------------------------------------------------------------

describe("CA-4 · compte à rebours", () => {
  it("CA-4 · jours, heures, min, sec", () => {
    const remaining = countdown(NOW + 3 * DAY + 4 * HOUR + 5 * MINUTE + 6 * SECOND, NOW);
    if (remaining.passed) throw new Error("passé");
    expect(stubs(remaining).map((stub) => `${stub.value} ${stub.unit}`)).toEqual([
      "03 jours",
      "04 heures",
      "05 min",
      "06 sec",
    ]);
  });

  it("CA-4 · bascule pile à l'échéance, jamais « 00 sec » avant", () => {
    const deadline = NOW + 1500;
    const before = countdown(deadline, deadline - 1);
    if (before.passed) throw new Error("passé trop tôt");
    expect(stubs(before).map((stub) => stub.value)).toEqual(["00", "00", "00", "01"]);
    expect(countdown(deadline, deadline).passed).toBe(true);
    expect(countdown(deadline, deadline + DAY).passed).toBe(true);
  });

  it("CA-4 · 10 ans : 3652 jours affichés en entier", () => {
    const remaining = countdown(NOW + 3652 * DAY, NOW);
    if (remaining.passed) throw new Error("passé");
    expect(stubs(remaining)[0]?.value).toBe("3652");
  });

  it("CA-4 · message d'échéance de la spec, et résumé accessible lisible", () => {
    expect(TEXT.passed).toBe("Échéance passée. Le tribunal des potes attend votre verdict.");
    expect(spokenCountdown(countdown(NOW + DAY + 2 * MINUTE, NOW), TEXT.passed)).toBe(
      "Échéance dans 1 jour et 2 minutes.",
    );
    expect(spokenCountdown(countdown(NOW, NOW), TEXT.passed)).toBe(TEXT.passed);
  });

  it("CA-4 · recalculé depuis l'heure : faux minuteurs, 90 s plus tard, l'affichage est juste", () => {
    vi.useFakeTimers({ now: NOW });
    const deadline = NOW + 2 * MINUTE;
    vi.advanceTimersByTime(90 * SECOND);
    const remaining = countdown(deadline, Date.now());
    if (remaining.passed) throw new Error("passé");
    expect(stubs(remaining).map((stub) => stub.value)).toEqual(["00", "00", "00", "30"]);
  });
});

// ---------------------------------------------------------------------------------------------
// Signatures, textes de la spec
// ---------------------------------------------------------------------------------------------

describe("Signatures et textes fixes", () => {
  it("même nom → même gribouillis ; autre nom → autre tracé ; jamais le nom dans le tracé", () => {
    const names = ["Théo", "théo", "Inès", "<script>", "🎉", "W".repeat(40), "a", "b"];
    const paths = names.map(signaturePath);
    expect(new Set(paths).size).toBe(names.length);
    for (const [index, name] of names.entries()) {
      expect(signaturePath(name)).toBe(paths[index]);
      expect(paths[index]).toMatch(/^[MCQ0-9. ]+$/u);
    }
  });

  it("textes de la spec, au mot près", () => {
    expect(TEXT.footer).toBe("Acte sans aucune valeur juridique. Juré, craché.");
    expect(TEXT.verdictNote).toBe(
      "Verdict déclaré par la personne qui a envoyé ce lien. En cas de litige, le tribunal des potes statue en dernier ressort.",
    );
    expect(TEXT.winnerStamp).toBe("VAINQUEUR");
    expect(TEXT.drawStamp).toBe("MATCH NUL");
    expect(TEXT.seal).toBe("Sceller l'acte");
    expect(TEXT.copy).toBe("Copier le lien de l'acte");
    expect(TEXT.print).toBe("Imprimer");
    expect(TEXT.declare).toBe("Déclarer le vainqueur");
    expect(TEXT.unreadableTitle).toBe("Acte illisible");
    expect(TEXT.restart).toBe("Rédiger un nouvel acte");
    expect(TEXT.unknownVersionTitle).toBe("Acte d'une version inconnue");
    expect(TEXT.sealRing).toContain("PAS DU TOUT LÉGAL · MAIS TRÈS SÉRIEUX");
  });
});
