// Assemble le build de chaque app dans site/, tel qu'il sera servi par GitHub Pages :
//   site/            ← apps/lookbook/dist
//   site/<look>/     ← apps/<look>/dist
import { cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const appsDir = join(root, "apps");
const siteDir = join(root, "site");
const ROOT_APP = "lookbook";

async function exists(path) {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

/**
 * Refuse tout lien symbolique dans un build : copié tel quel, il pourrait faire publier un
 * fichier situé hors du dépôt.
 */
async function assertNoSymlink(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Lien symbolique refusé dans un build : ${relative(root, path)}`);
    }
    if (entry.isDirectory()) await assertNoSymlink(path);
  }
}

const apps = (await readdir(appsDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  // Le lookbook d'abord : les looks se posent ensuite dans ses sous-dossiers.
  .sort((a, b) => Number(b === ROOT_APP) - Number(a === ROOT_APP) || a.localeCompare(b));

if (apps[0] !== ROOT_APP) {
  throw new Error(`apps/${ROOT_APP} introuvable : c'est lui qui est servi à la racine.`);
}

await rm(siteDir, { recursive: true, force: true });
await mkdir(siteDir, { recursive: true });

for (const app of apps) {
  const dist = join(appsDir, app, "dist");
  const distStat = await lstat(dist).catch(() => null);
  if (distStat === null) {
    throw new Error(`Build manquant pour ${app} : lance d'abord pnpm --filter ${app} build`);
  }
  if (!distStat.isDirectory()) {
    throw new Error(`apps/${app}/dist n'est pas un dossier (lien symbolique ?)`);
  }
  await assertNoSymlink(dist);

  const target = app === ROOT_APP ? siteDir : join(siteDir, app);
  // Un look ne doit jamais écraser un dossier publié par le lookbook (ou l'inverse).
  if (app !== ROOT_APP && (await exists(target))) {
    throw new Error(`Collision : site/${app} existe déjà (publié par ${ROOT_APP}).`);
  }
  await cp(dist, target, { recursive: true, errorOnExist: true, force: false });
  console.log(`assemblé : ${app} → ${relative(root, target) || "."}`);
}
