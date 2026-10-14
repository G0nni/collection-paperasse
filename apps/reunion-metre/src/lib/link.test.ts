import { NBSP } from "@paperasse/shared/typography";
import { describe, expect, it } from "vitest";
import { buildQuery, fitsInLink, parseLink, parseParticipant, parseTitle } from "./link";
import { ROLES, defaultMeeting, screenOf, type Meeting } from "./meeting";

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
    expect(screenOf(parsed.meeting)).toBe("setup");
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
    expect(screenOf(parsed.meeting)).toBe("meter");
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
    expect(screenOf(parsed.meeting)).toBe("ticket");
    expect(parsed.meeting.end).toBe(S + 2520);
  });

  it("sans s : Configuration pré-remplie avec le lien", () => {
    const parsed = parseLink(query("v=1", "t=C", "p=12|Ana", "n=Revue"), NOW_MS);
    expect(screenOf(parsed.meeting)).toBe("setup");
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
    expect(screenOf(parsed.meeting)).toBe("setup");
    expect(parsed.meeting).toEqual(defaultMeeting());
    expect(parsed.notices.map((n) => n.code)).toEqual(["unknown-version"]);
    // Il peut venir d'une version plus récente du site : l'adresse n'est pas réécrite (spec,
    // « Écrans »).
    expect(parsed.query).toBeNull();
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
    expect(screenOf(parsed.meeting)).toBe("meter");
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
    expect(screenOf(parsed.meeting)).toBe("meter");
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
    expect(screenOf(parsed.meeting)).toBe("setup");
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
    expect(screenOf(parsed.meeting)).toBe("setup");
    expect(parsed.meeting.start).toBeNull();
    expect(parsed.meeting.participants).toEqual([{ rate: 50, label: "Kevin" }]);
    expect(parsed.notices.map((n) => n.code)).toEqual(["future-start"]);
  });

  it("s = maintenant + 60 s : toléré (horloges décalées)", () => {
    expect(screenOf(parseLink(query("v=1", ONE, `s=${S + 60}`), S * 1000).meeting)).toBe("meter");
  });

  it("s = 2020-01-01 : accepté ; une seconde avant : refusé", () => {
    expect(screenOf(parseLink(query("v=1", ONE, "s=1577836800"), NOW_MS).meeting)).toBe("meter");
    expect(codes(query("v=1", ONE, "s=1577836799"))).toEqual(["bad-start"]);
  });

  it.each(["", "abc", "1.76e9", "1760425200.5", "-1760425200", "99999999999999999999"])(
    "s=%s : Configuration + message",
    (value) => {
      const parsed = parseLink(query("v=1", ONE, `s=${value}`), NOW_MS);
      expect(screenOf(parsed.meeting)).toBe("setup");
      expect(parsed.notices.map((n) => n.code)).toEqual(["bad-start"]);
    },
  );

  it("s en millisecondes (trop loin dans le futur) : refusé", () => {
    expect(codes(query("v=1", ONE, `s=${S * 1000}`))).toEqual(["future-start"]);
  });
});

describe("parseLink · e", () => {
  it("e = s + 24 h : accepté", () => {
    const parsed = parseLink(query("v=1", ONE, `s=${S}`, `e=${S + 86_400}`), (S + 86_400) * 1000);
    expect(screenOf(parsed.meeting)).toBe("ticket");
  });

  it.each([
    ["e = s (CL-3)", S],
    ["e < s (CL-3)", S - 1],
    ["e > s + 24 h", S + 86_401],
    ["e illisible", "demain"],
    ["e vide", ""],
  ])("%s : e ignoré, retour au Compteur + message", (_label, value) => {
    const parsed = parseLink(query("v=1", ONE, `s=${S}`, `e=${value}`), NOW_MS);
    expect(screenOf(parsed.meeting)).toBe("meter");
    expect(parsed.meeting.end).toBeNull();
    expect(parsed.notices.map((n) => n.code)).toEqual(["bad-end"]);
  });

  it("CL-3 · e plus de 60 s dans le futur : ignoré, Compteur + message", () => {
    const now = S + 600;
    const parsed = parseLink(query("v=1", ONE, `s=${S}`, `e=${now + 61}`), now * 1000);
    expect(screenOf(parsed.meeting)).toBe("meter");
    expect(parsed.meeting.end).toBeNull();
    expect(parsed.notices.map((n) => n.code)).toEqual(["future-end"]);
  });

  it("e = maintenant + 60 s : toléré (horloges décalées), Ticket", () => {
    const now = S + 600;
    const parsed = parseLink(query("v=1", ONE, `s=${S}`, `e=${now + 60}`), now * 1000);
    expect(screenOf(parsed.meeting)).toBe("ticket");
    expect(parsed.notices).toEqual([]);
  });

  it("CL-3 · e sans s valide : ignoré, avec message, et retiré de la forme propre", () => {
    const withoutStart = parseLink(query("v=1", "t=A", ONE, `e=${S}`), NOW_MS);
    expect(screenOf(withoutStart.meeting)).toBe("setup");
    expect(withoutStart.notices.map((n) => n.code)).toEqual(["end-without-start"]);
    expect(withoutStart.query).toBe("?v=1&t=A&p=50|Kevin");
    expect(codes(query("v=1", ONE, "s=x", `e=${S}`))).toEqual(["bad-start", "end-without-start"]);
    expect(codes(query("v=1", ONE, `s=${S + 99_999}`, `e=${S}`))).toEqual([
      "future-start",
      "end-without-start",
    ]);
    expect(codes(query("v=1", ONE, "e="))).toEqual(["end-without-start"]);
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
    expect(screenOf(parsed.meeting)).toBe("setup");
    expect(parsed.meeting).toEqual(defaultMeeting());
    expect(parsed.notices.map((n) => n.code)).toEqual(["too-long"]);
  });

  it("CL-8 · 4096 caractères tout juste : lu normalement", () => {
    const head = `v=1&${ONE}&s=${S}&x=`;
    const search = `?${head}${"a".repeat(4096 - head.length)}`;
    expect(screenOf(parseLink(search, NOW_MS).meeting)).toBe("meter");
  });

  it("CL-8 · forme propre de plus de 4 Ko (« %FF » devient « %EF%BF%BD ») : refusée comme trop longue", () => {
    // Un libellé de 39 « %FF » + « a » : 118 octets lus, 352 octets une fois propre.
    const team = (count: number) =>
      Array.from({ length: count }, () => `p=1|${"%FF".repeat(39)}a`).join("&");
    const fits = parseLink(`?v=1&t=A&${team(11)}&s=${S}`, NOW_MS);
    expect(fits.notices).toEqual([]);
    expect(fits.query?.length).toBeLessThanOrEqual(4097);
    const search = `?v=1&t=A&${team(12)}&s=${S}`;
    expect(search.length).toBeLessThanOrEqual(4096);
    const parsed = parseLink(search, NOW_MS);
    expect(parsed.notices.map((n) => n.code)).toEqual(["too-long"]);
    expect(parsed.meeting).toEqual(defaultMeeting());
    expect(parsed.query).toBe("");
  });

  it("une query de 1 Mo est refusée sans être décodée", () => {
    expect(codes(`?${"p=1|a&".repeat(150_000)}`)).toEqual(["too-long"]);
  });
});

describe("parseLink · forme propre du lien", () => {
  it("lien ignoré en entier : forme propre vide (aucune query)", () => {
    expect(parseLink("", NOW_MS).query).toBe("");
    expect(parseLink("?utm_source=chat", NOW_MS).query).toBe("");
    expect(parseLink(`?v=1&${ONE}&n=${"a".repeat(4096)}`, NOW_MS).query).toBe("");
  });

  it("l'exemple de la spec est déjà propre", () => {
    expect(parseLink(SPEC_EXAMPLE, NOW_MS).query).toBe(SPEC_EXAMPLE);
  });

  it("retire paramètres inconnus, doublons et participants invalides, remet l'ordre", () => {
    const messy = query(
      "utm_source=chat",
      "n=Revue",
      "n=Autre",
      "p=12.5|Décimal",
      "t=C",
      "t=A",
      "p=48|Kevin%20du%20marketing",
      "v=1",
      `s=${S}`,
      `s=${S + 9}`,
      "x=%3Cscript%3E",
    );
    expect(parseLink(messy, NOW_MS).query).toBe(
      `?v=1&t=C&p=48|Kevin%20du%20marketing&s=${S}&n=Revue`,
    );
  });

  it("retire un s refusé (Configuration) et un e refusé (Compteur)", () => {
    expect(parseLink(query("v=1", "t=A", ONE, `s=${S + 99_999}`), NOW_MS).query).toBe(
      "?v=1&t=A&p=50|Kevin",
    );
    expect(parseLink(query("v=1", "t=A", ONE, `s=${S}`, `e=${S}`), NOW_MS).query).toBe(
      `?v=1&t=A&p=50|Kevin&s=${S}`,
    );
  });

  it("libellés nettoyés : la forme propre ne garde ni bidi ni contrôle", () => {
    const rlo = encodeURIComponent(String.fromCodePoint(0x202e));
    expect(parseLink(query("v=1", "t=A", `p=5|Ke${rlo}vin%00`), NOW_MS).query).toBe(
      "?v=1&t=A&p=5|Kevin",
    );
  });

  it("forme propre d'un libellé zalgo : marques réduites à 4, stable à la relecture", () => {
    const zalgo = encodeURIComponent(
      String.fromCodePoint(
        0x4b,
        ...Array.from({ length: 39 }, (_, index) => 0x0350 + (index % 32)),
      ),
    );
    const first = parseLink(query("v=1", "t=A", `p=5|${zalgo}`, `s=${S}`), NOW_MS);
    expect(first.notices).toEqual([]);
    expect([...(first.meeting.participants[0]?.label ?? "")]).toHaveLength(5);
    const second = parseLink(first.query ?? "", NOW_MS);
    expect(second.query).toBe(first.query);
    expect(second.meeting).toEqual(first.meeting);
  });

  it("la forme propre se relit à l'identique, sans message", () => {
    const messy = query("t=Z", "v=1", "p=1e3|x", ONE, "p=7|Quelqu'un", `s=${S}`, "n=%20Revue%20");
    const first = parseLink(messy, NOW_MS);
    const second = parseLink(first.query ?? "", NOW_MS);
    expect(first.query).not.toBe("");
    expect(second.query).toBe(first.query);
    expect(second.meeting).toEqual(first.meeting);
    expect(second.notices).toEqual([]);
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
    // Une fin sans début n'existe pas (le type Meeting l'interdit).
    expect(buildQuery({ ...meeting, start: null, end: null })).toBe(
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
      end: S + 2400,
    };
    const parsed = parseLink(buildQuery(tricky), NOW_MS);
    expect(parsed.notices).toEqual([]);
    expect(parsed.meeting).toEqual(tricky);
  });

  it("écrit exactement ce que le navigateur relira dans location.search (« ' » encodé)", () => {
    const tricky: Meeting = {
      ...meeting,
      participants: [
        { rate: 80, label: "Quelqu'un du juridique, au cas où" },
        { rate: 1, label: "A | B & C = D + E # F % G ? H ! ~ * ( ) é 🙂" },
      ],
      title: "L'ordre du jour, c'est quoi ?",
    };
    const written = buildQuery(tricky);
    expect(written).not.toContain("'");
    expect(new URL(written, "https://g0nni.github.io/collection-paperasse/").search).toBe(written);
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
