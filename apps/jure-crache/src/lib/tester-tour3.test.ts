// Tests unitaires du tour 3 (agent tester), écrits à partir de la spec mise à jour après le
// tour 2 (specs/jure-crache.md) : numéro sur 128 bits en base32 Crockford (ligne 49), « 1er »
// pour le premier du mois (« Décisions prises »), CL-9 (acte dans les bornes dont le lien
// dépasserait 4 Ko).
//
// Le numéro est vérifié contre un troisième calcul, indépendant de seal.ts et de l'oracle du
// builder (tests/e2e/support/crockford.ts) : chaîne de bits, puis tranches de 5. Cet oracle est
// lui-même ancré sur les vecteurs de la RFC 4648 (section 10), traduits dans l'alphabet de
// Crockford : on vérifie ainsi que la modification de nos tests par le builder (oracle partagé)
// mesure bien ce que dit la spec.
import { createHash, webcrypto } from "node:crypto";
import LZString from "lz-string";
import { describe, expect, it } from "vitest";
import { expectedDeedNumber, crockfordOfHex } from "../../../../tests/e2e/support/crockford";
import { canonicalJson, type Deed } from "./deed";
import { DEFAULT_ARTICLES, deadlineAt, validateDraft, type Draft } from "./draft";
import { formatDate, formatDateTime } from "./format";
import { buildHash, parseHash, VERDICTS } from "./link";
import { crockfordBase32, deedNumber, fingerprint, numberSegments, type Digest } from "./seal";

/** Mercredi 14 octobre 2026, 10:00 à Paris. */
const NOW = Date.UTC(2026, 9, 14, 8, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NBSP = String.fromCodePoint(0xa0);
const nodeDigest: Digest = (data) => webcrypto.subtle.digest("SHA-256", data);

// ---------------------------------------------------------------------------------------------
// Oracle indépendant du base32 Crockford
// ---------------------------------------------------------------------------------------------

const RFC4648 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** Alphabet de Crockford, recopié de sa définition : 0-9 puis A-Z sans I, L, O, U. */
const CROCKFORD = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
  .filter((char) => !"ILOU".includes(char))
  .join("");

/** Bits de poids fort d'abord, complétés de zéros jusqu'à un multiple de 5, par tranches de 5. */
function bitStringCrockford(hex: string): string {
  const bits = [...hex].map((digit) => parseInt(digit, 16).toString(2).padStart(4, "0")).join("");
  const padded = bits.padEnd(Math.ceil(bits.length / 5) * 5, "0");
  return (padded.match(/.{5}/gu) ?? []).map((chunk) => CROCKFORD[parseInt(chunk, 2)]).join("");
}

function hexOfText(text: string): string {
  return Buffer.from(text, "utf8").toString("hex");
}

/** Base32 de la RFC 4648 (sans « = ») réécrit dans l'alphabet de Crockford, chiffre à chiffre. */
function rfcToCrockford(rfc: string): string {
  return [...rfc.replace(/=+$/u, "")].map((char) => CROCKFORD[RFC4648.indexOf(char)]).join("");
}

/** Numéro attendu d'après la spec, ligne 49, calculé par l'oracle indépendant. */
function specNumber(fingerprintHex: string, draftedAt: number): string {
  const code = bitStringCrockford(fingerprintHex.slice(0, 32));
  const groups = code.match(/.{1,4}/gu) ?? [];
  return `N°${NBSP}${new Date(draftedAt).getUTCFullYear()}-${groups.join("-")}`;
}

/** Empreintes SHA-256 variées (déterministes). */
const FINGERPRINTS = Array.from({ length: 200 }, (_, index) =>
  createHash("sha256").update(`acte ${index}`, "utf8").digest("hex"),
);

describe("CA-3 · tour 3 · oracle base32 Crockford ancré sur la RFC 4648", () => {
  const RFC_VECTORS = [
    ["f", "MY======"],
    ["fo", "MZXQ===="],
    ["foo", "MZXW6==="],
    ["foob", "MZXW6YQ="],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI======"],
  ] as const;

  it("CA-3 · l'alphabet de Crockford a 32 caractères, sans I, L, O, U", () => {
    expect(CROCKFORD).toHaveLength(32);
    expect(CROCKFORD).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
  });

  it.each(RFC_VECTORS)(
    "CA-3 · oracle indépendant : « %s » → %s (RFC 4648) traduit",
    (text, rfc) => {
      expect(bitStringCrockford(hexOfText(text))).toBe(rfcToCrockford(rfc));
    },
  );

  it.each(RFC_VECTORS)(
    "CA-3 · crockfordBase32 (app) et l'oracle du builder : « %s » → %s traduit",
    (text, rfc) => {
      expect(crockfordBase32(new Uint8Array(Buffer.from(text, "utf8")))).toBe(rfcToCrockford(rfc));
      expect(crockfordOfHex(hexOfText(text))).toBe(rfcToCrockford(rfc));
    },
  );

  it("CA-3 · bornes : 128 bits à zéro → 26 « 0 » ; 128 bits à un → 25 « Z » puis « W » (3 bits + 2 zéros)", () => {
    expect(bitStringCrockford("0".repeat(32))).toBe("0".repeat(26));
    expect(bitStringCrockford("f".repeat(32))).toBe(`${"Z".repeat(25)}W`);
    expect(crockfordBase32(new Uint8Array(16).fill(0xff))).toBe(`${"Z".repeat(25)}W`);
  });

  it("CA-3 · l'oracle du builder (tests/e2e/support) concorde avec l'oracle indépendant sur 200 empreintes", () => {
    for (const hex of FINGERPRINTS) {
      expect(expectedDeedNumber(hex, NOW)).toBe(specNumber(hex, NOW));
    }
  });
});

describe("CA-3 · tour 3 · numéro N° AAAA- + 26 caractères base32 Crockford par 4 (spec ligne 49)", () => {
  it("CA-3 · deedNumber concorde avec l'oracle indépendant sur 200 empreintes", () => {
    for (const hex of FINGERPRINTS) {
      expect(deedNumber(hex, NOW)).toBe(specNumber(hex, NOW));
    }
  });

  it("CA-3 · forme : 6 groupes de 4 puis 1 de 2, alphabet sans I L O U, dernier caractère multiple de 4", () => {
    for (const hex of FINGERPRINTS) {
      const shown = deedNumber(hex, NOW);
      const [prefix, ...groups] = shown.split("-");
      expect(prefix).toBe(`N°${NBSP}2026`);
      expect(groups.map((group) => group.length)).toEqual([4, 4, 4, 4, 4, 4, 2]);
      const code = groups.join("");
      expect(code).toHaveLength(26);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
      // 128 = 25 × 5 + 3 : le 26e caractère porte 3 bits suivis de 2 zéros.
      expect(CROCKFORD.indexOf(code.charAt(25)) % 4).toBe(0);
    }
  });

  it("CA-3 · le numéro n'utilise que les 128 premiers bits : changer le 129e bit ne le change pas, le 128e oui", () => {
    const base = FINGERPRINTS[0] ?? "";
    const flip = (hex: string, nibble: number, mask: number) =>
      hex.slice(0, nibble) +
      (parseInt(hex.charAt(nibble), 16) ^ mask).toString(16) +
      hex.slice(nibble + 1);
    // Bit 129 : poids fort du 33e chiffre hexadécimal. Bit 128 : poids faible du 32e.
    expect(deedNumber(flip(base, 32, 8), NOW)).toBe(deedNumber(base, NOW));
    expect(deedNumber(flip(base, 31, 1), NOW)).not.toBe(deedNumber(base, NOW));
    // Bit 1 : poids fort du 1er chiffre.
    expect(deedNumber(flip(base, 0, 8), NOW)).not.toBe(deedNumber(base, NOW));
  });

  it("CA-3 · empreinte en majuscules ou minuscules : même numéro (aucune casse ne fuit)", () => {
    const hex = FINGERPRINTS[1] ?? "";
    expect(deedNumber(hex.toUpperCase(), NOW)).toBe(deedNumber(hex, NOW));
  });

  it("CA-3 · bout en bout : acte → JSON canonique → SHA-256 (node:crypto) → numéro", async () => {
    const deed: Deed = {
      bettor: "Théo",
      opponent: "Inès",
      subject: "Kevin arrivera en retard.",
      stake: "Un kebab.",
      articles: ["Retard constaté au-delà de dix minutes."],
      deadline: NOW + 3 * DAY,
      draftedAt: NOW - 2 * HOUR,
    };
    const hex = createHash("sha256").update(canonicalJson(deed), "utf8").digest("hex");
    expect(deedNumber(await fingerprint(deed, nodeDigest), deed.draftedAt)).toBe(
      specNumber(hex, deed.draftedAt),
    );
  });

  it("CA-11 · morceaux du numéro : rien de perdu ni d'ajouté, chaque coupure juste après un tiret", () => {
    for (const hex of FINGERPRINTS.slice(0, 20)) {
      const shown = deedNumber(hex, NOW);
      const segments = numberSegments(shown);
      expect(segments.join("")).toBe(shown);
      expect(segments).toHaveLength(8);
      expect(segments[0]).toBe(`N°${NBSP}2026-`);
      for (const segment of segments.slice(1, -1)) expect(segment).toMatch(/^[0-9A-Z]{4}-$/u);
      expect(segments.at(-1)).toMatch(/^[0-9A-Z]{2}$/u);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// « 1er » pour le premier du mois
// ---------------------------------------------------------------------------------------------

describe("Dates · « 1er » pour le premier du mois (spec, « Décisions prises »)", () => {
  const PARIS = "Europe/Paris";

  it.each([
    [Date.UTC(2027, 0, 1, 12), "1er janvier 2027"],
    [Date.UTC(2026, 10, 1, 12), "1er novembre 2026"],
    [Date.UTC(2026, 9, 11, 12), "11 octobre 2026"],
    [Date.UTC(2026, 9, 21, 12), "21 octobre 2026"],
    [Date.UTC(2026, 9, 31, 12), "31 octobre 2026"],
    [Date.UTC(2026, 9, 10, 12), "10 octobre 2026"],
    [Date.UTC(2026, 9, 2, 12), "2 octobre 2026"],
  ])("formatDate(%i) → « %s »", (ms, expected) => {
    expect(formatDate(ms, PARIS)).toBe(expected);
  });

  it.each([
    [Date.UTC(2026, 10, 1, 19), "1er novembre 2026 à 20:00"],
    [Date.UTC(2026, 11, 1, 0, 5), "1er décembre 2026 à 01:05"],
    [Date.UTC(2026, 9, 11, 18), "11 octobre 2026 à 20:00"],
    [Date.UTC(2026, 9, 21, 18), "21 octobre 2026 à 20:00"],
    [Date.UTC(2026, 9, 31, 19), "31 octobre 2026 à 20:00"],
    // 1 h du matin le 31 : l'heure « 01 » ne devient jamais « 1er ».
    [Date.UTC(2026, 9, 31, 0), "31 octobre 2026 à 01:00"],
  ])("formatDateTime(%i) → « %s »", (ms, expected) => {
    expect(formatDateTime(ms, PARIS)).toBe(expected);
  });

  it("le même instant : « 1er novembre » à Paris, « 31 octobre » à New York (fuseau de l'appareil)", () => {
    const instant = Date.UTC(2026, 9, 31, 23, 30);
    expect(formatDateTime(instant, PARIS)).toBe("1er novembre 2026 à 00:30");
    expect(formatDateTime(instant, "America/New_York")).toBe("31 octobre 2026 à 19:30");
    expect(formatDate(instant, "Pacific/Kiritimati")).toBe("1er novembre 2026");
  });

  it(
    "aucun « 11er », « 21er », « 31er » ni « 01er » sur une année entière, heure par heure",
    { timeout: 60_000 },
    () => {
      for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += HOUR) {
        const date = formatDate(ms, PARIS);
        const dateTime = formatDateTime(ms, PARIS);
        for (const text of [date, dateTime]) {
          expect(text).not.toMatch(
            /\d1er|01er|\b1 (?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)/u,
          );
        }
        const day = Number(
          new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: PARIS }).format(ms),
        );
        expect(date.startsWith(day === 1 ? "1er " : `${day} `)).toBe(true);
        expect(dateTime.startsWith(day === 1 ? "1er " : `${day} `)).toBe(true);
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
// CL-9 · acte dans les bornes dont le lien dépasserait 4 Ko
// ---------------------------------------------------------------------------------------------

/** Idéogrammes tous différents (BMP ou hors BMP), qui se compressent mal. */
function ideographs(start: number) {
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
  deadline: deadlineAt(NOW + DAY),
  ...changes,
});

/** Taille compressée d'un texte seul, mesurée par lz-string directement (oracle). */
function compressedSize(text: string): number {
  return LZString.compressToEncodedURIComponent(text).length;
}

/** Longueur brute du hash (sans « # ») d'un JSON canonique, avec un suffixe éventuel. */
function rawLength(json: string, suffix = ""): number {
  return `1.${LZString.compressToEncodedURIComponent(json)}${suffix}`.length;
}

function canonicalOf(draft: Draft, deadline: number, now: number): string {
  return JSON.stringify({
    p: draft.bettor,
    c: draft.opponent,
    o: draft.subject,
    e: draft.stake,
    a: draft.articles,
    d: deadline,
    t: now,
  });
}

describe("CL-9 · tour 3 · lien de plus de 4 Ko refusé au formulaire, erreur sur le texte le plus lourd", () => {
  /**
   * L'enjeu (120 idéogrammes hors BMP) est le plus lourd une fois compressé, alors que l'objet
   * (200) et les articles (160) ont plus de caractères : le texte « le plus long » n'est pas
   * celui qu'il faut signaler.
   */
  function stakeHeaviest(): Draft {
    const gen = ideographs(1);
    return draftOf({
      bettor: gen.bmp(40),
      opponent: gen.bmp(40),
      // 200 caractères, le plus long, mais très répétitif : il se compresse en quelques octets.
      subject: "Kevin sera en retard. ".repeat(10).slice(0, 200),
      stake: gen.astral(120),
      articles: [gen.bmp(160), gen.bmp(160), gen.bmp(160), gen.bmp(160), gen.bmp(160)],
    });
  }

  it("CL-9 · le cas d'essai est bien posé : bornes respectées, lien > 4 Ko, l'enjeu nettement le plus lourd", () => {
    const draft = stakeHeaviest();
    expect(rawLength(canonicalOf(draft, NOW + DAY, NOW))).toBeGreaterThan(4096);
    const sizes = [draft.bettor, draft.opponent, draft.subject, draft.stake, ...draft.articles].map(
      compressedSize,
    );
    const stake = sizes[3] ?? 0;
    for (const [index, size] of sizes.entries()) {
      if (index !== 3) expect(size, `texte ${index}`).toBeLessThan(stake * 0.9);
    }
    expect(Array.from(draft.stake).length).toBeLessThan(Array.from(draft.subject).length);
  });

  it("CL-9 · l'erreur porte sur l'enjeu (le plus lourd compressé), pas sur l'objet ni un article (les plus longs)", () => {
    const result = validateDraft(stakeHeaviest(), NOW);
    if (result.ok) throw new Error("acte accepté alors que son lien dépasse 4 Ko");
    expect(result.errors).toEqual([{ field: "stake", index: 0, code: "link-too-long" }]);
  });

  it("CL-9 · l'erreur suit le texte le plus lourd quand il change de place (article 5)", () => {
    const gen = ideographs(1);
    const draft = draftOf({
      bettor: gen.bmp(40),
      opponent: gen.bmp(40),
      subject: gen.bmp(200),
      stake: gen.bmp(120),
      articles: [gen.bmp(160), gen.bmp(160), gen.bmp(160), gen.bmp(160), gen.astral(160)],
    });
    const result = validateDraft(draft, NOW);
    if (result.ok) throw new Error("acte accepté alors que son lien dépasse 4 Ko");
    expect(result.errors).toEqual([{ field: "article", index: 4, code: "link-too-long" }]);
  });

  /**
   * Brouillon dont le hash brut jugé (« 1.<payload>.p ») mesure exactement `target`, obtenu en
   * ajustant la longueur du 4e article et une queue ASCII dans l'enjeu. Les autres textes sont en idéogrammes distincts.
   */
  function draftWithRawLength(target: number): Draft {
    // On part de 150 : la solution est vers 153 (recherche courte, déterministe).
    for (let last = 150; last <= 160; last += 1) {
      const gen = ideographs(1);
      const head = {
        bettor: gen.bmp(40),
        opponent: gen.bmp(40),
        subject: gen.bmp(200),
        articles: [gen.bmp(160), gen.bmp(160), gen.bmp(160), gen.bmp(last)],
      };
      for (let tail = 1; tail <= 120; tail += 1) {
        const draft = draftOf({ ...head, stake: "k".repeat(tail) });
        if (rawLength(canonicalOf(draft, NOW + DAY, NOW), ".p") === target) return draft;
      }
    }
    throw new Error(`aucun brouillon à ${target} caractères bruts`);
  }

  it(
    "CL-9 · lien jugé de 4 096 caractères bruts : accepté, et chaque forme (sans verdict, .p, .c, .n) se relit",
    { timeout: 60_000 },
    () => {
      const draft = draftWithRawLength(4096);
      const result = validateDraft(draft, NOW);
      if (!result.ok) throw new Error(`refusé : ${JSON.stringify(result.errors)}`);
      // « #1.<payload> » : 4 096 − « .p » + « # ».
      expect(buildHash(result.deed, null).length).toBe(4095);
      for (const verdict of [null, ...VERDICTS]) {
        const state = parseHash(buildHash(result.deed, verdict), NOW);
        expect(state.screen, `verdict ${String(verdict)}`).toBe("deed");
      }
    },
  );

  it(
    "CL-9 · lien sans verdict de 4 097 caractères bruts : refusé au formulaire (le lien serait illisible)",
    { timeout: 60_000 },
    () => {
      // 4 097 sans verdict : même la forme non jugée ne se relirait pas.
      const draft = draftWithRawLength(4097 + 2);
      const unjudged = `#1.${LZString.compressToEncodedURIComponent(canonicalOf(draft, NOW + DAY, NOW))}`;
      expect(unjudged.length).toBe(4098);
      expect(parseHash(unjudged, NOW).screen).toBe("unreadable");
      const result = validateDraft(draft, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("link-too-long");
    },
  );

  it(
    "CL-9 · propriété : tout acte accepté par le formulaire se relit, jugé ou non ; tout refus « lien trop long » a un lien jugé > 4 Ko",
    { timeout: 60_000 },
    () => {
      let accepted = 0;
      let refused = 0;
      for (let start = 1; start < 60; start += 1) {
        const gen = ideographs(start * 13);
        for (const articles of [3, 4, 5]) {
          const draft = draftOf({
            bettor: gen.bmp(40),
            opponent: gen.bmp(40),
            subject: gen.bmp(200),
            stake: gen.bmp(120),
            articles: Array.from({ length: articles }, (_, index) =>
              index === articles - 1 ? gen.bmp((start * 7) % 160 || 1) : gen.bmp(160),
            ),
          });
          const result = validateDraft(draft, NOW);
          if (result.ok) {
            accepted += 1;
            for (const verdict of [null, ...VERDICTS]) {
              expect(parseHash(buildHash(result.deed, verdict), NOW).screen).toBe("deed");
            }
          } else {
            refused += 1;
            expect(result.errors.map((error) => error.code)).toEqual(["link-too-long"]);
            expect(rawLength(canonicalOf(draft, NOW + DAY, NOW), ".p")).toBeGreaterThan(4096);
          }
        }
      }
      expect(accepted, "le cas d'essai couvre des actes acceptés").toBeGreaterThan(0);
      expect(refused, "le cas d'essai couvre des refus").toBeGreaterThan(0);
    },
  );
});
