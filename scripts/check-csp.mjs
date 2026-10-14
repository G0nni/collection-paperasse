// Contrôle de la CSP du site assemblé, avant publication (security, tour 2, M1) : chaque page
// HTML de site/ doit porter une seule meta CSP, conforme à celle de la collection et limitée
// au préfixe de production. Un build lancé avec une PAPERASSE_ORIGIN de test, ou une CSP
// élargie par erreur, arrête le déploiement au lieu d'être publié.
//
//   node scripts/check-csp.mjs                       site/, préfixe de production
//   node scripts/check-csp.mjs <dossier> <préfixe>   ex. site http://127.0.0.1:4321/collection-paperasse/
//
// L'analyseur est celui des e2e (tests/e2e/support/csp.ts), chargé par Node avec suppression
// des types : un seul analyseur de CSP dans le dépôt.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_SOURCE = "https://g0nni.github.io/collection-paperasse/";

if (process.features.typescript === false || process.features.typescript === undefined) {
  console.error(
    "check-csp : ce Node ne charge pas le TypeScript (tests/e2e/support/csp.ts). " +
      "Il faut Node ≥ 22.18, comme dans la CI (.nvmrc).",
  );
  process.exit(2);
}
const { cspProblems, findCspMetas, parseCsp } = await import("../tests/e2e/support/csp.ts");

const root = fileURLToPath(new URL("..", import.meta.url));
const siteDir = resolve(root, process.argv[2] ?? "site");
const source = process.argv[3] ?? PRODUCTION_SOURCE;

async function htmlFiles(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await htmlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(path);
  }
  return files;
}

const files = await htmlFiles(siteDir).catch(() => []);
if (files.length === 0) {
  console.error(`check-csp : aucune page HTML dans ${relative(root, siteDir) || siteDir}.`);
  process.exit(1);
}

/** Position de la première balise qui charge quelque chose (Infinity s'il n'y en a pas). */
function firstResource(html) {
  const index = html.search(/<(?:link|script|style|img|iframe|object|embed|base)\b/iu);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

let failures = 0;
for (const file of files) {
  const html = await readFile(file, "utf8");
  const metas = findCspMetas(html);
  const [meta] = metas;
  const head = html.search(/<\/head>/iu);
  const problems =
    meta === undefined || metas.length !== 1
      ? [`une seule meta CSP attendue, ${metas.length} trouvée(s)`]
      : [
          ...(head === -1 || meta.index > head ? ["meta CSP hors de <head>"] : []),
          // Une meta CSP ne protège que ce qui la suit.
          ...(firstResource(html) < meta.index ? ["ressource chargée avant la meta CSP"] : []),
          ...cspProblems(parseCsp(meta.policy), source),
        ];
  const name = relative(siteDir, file);
  if (problems.length === 0) {
    console.log(`ok : ${name}`);
  } else {
    failures += 1;
    for (const problem of problems) console.error(`CSP invalide : ${name} : ${problem}`);
  }
}

if (failures > 0) {
  console.error(`check-csp : ${failures} page(s) sur ${files.length} sans la CSP de ${source}.`);
  process.exit(1);
}
console.log(`check-csp : ${files.length} page(s), CSP limitée à ${source}.`);
