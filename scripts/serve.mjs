// Petit serveur statique sans dépendance pour les tests e2e : sert site/ sous /collection-paperasse/,
// comme GitHub Pages. Uniquement pour le développement local et la CI.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const root = normalize(join(new URL("..", import.meta.url).pathname, "site"));
const prefix = "/collection-paperasse/";
const port = Number(process.env.PORT ?? 4321);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(302, { location: prefix }).end();
    return;
  }
  let relative;
  try {
    relative = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(root, relative));
  // Refuse tout chemin qui sortirait de site/ (../).
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) {
      if (!url.pathname.endsWith("/")) {
        res.writeHead(301, { location: `${url.pathname}/${url.search}` }).end();
        return;
      }
      file = join(file, "index.html");
    }
    await stat(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Introuvable");
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`site/ servi sur http://localhost:${port}${prefix}`);
});
