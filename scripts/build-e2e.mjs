// Build pour les e2e locaux : même build que la production, mais la CSP autorise l'origine du
// serveur de test (scripts/serve.mjs) au lieu de https://g0nni.github.io. Sans ça, les e2e
// testeraient une CSP qui bloque tout, ou une CSP plus large que celle de la production.
import { spawnSync } from "node:child_process";

const port = Number(process.env.PORT ?? 4321);
const origin = `http://127.0.0.1:${port}`;
console.log(`build e2e : PAPERASSE_ORIGIN=${origin}`);

const result = spawnSync("pnpm", ["build"], {
  stdio: "inherit",
  env: { ...process.env, PAPERASSE_ORIGIN: origin },
  // Sous Windows, pnpm est un .cmd : il faut passer par le shell.
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
