// Assemble le build de chaque app dans site/, tel qu'il sera servi par GitHub Pages :
//   site/            ← apps/lookbook/dist
//   site/<look>/     ← apps/<look>/dist
import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const appsDir = join(root, "apps");
const siteDir = join(root, "site");

await rm(siteDir, { recursive: true, force: true });
await mkdir(siteDir, { recursive: true });

for (const app of await readdir(appsDir)) {
  const dist = join(appsDir, app, "dist");
  const exists = await stat(dist).then(
    () => true,
    () => false,
  );
  if (!exists) {
    throw new Error(`Build manquant pour ${app} : lance d'abord pnpm --filter ${app} build`);
  }
  const target = app === "lookbook" ? siteDir : join(siteDir, app);
  await cp(dist, target, { recursive: true });
  console.log(`assemblé : ${app} → ${target.replace(root, "")}`);
}
