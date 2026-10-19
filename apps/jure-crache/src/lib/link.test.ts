import LZString from "lz-string";
import { describe, expect, it } from "vitest";
import { canonicalJson, type Deed } from "./deed";
import { MAX_DECODED_LENGTH, buildHash, encodeDeed, fitsInLink, parseHash } from "./link";

const T = Date.UTC(2026, 9, 14, 9, 0, 0);
const NOW = T + 60_000;

const DEED: Deed = {
  bettor: "Théo",
  opponent: "Sam",
  subject: "Kevin arrivera en retard à la soirée de samedi.",
  stake: "Un (1) kebab, sauce au choix du gagnant, frites incluses.",
  articles: ["Le retard est constaté au-delà de dix (10) minutes après l'heure convenue."],
  deadline: Date.UTC(2026, 9, 17, 18, 0, 0),
  draftedAt: T,
};

/** Hash d'un JSON quelconque, compressé comme le ferait l'app. */
const hashOf = (json: string, suffix = "") =>
  `#1.${LZString.compressToEncodedURIComponent(json)}${suffix}`;

describe("buildHash / parseHash · aller-retour", () => {
  it("CA-2 · un acte scellé se relit à l'identique, verdict compris", () => {
    for (const verdict of [null, "p", "c", "n"] as const) {
      const hash = buildHash(DEED, verdict);
      expect(hash).toMatch(/^#1\.[A-Za-z0-9+$-]+(\.[pcn])?$/u);
      const state = parseHash(hash, NOW);
      expect(state).toEqual({ screen: "deed", deed: DEED, verdict, notices: [], hash });
    }
  });

  it("format exact : #1.<LZString.compressToEncodedURIComponent(JSON canonique)>.p", () => {
    expect(buildHash(DEED, "p")).toBe(
      `#1.${LZString.compressToEncodedURIComponent(canonicalJson(DEED))}.p`,
    );
    expect(LZString.decompressFromEncodedURIComponent(encodeDeed(DEED))).toBe(canonicalJson(DEED));
  });

  it("forme propre : un acte aux textes à nettoyer revient sous sa forme nettoyée", () => {
    const dirty = canonicalJson({ ...DEED, bettor: `  Th${String.fromCodePoint(0x202e)}éo ` });
    const state = parseHash(hashOf(dirty), NOW);
    expect(state.screen === "deed" && state.hash).toBe(buildHash(DEED, null));
  });

  it("le « # » de tête est facultatif", () => {
    expect(parseHash(buildHash(DEED, null).slice(1), NOW).screen).toBe("deed");
  });
});

describe("CL-1 · hash vide, version inconnue, verdict inconnu", () => {
  it("pas de hash, « # », « #1 », « #1. », « #1..p » → Rédaction", () => {
    for (const hash of ["", "#", "#1", "#1.", "#1..p"]) {
      expect(parseHash(hash, NOW), hash).toEqual({ screen: "draft" });
    }
  });

  it("#2.xxx, #0.xxx, #10.xxx, #2 → « Acte d'une version inconnue »", () => {
    for (const hash of ["#2.xxx", "#0.abc", "#10.abc", "#2", `#2.${encodeDeed(DEED)}`]) {
      expect(parseHash(hash, NOW), hash).toEqual({ screen: "unknown-version" });
    }
  });

  it("#1.xxx.z → acte sans verdict, avec un message", () => {
    const payload = encodeDeed(DEED);
    for (const suffix of [".z", ".P", ".", ".p.c", ".pp", ".null"]) {
      const state = parseHash(`#1.${payload}${suffix}`, NOW);
      expect(state, suffix).toEqual({
        screen: "deed",
        deed: DEED,
        verdict: null,
        notices: ["unknown-verdict"],
        hash: buildHash(DEED, null),
      });
    }
  });

  it("version ou payload illisible → « Acte illisible »", () => {
    for (const hash of ["#abc", "#v1.abc", "#1.abc%20def", "#1.ab cd", "#1.<script>", "#-1.abc"]) {
      expect(parseHash(hash, NOW), hash).toEqual({ screen: "unreadable", reason: "format" });
    }
  });
});

describe("CL-2 · payloads hostiles", () => {
  it('lz-string qui renvoie null ou "" → illisible', () => {
    for (const payload of ["xxx", "A", "AAAA"]) {
      expect(parseHash(`#1.${payload}`, NOW)).toEqual({
        screen: "unreadable",
        reason: "decompress",
      });
    }
  });

  it("JSON invalide → illisible", () => {
    for (const text of ["{", "pas du json", "{'p':1}", "undefined"]) {
      expect(parseHash(hashOf(text), NOW)).toEqual({ screen: "unreadable", reason: "json" });
    }
  });

  it("tableau, nombre, null, chaîne → illisible", () => {
    for (const text of ["[]", `[${canonicalJson(DEED)}]`, "42", "null", '"acte"', "true"]) {
      expect(parseHash(hashOf(text), NOW)).toEqual({
        screen: "unreadable",
        reason: "not-object",
      });
    }
  });

  it("objet avec __proto__ → illisible, sans pollution", () => {
    const json = canonicalJson(DEED).replace("{", '{"__proto__":{"polluted":"oui"},');
    expect(parseHash(hashOf(json), NOW)).toEqual({ screen: "unreadable", reason: "unknown-key" });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("clé inconnue ou manquante → illisible", () => {
    const extra = canonicalJson(DEED).replace("{", '{"v":1,');
    expect(parseHash(hashOf(extra), NOW)).toEqual({ screen: "unreadable", reason: "unknown-key" });
    const missing = JSON.stringify({ p: "Théo", c: "Sam", o: "x", e: "y", a: [], d: T + 1 });
    expect(parseHash(hashOf(missing), NOW)).toEqual({
      screen: "unreadable",
      reason: "missing-key",
    });
  });

  it("CL-4 · noms identiques dans le lien → illisible", () => {
    const json = canonicalJson({ ...DEED, opponent: "théo" });
    expect(parseHash(hashOf(json), NOW)).toEqual({ screen: "unreadable", reason: "same-names" });
  });
});

describe("tailles : 4 Ko bruts, 4 Ko décodés (unités UTF-16)", () => {
  it("hash brut de plus de 4 Ko → refusé avant tout décodage", () => {
    expect(parseHash(`#1.${"A".repeat(4095)}`, NOW)).toEqual({
      screen: "unreadable",
      reason: "too-long",
    });
    // 4096 caractères après le « # » : encore lu (ici, illisible pour une autre raison).
    expect(parseHash(`#1.${"A".repeat(4094)}`, NOW).screen).toBe("unreadable");
    expect(parseHash(`#1.${"A".repeat(4094)}`, NOW)).not.toEqual({
      screen: "unreadable",
      reason: "too-long",
    });
  });

  it("payload décompressé de plus de 4 Ko → illisible (bombe de décompression comprise)", () => {
    // Quelques centaines de caractères qui se décompressent en 200 000.
    const bomb = LZString.compressToEncodedURIComponent("a".repeat(200_000));
    expect(bomb.length).toBeLessThan(4096);
    const started = performance.now();
    expect(parseHash(`#1.${bomb}`, NOW)).toEqual({
      screen: "unreadable",
      reason: "decoded-too-long",
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("4 Ko décodés comptés en unités UTF-16 : 4096 passent, 4097 non", () => {
    // Le schéma borne déjà les textes : un JSON de plus de 4 Ko se fait avec des espaces.
    const json = canonicalJson(DEED);
    const exact = json.replace("{", `{${" ".repeat(MAX_DECODED_LENGTH - json.length)}`);
    expect(exact.length).toBe(MAX_DECODED_LENGTH);
    expect(parseHash(hashOf(exact), NOW).screen).toBe("deed");
    const over = json.replace("{", `{${" ".repeat(MAX_DECODED_LENGTH - json.length + 1)}`);
    expect(parseHash(hashOf(over), NOW)).toEqual({
      screen: "unreadable",
      reason: "decoded-too-long",
    });
    // Les octets UTF-8 ne comptent plus : « à » en vaut 2 mais une seule unité UTF-16.
    const accented = exact.replace("Sam", "Sàm");
    expect(accented.length).toBe(MAX_DECODED_LENGTH);
    expect(new TextEncoder().encode(accented).length).toBeGreaterThan(MAX_DECODED_LENGTH);
    expect(parseHash(hashOf(accented), NOW).screen).toBe("deed");
  });

  it("un acte d'emoji aux bornes passe (plus de 4 Ko en UTF-8, moins de 4 Ko en UTF-16)", () => {
    const emoji = [0x1f389, 0x1f37a, 0x1f95f, 0x1f680, 0x1f98a].map((code) =>
      String.fromCodePoint(code),
    );
    const run = (length: number, seed: number) =>
      Array.from({ length }, (_, index) => emoji[(index + seed) % emoji.length] ?? "").join("");
    const atBounds: Deed = {
      ...DEED,
      bettor: run(40, 0),
      opponent: run(40, 1),
      subject: run(200, 2),
      stake: run(120, 3),
      articles: [4, 5, 6, 7, 8].map((seed) => run(160, seed)),
    };
    const json = canonicalJson(atBounds);
    expect(new TextEncoder().encode(json).length).toBeGreaterThan(MAX_DECODED_LENGTH);
    expect(json.length).toBeLessThanOrEqual(MAX_DECODED_LENGTH);
    expect(fitsInLink(atBounds)).toBe(true);
    const state = parseHash(buildHash(atBounds, "p"), NOW);
    expect(state.screen === "deed" && state.deed).toEqual(atBounds);
  });

  it("fitsInLink : un acte normal tient ; un acte maximal en caractères rares, non", () => {
    expect(fitsInLink(DEED)).toBe(true);
    const longest: Deed = {
      ...DEED,
      bettor: "x".repeat(40),
      opponent: "y".repeat(40),
      subject: "z".repeat(200),
      stake: "w".repeat(120),
      articles: Array.from({ length: 5 }, (_, index) => `${index}`.repeat(160)),
    };
    expect(fitsInLink(longest)).toBe(true);
    // Des idéogrammes tous différents se compressent mal : 1 200 caractères dépassent 4 Ko.
    let next = 0;
    const rare = (length: number) =>
      Array.from({ length }, () => String.fromCodePoint(0x4e00 + ((next++ * 7919) % 20_000))).join(
        "",
      );
    const exotic: Deed = {
      ...DEED,
      bettor: rare(40),
      opponent: rare(40),
      subject: rare(200),
      stake: rare(120),
      articles: Array.from({ length: 5 }, () => rare(160)),
    };
    expect(buildHash(exotic, null).length).toBeGreaterThan(4096);
    expect(fitsInLink(exotic)).toBe(false);
  });
});

describe("dates du lien", () => {
  it("t dans le futur de plus d'un jour → illisible", () => {
    const future = canonicalJson({
      ...DEED,
      draftedAt: NOW + 86_400_001,
      deadline: NOW + 86_400_002,
    });
    expect(parseHash(hashOf(future), NOW)).toEqual({
      screen: "unreadable",
      reason: "bad-draft-date",
    });
  });

  it("échéance passée à l'ouverture : l'acte reste valide", () => {
    expect(parseHash(buildHash(DEED, null), DEED.deadline + 86_400_000).screen).toBe("deed");
  });
});
