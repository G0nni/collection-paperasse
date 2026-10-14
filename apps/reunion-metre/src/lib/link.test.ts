import { NBSP } from "@paperasse/shared/typography";
import { describe, expect, it } from "vitest";
import { buildQuery, fitsInLink, parseLink, parseParticipant, parseTitle } from "./link";
import { ROLES, defaultMeeting, type Meeting } from "./meeting";

/** 14/10/2025 09:00:00 à Paris : le `s` de l'exemple de la spec. */
const S = 1_760_425_200;
const NOW_MS = (S + 2520) * 1000;

const SPEC_EXAMPLE =
  "?v=1&t=B&p=68|Cheffe%20de%20projet&p=48|Kevin%20du%20marketing&p=6|Stagiaire&s=1760425200&n=Point%20rapide";

const codes = (search: string, now = NOW_MS) => parseLink(search, now).notices.map((n) => n.code);
const query = (...parts: string[]) => `?${parts.join("&")}`;
const ONE = "p=50|Kevin";

describe("parseLink · écrans", () => {
  it("CA-1 · sans paramètre : Configuration, 5 suggestions, tarif B, aucun message", () => {
    const parsed = parseLink("", NOW_MS);
    expect(parsed.screen).toBe("setup");
    expect(parsed.notices).toEqual([]);
    expect(parsed.meeting).toEqual(defaultMeeting());
    expect(parsed.meeting.tariff).toBe("B");
    expect(parsed.meeting.participants).toEqual(
      ROLES.slice(0, 5).map((role) => ({ rate: role.rate, label: role.label })),
    );
  });

  it("des paramètres étrangers au format (utm_source…) ne changent rien", () => {
    expect(parseLink("?utm_source=chat&fbclid=x", NOW_MS)).toEqual(parseLink("", NOW_MS));
  });

  it("l'exemple de la spec ouvre le Compteur", () => {
    const parsed = parseLink(SPEC_EXAMPLE, NOW_MS);
    expect(parsed.notices).toEqual([]);
    expect(parsed.screen).toBe("meter");
    expect(parsed.meeting).toEqual({
      tariff: "B",
      participants: [
        { rate: 68, label: "Cheffe de projet" },
        { rate: 48, label: "Kevin du marketing" },
        { rate: 6, label: "Stagiaire" },
      ],
      title: "Point rapide",
      start: S,
      end: null,
    });
  });

  it("s et e valides : Ticket", () => {
    const parsed = parseLink(`${SPEC_EXAMPLE}&e=${S + 2520}`, NOW_MS);
    expect(parsed.screen).toBe("ticket");
    expect(parsed.meeting.end).toBe(S + 2520);
  });

  it("sans s : Configuration pré-remplie avec le lien", () => {
    const parsed = parseLink(query("v=1", "t=C", "p=12|Ana", "n=Revue"), NOW_MS);
    expect(parsed.screen).toBe("setup");
    expect(parsed.notices).toEqual([]);
    expect(parsed.meeting).toMatchObject({
      tariff: "C",
      title: "Revue",
      participants: [{ rate: 12, label: "Ana" }],
    });
  });
});

describe("parseLink · v", () => {
  it.each([
    ["absent", query("t=A", ONE, `s=${S}`)],
    ["2", query("v=2", ONE, `s=${S}`)],
    ["vide", query("v=", ONE, `s=${S}`)],
    ["1.0", query("v=1.0", ONE, `s=${S}`)],
    ["texte", query("v=un", ONE, `s=${S}`)],
  ])("v %s : Configuration vierge + « Lien d'une version inconnue »", (_label, search) => {
    const parsed = parseLink(search, NOW_MS);
    expect(parsed.screen).toBe("setup");
    expect(parsed.meeting).toEqual(defaultMeeting());
    expect(parsed.notices.map((n) => n.code)).toEqual(["unknown-version"]);
  });
});

describe("parseLink · t", () => {
  it("absent : tarif A, sans message", () => {
    expect(parseLink(query("v=1", ONE, `s=${S}`), NOW_MS).meeting.tariff).toBe("A");
    expect(codes(query("v=1", ONE, `s=${S}`))).toEqual([]);
  });

  it.each(["D", "a", "", "AB", "<b>", "%00"])("t=%s : tarif A + message", (value) => {
    const parsed = parseLink(query("v=1", `t=${value}`, ONE, `s=${S}`), NOW_MS);
    expect(parsed.meeting.tariff).toBe("A");
    expect(parsed.notices.map((n) => n.code)).toEqual(["bad-tariff"]);
    expect(parsed.screen).toBe("meter");
  });

  it("CL-7 · t=A&t=C : on prend le premier", () => {
    expect(parseLink(query("v=1", "t=A", "t=C", ONE, `s=${S}`), NOW_MS).meeting.tariff).toBe("A");
  });

  it("CL-7 · tous les paramètres non répétables gardent le premier", () => {
    const parsed = parseLink(
      query("v=1", "v=2", "t=C", "t=A", ONE, `s=${S}`, `s=${S + 10}`, "e=1", "n=Un", "n=Deux"),
      NOW_MS,
    );
    expect(parsed.meeting).toMatchObject({ tariff: "C", start: S, title: "Un" });
    expect(parsed.notices.map((n) => n.code)).toEqual(["bad-end"]);
  });
});

describe("parseParticipant · CL-5", () => {
  it.each([
    ["12.5|Kevin", "taux décimal"],
    ["-3|Kevin", "taux négatif"],
    ["1e3|Kevin", "notation exponentielle"],
    ["NaN|Kevin", "NaN"],
    ["Infinity|Kevin", "Infinity"],
    ["0x10|Kevin", "hexadécimal"],
    [" 12|Kevin", "espace avant le taux"],
    ["1001|Kevin", "taux au-dessus de 1000"],
    ["|Kevin", "taux vide"],
    ["Kevin", "sans |"],
    ["12", "sans | ni libellé"],
    ["12|", "libellé vide"],
    ["12|     ", "libellé blanc"],
    [`12|${"x".repeat(41)}`, "libellé de 41 caractères"],
    [`12|${String.fromCodePoint(0x202e, 0x200f)}`, "libellé fait seulement de bidi"],
    [`12|${String.fromCodePoint(0, 7, 0x1b)}`, "libellé fait seulement de contrôles"],
  ])("%s (%s) : ignoré", (raw) => {
    expect(parseParticipant(raw)).toBeNull();
  });

  it("bornes de taux incluses : 0 et 1000", () => {
    expect(parseParticipant("0|Bénévole")).toEqual({ rate: 0, label: "Bénévole" });
    expect(parseParticipant("1000|PDG")).toEqual({ rate: 1000, label: "PDG" });
  });

  it("libellé de 40 caractères, emoji compris (points de code)", () => {
    const label = "🙂".repeat(40);
    expect(parseParticipant(`5|${label}`)).toEqual({ rate: 5, label });
  });

  it("le séparateur est le premier | : un | dans le libellé reste du texte", () => {
    expect(parseParticipant("12|Kevin | Marketing")).toEqual({
      rate: 12,
      label: "Kevin | Marketing",
    });
  });

  it("libellé avec du HTML : gardé tel quel, en texte", () => {
    const label = "<img src=x onerror=alert(1)>";
    expect(parseParticipant(`12|${label}`)).toEqual({ rate: 12, label });
  });

  it("caractères de contrôle et bidirectionnels retirés, espaces de bord rognées", () => {
    const raw = `12|  Ke${String.fromCodePoint(0x202e)}vin${String.fromCodePoint(0)} ${String.fromCodePoint(0x2066)}`;
    expect(parseParticipant(raw)).toEqual({ rate: 12, label: "Kevin" });
  });
});

describe("parseLink · p", () => {
  it("CL-5 · participants invalides ignorés, avec leur nombre", () => {
    const parsed = parseLink(
      query("v=1", "p=12.5|A", "p=50|Kevin", "p=-1|B", "p=1e3|C", "p=NaN|D", "p=E", `s=${S}`),
      NOW_MS,
    );
    expect(parsed.meeting.participants).toEqual([{ rate: 50, label: "Kevin" }]);
    expect(parsed.notices).toEqual([{ code: "ignored-participants", count: 5 }]);
    expect(parsed.screen).toBe("meter");
  });

  it("CL-11 · deux participants au même libellé : autorisé", () => {
    const parsed = parseLink(query("v=1", "p=50|Kevin", "p=40|Kevin", `s=${S}`), NOW_MS);
    expect(parsed.meeting.participants).toEqual([
      { rate: 50, label: "Kevin" },
      { rate: 40, label: "Kevin" },
    ]);
    expect(parsed.notices).toEqual([]);
  });

  it("CL-4 · 31 participants : les 30 premiers + message", () => {
    const people = Array.from({ length: 31 }, (_, index) => `p=${index}|P${index}`);
    const parsed = parseLink(query("v=1", ...people, `s=${S}`), NOW_MS);
    expect(parsed.meeting.participants).toHaveLength(30);
    expect(parsed.meeting.participants.at(-1)).toEqual({ rate: 29, label: "P29" });
    expect(parsed.notices.map((n) => n.code)).toEqual(["too-many-participants"]);
  });

  it("CL-4 · 30 participants : aucun message", () => {
    const people = Array.from({ length: 30 }, (_, index) => `p=${index}|P${index}`);
    const parsed = parseLink(query("v=1", ...people, `s=${S}`), NOW_MS);
    expect(parsed.meeting.participants).toHaveLength(30);
    expect(parsed.notices).toEqual([]);
  });

  it("CL-4 · 200 participants : 30 gardés, le lien ne gèle rien", () => {
    const people = Array.from({ length: 200 }, (_, index) => `p=${index % 1000}|P`);
    const parsed = parseLink(query("v=1", ...people, `s=${S}`), NOW_MS);
    expect(parsed.meeting.participants).toHaveLength(30);
  });

  it.each([
    ["aucun p", query("v=1", "t=C", `s=${S}`)],
    ["aucun p valide", query("v=1", "t=C", "p=x|y", "p=12|", `s=${S}`)],
  ])("%s : Configuration + message, tarif du lien gardé", (_label, search) => {
    const parsed = parseLink(search, NOW_MS);
    expect(parsed.screen).toBe("setup");
    expect(parsed.meeting.start).toBeNull();
    expect(parsed.meeting.tariff).toBe("C");
    expect(parsed.meeting.participants).toEqual(defaultMeeting().participants);
    expect(parsed.notices.map((n) => n.code)).toEqual(["no-participants"]);
  });
});

describe("parseLink · s", () => {
  it("CL-1 · s plus de 60 s dans le futur : Configuration + message", () => {
    const now = S * 1000;
    const parsed = parseLink(query("v=1", ONE, `s=${S + 61}`), now);
    expect(parsed.screen).toBe("setup");
    expect(parsed.meeting.start).toBeNull();
    expect(parsed.meeting.participants).toEqual([{ rate: 50, label: "Kevin" }]);
    expect(parsed.notices.map((n) => n.code)).toEqual(["future-start"]);
  });

  it("s = maintenant + 60 s : toléré (horloges décalées)", () => {
    expect(parseLink(query("v=1", ONE, `s=${S + 60}`), S * 1000).screen).toBe("meter");
  });

  it("s = 2020-01-01 : accepté ; une seconde avant : refusé", () => {
    expect(parseLink(query("v=1", ONE, "s=1577836800"), NOW_MS).screen).toBe("meter");
    expect(codes(query("v=1", ONE, "s=1577836799"))).toEqual(["bad-start"]);
  });

  it.each(["", "abc", "1.76e9", "1760425200.5", "-1760425200", "99999999999999999999"])(
    "s=%s : Configuration + message",
    (value) => {
      const parsed = parseLink(query("v=1", ONE, `s=${value}`), NOW_MS);
      expect(parsed.screen).toBe("setup");
      expect(parsed.notices.map((n) => n.code)).toEqual(["bad-start"]);
    },
  );

  it("s en millisecondes (trop loin dans le futur) : refusé", () => {
    expect(codes(query("v=1", ONE, `s=${S * 1000}`))).toEqual(["future-start"]);
  });
});

describe("parseLink · e", () => {
  it("e = s + 24 h : accepté", () => {
    const parsed = parseLink(query("v=1", ONE, `s=${S}`, `e=${S + 86_400}`), NOW_MS);
    expect(parsed.screen).toBe("ticket");
  });

  it.each([
    ["e = s (CL-3)", S],
    ["e < s (CL-3)", S - 1],
    ["e > s + 24 h", S + 86_401],
    ["e illisible", "demain"],
    ["e vide", ""],
  ])("%s : e ignoré, retour au Compteur + message", (_label, value) => {
    const parsed = parseLink(query("v=1", ONE, `s=${S}`, `e=${value}`), NOW_MS);
    expect(parsed.screen).toBe("meter");
    expect(parsed.meeting.end).toBeNull();
    expect(parsed.notices.map((n) => n.code)).toEqual(["bad-end"]);
  });

  it("e sans s valide : ignoré sans message propre", () => {
    expect(codes(query("v=1", ONE, `e=${S}`))).toEqual([]);
    expect(codes(query("v=1", ONE, "s=x", `e=${S}`))).toEqual(["bad-start"]);
  });
});

describe("parseLink · n", () => {
  it("absent ou vide : titre vide", () => {
    expect(parseLink(query("v=1", ONE), NOW_MS).meeting.title).toBe("");
    expect(parseLink(query("v=1", ONE, "n="), NOW_MS).meeting.title).toBe("");
    expect(codes(query("v=1", ONE, "n="))).toEqual([]);
  });

  it("60 caractères : gardé ; 61 : vide + message", () => {
    expect(parseLink(query("v=1", ONE, `n=${"a".repeat(60)}`), NOW_MS).meeting.title).toHaveLength(
      60,
    );
    const parsed = parseLink(query("v=1", ONE, `n=${"a".repeat(61)}`), NOW_MS);
    expect(parsed.meeting.title).toBe("");
    expect(parsed.notices.map((n) => n.code)).toEqual(["bad-title"]);
  });

  it("nettoyé : contrôles et bidi retirés, rogné", () => {
    expect(
      parseTitle(`  Revue ${String.fromCodePoint(0x202e)}Q3${String.fromCodePoint(0)}  `),
    ).toBe("Revue Q3");
  });

  it("HTML et javascript: restent du texte", () => {
    const title = "<script>alert(1)</script> javascript:alert(1)";
    expect(parseLink(`?v=1&${ONE}&n=${encodeURIComponent(title)}`, NOW_MS).meeting.title).toBe(
      title,
    );
  });
});

describe("parseLink · taille", () => {
  it("CL-8 · query de plus de 4 Ko : Configuration vierge + « Lien trop long »", () => {
    const search = `?v=1&${ONE}&s=${S}&n=${"a".repeat(4096)}`;
    const parsed = parseLink(search, NOW_MS);
    expect(parsed.screen).toBe("setup");
    expect(parsed.meeting).toEqual(defaultMeeting());
    expect(parsed.notices.map((n) => n.code)).toEqual(["too-long"]);
  });

  it("CL-8 · 4096 caractères tout juste : lu normalement", () => {
    const head = `v=1&${ONE}&s=${S}&x=`;
    const search = `?${head}${"a".repeat(4096 - head.length)}`;
    expect(parseLink(search, NOW_MS).screen).toBe("meter");
  });

  it("une query de 1 Mo est refusée sans être décodée", () => {
    expect(codes(`?${"p=1|a&".repeat(150_000)}`)).toEqual(["too-long"]);
  });
});

describe("buildQuery", () => {
  const meeting: Meeting = {
    tariff: "B",
    participants: [
      { rate: 68, label: "Cheffe de projet" },
      { rate: 48, label: "Kevin du marketing" },
      { rate: 6, label: "Stagiaire" },
    ],
    title: "Point rapide",
    start: S,
    end: null,
  };

  it("écrit exactement le format de la spec", () => {
    expect(buildQuery(meeting)).toBe(SPEC_EXAMPLE);
  });

  it("ajoute e après s, omet n vide et s absent", () => {
    expect(buildQuery({ ...meeting, end: S + 60, title: "" })).toBe(
      "?v=1&t=B&p=68|Cheffe%20de%20projet&p=48|Kevin%20du%20marketing&p=6|Stagiaire&s=1760425200&e=1760425260",
    );
    expect(buildQuery({ ...meeting, start: null, end: S })).toBe(
      "?v=1&t=B&p=68|Cheffe%20de%20projet&p=48|Kevin%20du%20marketing&p=6|Stagiaire&n=Point%20rapide",
    );
  });

  it("aller-retour : parseLink(buildQuery(r)) redonne r, caractères spéciaux compris", () => {
    const tricky: Meeting = {
      tariff: "C",
      participants: [
        { rate: 0, label: "A | B & C = D + E # F % G ? H" },
        { rate: 1000, label: `Responsable «${NBSP}transverse${NBSP}»` },
        { rate: 7, label: "<img src=x onerror=alert(1)>" },
        { rate: 7, label: "🙂 Kevin" },
      ],
      title: "Revue & co · 100 % utile ?",
      start: S,
      end: S + 3600,
    };
    const parsed = parseLink(buildQuery(tricky), NOW_MS);
    expect(parsed.notices).toEqual([]);
    expect(parsed.meeting).toEqual(tricky);
  });

  it("CL-8 · fitsInLink : vrai pour une réunion normale, faux au-delà de 4 Ko", () => {
    expect(fitsInLink(meeting)).toBe(true);
    const crowded: Meeting = {
      ...meeting,
      participants: Array.from({ length: 30 }, () => ({ rate: 1000, label: "é".repeat(40) })),
    };
    expect(fitsInLink(crowded)).toBe(false);
  });
});
