// Tests de la logique pure du Réunion-mètre écrits par l'agent tester (specs/reunion-metre.md).
// Ils complètent ceux du builder par des balayages exhaustifs et des entrées tirées au hasard
// (graine fixe : un échec se rejoue à l'identique).
import { describe, expect, it } from "vitest";
import { formatEuros, ghostDigits, ledAmount } from "./format";
import { buildQuery, parseLink } from "./link";
import { LIMITS, TARIFFS, TARIFF_CODES, screenOf, type Meeting } from "./meeting";
import { costCents, elapsed, receiptLines, splitCost } from "./meter";

const NOW_MS = Date.UTC(2026, 9, 14, 8, 0, 0);
const NOW = NOW_MS / 1000;

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const ALPHABET = [
  ..."abcXYZ 0123456789|&=+#%?/<>\"'«»éÉàç",
  String.fromCodePoint(0xa0),
  String.fromCodePoint(0x1f389),
  String.fromCodePoint(0x645),
  String.fromCodePoint(0x5d0),
];

function randomLabel(next: () => number, max: number): string {
  const length = 1 + Math.floor(next() * max);
  let label = "";
  for (let index = 0; index < length; index += 1) {
    label += ALPHABET[Math.floor(next() * ALPHABET.length)] ?? "a";
  }
  // Un libellé valide ne commence ni ne finit par une espace (trim) et n'est pas vide.
  return [...`K${label.trim()}`].slice(0, max - 1).join("") + "K";
}

describe("Calcul · tester", () => {
  it("CA-6 · somme des 4 lignes = total, aucune ligne négative, pour tout total de 0 à 200 000 centimes", () => {
    for (let total = 0; total <= 200_000; total += 1) {
      const lines = splitCost(total);
      expect(lines).toHaveLength(4);
      const sum = lines.reduce((accumulator, line) => accumulator + line.cents, 0);
      if (sum !== total || lines.some((line) => line.cents < 0)) {
        throw new Error(`total ${total} : ${JSON.stringify(lines)}`);
      }
    }
  });

  it("CA-6 · chaque ligne reste à moins d'un centime de sa part exacte (sauf la dernière, qui prend le reste)", () => {
    const percents = [32, 14, 28, 26];
    for (let total = 0; total <= 50_000; total += 7) {
      const lines = splitCost(total);
      lines.slice(0, 3).forEach((line, index) => {
        const exact = (total * (percents[index] ?? 0)) / 100;
        expect(Math.abs(line.cents - exact)).toBeLessThan(1);
      });
      // Le reste d'arrondi ne dépasse jamais 3 centimes.
      const lastExact = (total * 26) / 100;
      expect(Math.abs((lines[3]?.cents ?? 0) - lastExact)).toBeLessThan(3);
    }
  });

  it("CA-6 · « Café tiède × N » vaut toujours 0", () => {
    for (const count of [1, 2, 30]) {
      expect(receiptLines(count, 12_345)[0]?.cents).toBe(0);
    }
  });

  it("coût : arrondi au centime de durée / 3600 × Σ taux × multiplicateur, tiré au hasard", () => {
    const next = random(42);
    for (let draw = 0; draw < 20_000; draw += 1) {
      const seconds = Math.floor(next() * (LIMITS.maxDuration + 1));
      const count = 1 + Math.floor(next() * LIMITS.maxParticipants);
      const participants = Array.from({ length: count }, () => ({
        rate: Math.floor(next() * (LIMITS.maxRate + 1)),
        label: "x",
      }));
      const tariff = TARIFF_CODES[Math.floor(next() * 3)] ?? "A";
      const sum = participants.reduce((total, participant) => total + participant.rate, 0);
      // Calcul exact en entiers : centimes × 7200 = secondes × Σ × demis × 100.
      const numerator = seconds * sum * TARIFFS[tariff].halves * 100;
      const expected = Math.floor((numerator + 3600) / 7200);
      expect(costCents(seconds, participants, tariff)).toBe(expected);
    }
  });

  it("CL-2 · durée bornée à 24 h, jamais négative", () => {
    const base: Meeting = {
      tariff: "A",
      participants: [{ rate: 10, label: "x" }],
      title: "",
      start: NOW,
      end: null,
    };
    expect(elapsed(base, (NOW - 59) * 1000).seconds).toBe(0);
    expect(elapsed(base, (NOW + LIMITS.maxDuration + 1) * 1000)).toEqual({
      seconds: LIMITS.maxDuration,
      capped: true,
    });
    expect(elapsed(base, (NOW + LIMITS.maxDuration) * 1000)).toEqual({
      seconds: LIMITS.maxDuration,
      capped: false,
    });
  });
});

describe("Afficheur · tester", () => {
  it("CA-9 · fantômes : même nombre de caractères, un 8 sous chaque chiffre, le reste intact", () => {
    for (const cents of [0, 1, 99, 100, 99_999, 100_000, 144_000_000]) {
      const amount = ledAmount(cents);
      const ghost = ghostDigits(amount);
      expect([...ghost]).toHaveLength([...amount].length);
      [...amount].forEach((char, index) => {
        expect([...ghost][index]).toBe(/\d/u.test(char) ? "8" : char);
      });
    }
  });

  it("montants du ticket : exactement Intl.NumberFormat fr-FR EUR", () => {
    const intl = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
    for (const cents of [0, 5, 12_345, 144_000_000]) {
      expect(formatEuros(cents)).toBe(intl.format(cents / 100));
    }
  });
});

describe("Lien · tester", () => {
  it("parseLink ne lève jamais d'exception sur 20 000 queries hostiles tirées au hasard", () => {
    const next = random(7);
    const pieces = [
      "v=1",
      "v=2",
      "t=A",
      "t=C",
      "t=",
      "p=",
      "p=10|",
      "p=10|K",
      "p=1e3|K",
      "p=-1|K",
      "s=",
      `s=${NOW}`,
      `s=${NOW + 61}`,
      "s=abc",
      "e=",
      `e=${NOW + 1}`,
      "n=",
      "n=%00",
      "%",
      "%E2%80%AE",
      "%ZZ",
      "&",
      "=",
      "|",
      "#",
      "?",
      "%F0%9F",
    ];
    for (let draw = 0; draw < 20_000; draw += 1) {
      const count = Math.floor(next() * 12);
      const parts = Array.from(
        { length: count },
        () => pieces[Math.floor(next() * pieces.length)] ?? "",
      );
      const search = `?${parts.join(next() < 0.5 ? "&" : "")}`;
      const parsed = parseLink(search, NOW_MS);
      expect(["setup", "meter", "ticket"]).toContain(screenOf(parsed.meeting));
      expect(parsed.meeting.participants.length).toBeGreaterThan(0);
      expect(parsed.meeting.participants.length).toBeLessThanOrEqual(LIMITS.maxParticipants);
    }
  });

  it("CA-2 · aller-retour buildQuery → parseLink sur 2 000 réunions tirées au hasard", () => {
    const next = random(2026);
    for (let draw = 0; draw < 2000; draw += 1) {
      const count = 1 + Math.floor(next() * 6);
      // Fin toujours passée : un e plus de 60 s dans le futur est ignoré (spec, CL-3).
      const start = NOW - 3601 - Math.floor(next() * 1000);
      const meeting: Meeting = {
        tariff: TARIFF_CODES[Math.floor(next() * 3)] ?? "A",
        participants: Array.from({ length: count }, () => ({
          rate: Math.floor(next() * 1001),
          label: randomLabel(next, LIMITS.labelMax),
        })),
        title: next() < 0.3 ? "" : randomLabel(next, LIMITS.titleMax),
        start,
        end: next() < 0.5 ? null : start + 1 + Math.floor(next() * 3600),
      };
      const parsed = parseLink(buildQuery(meeting), NOW_MS);
      expect(parsed.notices).toEqual([]);
      expect(parsed.meeting).toEqual(meeting);
    }
  });

  it("modèle de menace · aucun caractère de contrôle ni bidi ne survit dans un libellé ou un titre", () => {
    const forbidden = [
      ...Array.from({ length: 0x20 }, (_, code) => code),
      ...Array.from({ length: 0x21 }, (_, offset) => 0x7f + offset),
      0x200e,
      0x200f,
      0x202a,
      0x202b,
      0x202c,
      0x202d,
      0x202e,
      0x2066,
      0x2067,
      0x2068,
      0x2069,
    ];
    for (const code of forbidden) {
      const char = encodeURIComponent(String.fromCodePoint(code));
      const parsed = parseLink(`?v=1&p=5|Ke${char}vin&s=${NOW - 60}&n=Ti${char}tre`, NOW_MS);
      expect(parsed.meeting.participants[0]?.label, `U+${code.toString(16)}`).toBe("Kevin");
      expect(parsed.meeting.title, `U+${code.toString(16)}`).toBe("Titre");
    }
  });

  it("CL-5 · libellé de 40 caractères + 20 marques bidi : nettoyé puis accepté (borne après nettoyage)", () => {
    const rlo = encodeURIComponent(String.fromCodePoint(0x202e)).repeat(20);
    const parsed = parseLink(`?v=1&p=5|${"K".repeat(40)}${rlo}&s=${NOW - 60}`, NOW_MS);
    expect(parsed.meeting.participants[0]?.label).toBe("K".repeat(40));
    expect(screenOf(parsed.meeting)).toBe("meter");
  });
});

// Tour 3 : décisions de l'orchestrateur après le tour 2 (spec, « Écrans », CL-3, Modèle de menace).
describe("Lien · tester · tour 3", () => {
  const TEAM = "p=68|Cheffe%20de%20projet&p=48|Kevin";
  const codes = (search: string) => parseLink(search, NOW_MS).notices.map((notice) => notice.code);

  it.each(["v=2", "v=99", "v=0", "v=abc", "v=", "v=2&v=1"])(
    "version inconnue (%s) : Configuration, message, et pas de forme propre (l'adresse reste)",
    (version) => {
      const parsed = parseLink(`?${version}&t=C&${TEAM}&s=${NOW - 600}#x`, NOW_MS);
      expect(screenOf(parsed.meeting)).toBe("setup");
      expect(parsed.notices.map((notice) => notice.code)).toEqual(["unknown-version"]);
      expect(parsed.query).toBeNull();
    },
  );

  it("v=1 : la forme propre est bien produite (contrôle)", () => {
    expect(parseLink(`?v=1&t=C&${TEAM}&s=${NOW - 600}&w=1`, NOW_MS).query).toBe(
      `?v=1&t=C&${TEAM}&s=${NOW - 600}`,
    );
  });

  it("forme propre de plus de 4 Ko (NFC qui décompose U+0958) : refusée comme trop long", () => {
    const label = encodeURIComponent(String.fromCodePoint(0x0958).repeat(14));
    const team = Array.from({ length: 30 }, () => `p=1|${label}`).join("&");
    const search = `?v=1&t=B&${team}&s=${NOW - 600}`;
    expect(search.length).toBeLessThanOrEqual(4097);
    const parsed = parseLink(search, NOW_MS);
    expect(parsed.notices.map((notice) => notice.code)).toEqual(["too-long"]);
    expect(screenOf(parsed.meeting)).toBe("setup");
    expect(parsed.query?.length ?? 0).toBeLessThanOrEqual(4096);
  });

  it("forme propre sous 4 Ko : jamais refusée, et toujours ≤ 4 Ko (balayage de 30 × n « %FF »)", () => {
    for (let count = 1; count <= 40; count += 1) {
      const team = Array.from({ length: 30 }, (_, index) => `p=${index}|${"%FF".repeat(count)}`);
      const search = `?v=1&t=B&${team.join("&")}&s=${NOW - 600}`;
      if (search.length > 4097) break;
      const parsed = parseLink(search, NOW_MS);
      expect(parsed.query?.length ?? 0, `${count} × %FF`).toBeLessThanOrEqual(4096);
    }
  });

  it.each([
    ["e sans s", `e=${NOW - 60}`],
    ["e avec s illisible", `s=demain&e=${NOW - 60}`],
    ["e avec s avant 2020", "s=1500000000&e=1500000600"],
  ])("CL-3 · %s : e ignoré avec message, Configuration, e hors du lien", (_label, tail) => {
    const parsed = parseLink(`?v=1&t=B&${TEAM}&${tail}`, NOW_MS);
    expect(screenOf(parsed.meeting)).toBe("setup");
    expect(parsed.notices.length).toBeGreaterThan(0);
    expect(new URLSearchParams(parsed.query ?? "").has("e")).toBe(false);
  });

  it("CL-3 · contrôle : sans e ni s, aucun message", () => {
    expect(codes(`?v=1&t=B&${TEAM}`)).toEqual([]);
  });

  it("zalgo : plus de 4 marques consécutives réduites à 4, forme propre stable", () => {
    const marks = String.fromCodePoint(
      ...Array.from({ length: 30 }, (_, k) => 0x0300 + (k % 0x30)),
    );
    const label = encodeURIComponent(`Kev${marks}in`);
    const first = parseLink(`?v=1&t=B&p=10|${label}&s=${NOW - 600}`, NOW_MS);
    const shown = first.meeting.participants[0]?.label ?? "";
    expect(shown.startsWith("Kev")).toBe(true);
    expect(shown.endsWith("in")).toBe(true);
    expect([...shown].filter((char) => /\p{M}/u.test(char)).length).toBeLessThanOrEqual(4);
    const second = parseLink(first.query ?? "", NOW_MS);
    expect(second.query).toBe(first.query);
    expect(second.notices).toEqual([]);
  });

  it.each([
    ["vietnamien décomposé", "Nguyễn Thị Ánh"],
    ["thaï", "ผู้จัดการฝ่ายบัญชี"],
    ["devanagari", "क्षत्रिय प्रबंधक"],
    ["emoji keycap", "Salle 1️⃣ #️⃣"],
  ])("%s : intact à la NFC près", (_label, text) => {
    const parsed = parseLink(`?v=1&t=B&p=10|${encodeURIComponent(text)}&s=${NOW - 600}`, NOW_MS);
    expect(parsed.meeting.participants[0]?.label).toBe(text.normalize("NFC"));
  });

  it("ordre retrait → NFC → trim : « e » + RLO + U+0301 donne « é » composé ; bidi en bord retiré puis trim", () => {
    const rlo = encodeURIComponent(String.fromCodePoint(0x202e));
    const parsed = parseLink(
      `?v=1&t=B&p=10|Rene${rlo}%CC%81&p=20|%20${rlo}%20Kevin%20${rlo}%20&s=${NOW - 600}`,
      NOW_MS,
    );
    expect(parsed.meeting.participants.map((participant) => participant.label)).toEqual([
      "René",
      "Kevin",
    ]);
  });

  it("U+FFFC seul : libellé refusé comme invisible", () => {
    const parsed = parseLink(`?v=1&t=B&${TEAM}&p=9|%EF%BF%BC%EF%BF%BC&s=${NOW - 600}`, NOW_MS);
    expect(parsed.meeting.participants).toHaveLength(2);
    expect(parsed.notices.length).toBeGreaterThan(0);
  });
});
