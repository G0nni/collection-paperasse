// Garde-fou : les e2e doivent tourner sur un site/ construit par `pnpm build:e2e`, dont la CSP
// autorise le serveur local. Un site/ de production (`pnpm build`) bloquerait scripts et styles
// et ferait échouer des dizaines de tests sans dire pourquoi.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { hostSources, readCsp } from "./csp";

export default async function globalSetup(): Promise<void> {
  const port = Number(process.env.PORT ?? 4321);
  const expected = `http://127.0.0.1:${port}/collection-paperasse/`;
  const index = fileURLToPath(new URL("../../../site/index.html", import.meta.url));
  const html = await readFile(index, "utf8").catch(() => {
    throw new Error("site/ est absent : lance `pnpm build:e2e` avant `pnpm test:e2e`.");
  });
  if (!hostSources(readCsp(html), "script-src").includes(expected)) {
    throw new Error(
      `site/ n'a pas été construit pour les e2e (la CSP n'autorise pas ${expected}). ` +
        "Lance `pnpm build:e2e` (et non `pnpm build`) avant `pnpm test:e2e`.",
    );
  }
}
