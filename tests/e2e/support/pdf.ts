// Lecture minimale du texte d'un PDF produit par Chromium (page.pdf), sans dépendance : objets
// en clair, flux FlateDecode, polices avec table ToUnicode (Type0 Identity-H et Type3). Juste
// assez pour vérifier ce qui est imprimé sur chaque page (pied d'acte de Juré Craché, CA-6).
// Ce n'est pas un lecteur PDF général : un PDF d'une autre origine peut ne pas être lu.
import { inflateSync } from "node:zlib";

type PdfObject = { readonly dictionary: string; readonly stream: Buffer | null };

/** Objets « N 0 obj … endobj », flux décompressés. Le PDF est lu en latin1 (octet = caractère). */
function readObjects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  const header = /(\d+) 0 obj\s*/gu;
  for (let match = header.exec(text); match !== null; match = header.exec(text)) {
    const number = Number(match[1]);
    const start = header.lastIndex;
    const end = text.indexOf("endobj", start);
    if (end === -1) throw new Error(`PDF : objet ${number} sans « endobj »`);
    const streamAt = text.indexOf("stream", start);
    if (streamAt === -1 || streamAt > end) {
      objects.set(number, { dictionary: text.slice(start, end), stream: null });
      continue;
    }
    const dictionary = text.slice(start, streamAt);
    // Les données binaires peuvent contenir « endobj » : on saute /Length octets. Une longueur
    // indirecte (« /Length 12 0 R ») n'est pas suivie : on refuse plutôt que lire « 12 ».
    if (/\/Length\s+\d+\s+\d+\s+R\b/u.test(dictionary)) {
      throw new Error(`PDF : longueur indirecte de l'objet ${number} non gérée`);
    }
    const length = Number(/\/Length\s+(\d+)\b/u.exec(dictionary)?.[1] ?? Number.NaN);
    if (!Number.isInteger(length)) throw new Error(`PDF : longueur de l'objet ${number} illisible`);
    let dataStart = streamAt + "stream".length;
    if (text.startsWith("\r\n", dataStart)) dataStart += 2;
    else if (text.startsWith("\n", dataStart)) dataStart += 1;
    if (dataStart + length > pdf.length) throw new Error(`PDF : flux de l'objet ${number} tronqué`);
    const raw = pdf.subarray(dataStart, dataStart + length);
    const stream = /\/FlateDecode/u.test(dictionary) ? inflateSync(raw) : raw;
    objects.set(number, { dictionary, stream });
    const streamEnd = text.indexOf("endobj", dataStart + length);
    if (streamEnd === -1) throw new Error(`PDF : objet ${number} sans « endobj » après son flux`);
    header.lastIndex = streamEnd + "endobj".length;
  }
  return objects;
}

/** Table code → texte d'une police, et taille de ses codes en octets (2 pour Identity-H). */
type ToUnicode = { readonly bytes: number; readonly map: ReadonlyMap<number, string> };

function utf16beHex(hex: string): string {
  const units: number[] = [];
  for (let index = 0; index < hex.length; index += 4) {
    units.push(Number.parseInt(hex.slice(index, index + 4), 16));
  }
  return String.fromCharCode(...units);
}

function readCMap(cmap: string): ToUnicode {
  const map = new Map<number, string>();
  const space = /begincodespacerange\s*<([0-9A-Fa-f]+)>/u.exec(cmap);
  const bytes = space?.[1] === undefined ? 2 : space[1].length / 2;
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu)) {
    for (const pair of (block[1] ?? "").matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/gu)) {
      map.set(Number.parseInt(pair[1] ?? "", 16), utf16beHex(pair[2] ?? ""));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
    for (const range of (block[1] ?? "").matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/gu,
    )) {
      const low = Number.parseInt(range[1] ?? "", 16);
      const high = Number.parseInt(range[2] ?? "", 16);
      const first = range[3] ?? "";
      const base = Number.parseInt(first.slice(-4), 16);
      for (let code = low; code <= high; code += 1) {
        map.set(code, utf16beHex(first.slice(0, -4)) + String.fromCharCode(base + code - low));
      }
    }
  }
  return { bytes, map };
}

/** Références nommées d'un sous-dictionnaire de ressources : « /Font <</F4 4 0 R …>> ». */
function namedRefs(dictionary: string, kind: "Font" | "XObject"): Map<string, number> {
  const refs = new Map<string, number>();
  const block = new RegExp(`/${kind}\\s*<<([^>]*)>>`, "u").exec(dictionary)?.[1] ?? "";
  for (const ref of block.matchAll(/\/([\w.-]+)\s+(\d+) 0 R/gu)) {
    refs.set(ref[1] ?? "", Number(ref[2]));
  }
  return refs;
}

function decodeHexString(hex: string, font: ToUnicode | undefined): string {
  if (font === undefined) return "";
  const clean = hex.replace(/\s+/gu, "");
  const step = font.bytes * 2;
  let text = "";
  for (let index = 0; index + step <= clean.length; index += step) {
    text += font.map.get(Number.parseInt(clean.slice(index, index + step), 16)) ?? "";
  }
  return text;
}

/** Texte d'un flux de contenu (et des formulaires XObject qu'il dessine), dans l'ordre du flux. */
function contentText(
  objects: Map<number, PdfObject>,
  content: string,
  resources: string,
  depth: number,
): string {
  const fonts = new Map<string, ToUnicode>();
  for (const [name, number] of namedRefs(resources, "Font")) {
    const toUnicode = /\/ToUnicode (\d+) 0 R/u.exec(objects.get(number)?.dictionary ?? "")?.[1];
    const cmap = toUnicode === undefined ? undefined : objects.get(Number(toUnicode))?.stream;
    if (cmap) fonts.set(name, readCMap(cmap.toString("latin1")));
  }
  const forms = namedRefs(resources, "XObject");
  let current: ToUnicode | undefined;
  let text = "";
  const tokens = /\/([\w.-]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f\s]*)>|\/([\w.-]+)\s+Do|(TJ|Tj|ET)\b/gu;
  for (const token of content.matchAll(tokens)) {
    const [, fontName, hex, formName, operator] = token;
    if (fontName !== undefined) current = fonts.get(fontName);
    else if (hex !== undefined) text += decodeHexString(hex, current);
    else if (operator === "ET") text += "\n";
    else if (formName !== undefined && depth < 4) {
      const form = objects.get(forms.get(formName) ?? -1);
      if (form?.stream) {
        text += contentText(objects, form.stream.toString("latin1"), form.dictionary, depth + 1);
      }
    }
  }
  return text;
}

/** Numéro de l'objet référencé par `/Key N 0 R` dans un dictionnaire, sinon une erreur. */
function reference(dictionary: string, key: string, what: string): number {
  const found = new RegExp(`/${key}\\s+(\\d+)\\s+0\\s+R\\b`, "u").exec(dictionary)?.[1];
  if (found === undefined) throw new Error(`PDF : ${what} introuvable`);
  return Number(found);
}

/**
 * Pages feuilles de l'arbre des pages, dans l'ordre, depuis le nœud `number`. `seen` empêche
 * de tourner en rond sur un arbre circulaire.
 */
function pageLeaves(objects: Map<number, PdfObject>, number: number, seen: Set<number>): string[] {
  if (seen.has(number)) throw new Error(`PDF : arbre des pages circulaire (objet ${number})`);
  seen.add(number);
  const node = objects.get(number)?.dictionary;
  if (node === undefined) throw new Error(`PDF : nœud de pages ${number} absent`);
  if (/\/Type\s*\/Page(?![s\w])/u.test(node)) return [node];
  if (!/\/Type\s*\/Pages\b/u.test(node))
    throw new Error(`PDF : objet ${number} n'est pas une page`);
  const kids = /\/Kids\s*\[([^\]]*)\]/u.exec(node)?.[1];
  if (kids === undefined) throw new Error(`PDF : nœud de pages ${number} sans /Kids`);
  return [...kids.matchAll(/(\d+)\s+0\s+R/gu)].flatMap((kid) =>
    pageLeaves(objects, Number(kid[1]), seen),
  );
}

/**
 * Texte de chaque page du PDF, dans l'ordre des pages. On part du catalogue (`/Root` de la
 * dernière bande-annonce, mise à jour incrémentale comprise), puis de son `/Pages` ; le nombre
 * de pages trouvées doit égaler le `/Count` de la racine.
 */
export function pdfPageTexts(pdf: Buffer): string[] {
  const objects = readObjects(pdf);
  const roots = [...pdf.toString("latin1").matchAll(/\/Root\s+(\d+)\s+0\s+R\b/gu)];
  const root = roots.at(-1)?.[1];
  if (root === undefined) throw new Error("PDF : /Root introuvable");
  const catalog = objects.get(Number(root))?.dictionary;
  if (catalog === undefined || !/\/Type\s*\/Catalog\b/u.test(catalog)) {
    throw new Error(`PDF : le catalogue ${root} est absent ou n'en est pas un`);
  }
  const pagesRoot = reference(catalog, "Pages", "/Pages du catalogue");
  const pages = pageLeaves(objects, pagesRoot, new Set());
  const count = Number(/\/Count\s+(\d+)\b/u.exec(objects.get(pagesRoot)?.dictionary ?? "")?.[1]);
  if (count !== pages.length) {
    throw new Error(`PDF : ${pages.length} pages trouvées, /Count en annonce ${count}`);
  }
  return pages.map((page) => {
    const contents = [
      ...(/\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/u.exec(page)?.[1] ?? "").matchAll(/(\d+) 0 R/gu),
    ].map((ref) => objects.get(Number(ref[1]))?.stream?.toString("latin1") ?? "");
    return contentText(objects, contents.join("\n"), page, 0);
  });
}

/** Nombre d'occurrences de `needle` dans `text`, blancs ignorés des deux côtés. */
export function countIgnoringSpaces(text: string, needle: string): number {
  const squeeze = (value: string) => value.replace(/\s+/gu, "");
  const haystack = squeeze(text);
  const target = squeeze(needle);
  if (target === "") return 0;
  let count = 0;
  for (let at = haystack.indexOf(target); at !== -1; at = haystack.indexOf(target, at + 1)) {
    count += 1;
  }
  return count;
}
