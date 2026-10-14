import { defineConfig } from "astro/config";
import { CSP_DIRECTIVES, SITE, baseFor } from "@paperasse/shared/config";

// Sortie 100 % statique, CSP par meta tag avec hashes (voir CLAUDE.md, Sécurité).
export default defineConfig({
  site: SITE,
  base: baseFor(null),
  output: "static",
  trailingSlash: "always",
  build: { inlineStylesheets: "never" },
  security: { csp: { directives: CSP_DIRECTIVES } },
});
