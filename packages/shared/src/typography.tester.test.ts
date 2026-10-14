// Tests de l'agent tester (tour 2) : l'oracle typographique partagé est-il vraiment strict ?
// Règle (CLAUDE.md, « Accessibilité et qualité ») : espaces insécables avant « : ; ! ? » et à
// l'intérieur de « », pas de tiret cadratin. Le contrat écrit en tête de typography.ts : « Une
// espace normale, une fine sécable (U+2009), une tabulation ou un retour à la ligne laissent le
// signe partir seul à la ligne suivante : c'est une faute. »
// Tous les caractères spéciaux passent par String.fromCodePoint (pas de littéral invisible).
import { describe, expect, it } from "vitest";
import { findTypographyIssues } from "./typography";

const cp = (code: number) => String.fromCodePoint(code);
const NBSP = cp(0xa0);
const NARROW_NBSP = cp(0x202f);
const THIN_SPACE = cp(0x2009);
const EM_DASH = cp(0x2014);
const OPEN = "«";
const CLOSE = "»";

const kinds = (text: string) => findTypographyIssues(text).map((issue) => issue.kind);

/** Blancs sécables : aucun ne doit valoir une insécable. */
const BREAKING_SPACES: readonly { name: string; char: string }[] = [
  { name: "espace normale", char: " " },
  { name: "fine sécable U+2009", char: THIN_SPACE },
  { name: "tabulation", char: "\t" },
  { name: "retour à la ligne", char: "\n" },
  { name: "retour chariot", char: "\r" },
  { name: "tabulation verticale", char: "\v" },
  { name: "saut de page", char: "\f" },
  { name: "demi-cadratin U+2002", char: cp(0x2002) },
  { name: "cadratin U+2003", char: cp(0x2003) },
  { name: "espace ponctuation U+2008", char: cp(0x2008) },
  { name: "espace ultrafine U+200A", char: cp(0x200a) },
  { name: "espace math U+205F", char: cp(0x205f) },
  { name: "espace idéographique U+3000", char: cp(0x3000) },
];

describe("oracle strict · blancs sécables avant « : ; ! ? »", () => {
  for (const { name, char } of BREAKING_SPACES) {
    for (const mark of [":", ";", "!", "?"]) {
      it(`refuse ${name} avant « ${mark} »`, () => {
        expect(kinds(`Prix${char}${mark} rien`)).toEqual(["breaking-space"]);
      });
    }
  }
});

describe("oracle strict · blancs sécables dans les guillemets", () => {
  for (const { name, char } of BREAKING_SPACES) {
    it(`refuse ${name} après « et avant »`, () => {
      expect(kinds(`${OPEN}${char}Oui${NBSP}${CLOSE}`)).toEqual(["breaking-space"]);
      expect(kinds(`${OPEN}${NBSP}Oui${char}${CLOSE}`)).toEqual(["breaking-space"]);
    });
  }
});

describe("oracle strict · guillemets sans insécable", () => {
  it("refuse « Oui » avec deux espaces normales (deux fautes)", () => {
    expect(kinds(`${OPEN} Oui ${CLOSE}`)).toEqual(["breaking-space", "breaking-space"]);
  });

  it("refuse «Oui» collé (deux fautes)", () => {
    expect(kinds(`${OPEN}Oui${CLOSE}`)).toEqual(["missing-nbsp", "missing-nbsp"]);
  });

  it("refuse un » fermant en tout début de texte", () => {
    expect(kinds(`${CLOSE} suite`)).toEqual(["missing-nbsp"]);
  });

  it("refuse un guillemet ouvrant suivi d'un caractère invisible", () => {
    expect(kinds(`${OPEN}${cp(0x200b)}Oui${NBSP}${CLOSE}`)).toEqual(["missing-nbsp"]);
    expect(kinds(`${OPEN}${cp(0x2060)}Oui${NBSP}${CLOSE}`)).toEqual(["missing-nbsp"]);
  });

  it("accepte U+00A0 et U+202F, y compris mélangées", () => {
    expect(findTypographyIssues(`${OPEN}${NBSP}Oui${NARROW_NBSP}${CLOSE}`)).toEqual([]);
  });

  // Une espace sécable collée à l'insécable : la ligne peut se couper sur l'espace sécable et
  // envoyer « ⍽: » (ou « «⍽ » seul en fin de ligne) : exactement la faute que le contrat
  // de l'oracle décrit.
  it("refuse une espace sécable juste avant l'insécable qui précède « : »", () => {
    expect(kinds(`Prix ${NBSP}: rien`)).toEqual(["breaking-space"]);
  });

  it("refuse une espace sécable juste après l'insécable qui suit « »", () => {
    expect(kinds(`${OPEN}${NBSP} Oui${NBSP}${CLOSE}`)).toEqual(["breaking-space"]);
  });
});

describe("oracle strict · tiret cadratin", () => {
  it("compte chaque tiret cadratin, seul ou répété", () => {
    expect(kinds(EM_DASH)).toEqual(["em-dash"]);
    expect(kinds(`a ${EM_DASH}${EM_DASH} b`)).toEqual(["em-dash", "em-dash"]);
  });

  it("accepte le tiret demi-cadratin et le trait d'union", () => {
    expect(findTypographyIssues(`Réunion-mètre, 9${cp(0x2013)}18`)).toEqual([]);
  });

  // CLAUDE.md : « Pas de tiret cadratin (—) dans les textes d'interface », sans exception.
  // Une IRI affichée à l'écran reste du texte d'interface.
  it("voit le tiret cadratin même à l'intérieur d'une URL affichée", () => {
    expect(kinds(`https://exemple.fr/a${EM_DASH}b`)).toEqual(["em-dash"]);
  });
});

describe("oracle strict · ponctuation collée à une URL", () => {
  it("refuse un » collé à une URL (« » n'est pas un caractère d'URL)", () => {
    expect(kinds(`${OPEN}${NBSP}https://exemple.fr${CLOSE}`)).toEqual(["missing-nbsp"]);
  });

  it("refuse une espace normale entre une URL et « ! »", () => {
    expect(kinds("Voir https://exemple.fr !")).toEqual(["breaking-space"]);
  });

  it("refuse une espace normale avant « : » après une URL entre parenthèses", () => {
    expect(kinds("Le code (https://exemple.fr) : ici")).toEqual(["breaking-space"]);
  });
});

describe("oracle strict · pas de faux positif sur les heures", () => {
  for (const text of ["14:30", "9:05", "00:00", "14:30:15", "de 9:00 à 18:00", "À 23:59."]) {
    it(`accepte ${JSON.stringify(text)}`, () => {
      expect(findTypographyIssues(text)).toEqual([]);
    });
  }

  it("refuse quand même les deux-points d'un libellé suivi d'une heure", () => {
    expect(kinds("Début: 14:30")).toEqual(["missing-nbsp"]);
    expect(kinds("Début : 14:30")).toEqual(["breaking-space"]);
    expect(findTypographyIssues(`Début${NBSP}: 14:30`)).toEqual([]);
  });

  it("refuse un chiffre suivi de « : » puis d'une espace (ce n'est pas une heure)", () => {
    expect(kinds("Look 01: suite")).toEqual(["missing-nbsp"]);
  });
});

describe("oracle strict · pas de faux positif sur les URL", () => {
  for (const url of [
    "https://github.com/G0nni/collection-paperasse",
    "http://127.0.0.1:4321/collection-paperasse/",
    "https://exemple.fr:8443/a;b?c=d&e=f#g!",
    "https://exemple.fr/?q=1!",
    "https://g0nni.github.io/collection-paperasse/reunion-metre/?t=12:30",
  ]) {
    it(`accepte ${url} seule, en début de texte et dans une phrase correcte`, () => {
      expect(findTypographyIssues(url)).toEqual([]);
      expect(findTypographyIssues(`Le code${NBSP}: ${url}${NBSP}!`)).toEqual([]);
      expect(findTypographyIssues(`${OPEN}${NBSP}${url}${NBSP}${CLOSE}`)).toEqual([]);
    });
  }

  // Les e2e passent `innerText` à l'oracle : text-transform: uppercase y met l'URL en capitales.
  it("accepte une URL rendue en capitales par le CSS", () => {
    expect(findTypographyIssues("HTTPS://GITHUB.COM/G0NNI/COLLECTION-PAPERASSE")).toEqual([]);
  });
});
