// Refuse les caractères invisibles ou bidirectionnels dans le code source (attaque « Trojan Source »,
// ou simple copier-coller piégé). Dans le code, on écrit ces caractères avec un échappement
// explicite : String.fromCodePoint(0x202e), "\u202E", etc.
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const skipDirs = new Set([
  "node_modules",
  "dist",
  "site",
  ".astro",
  ".git",
  "test-results",
  "playwright-report",
]);
const extensions = new Set([
  ".ts",
  ".mts",
  ".js",
  ".mjs",
  ".astro",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".css",
]);
const forbidden = new RegExp(
  String.raw`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]`,
  "u",
);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (extensions.has(extname(entry.name))) {
      yield join(dir, entry.name);
    }
  }
}

const offenders = [];
for await (const file of walk(root)) {
  const lines = (await readFile(file, "utf8")).split("\n");
  lines.forEach((line, index) => {
    const match = forbidden.exec(line);
    if (match) {
      const code = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      offenders.push(`${file.replace(root, "")}:${index + 1} · U+${code}`);
    }
  });
}

if (offenders.length > 0) {
  console.error("Caractères invisibles interdits :\n" + offenders.join("\n"));
  process.exit(1);
}
console.log("Aucun caractère invisible dans le code source.");
