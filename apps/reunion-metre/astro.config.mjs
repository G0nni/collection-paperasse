import { defineConfig } from "astro/config";
import { lookConfig } from "@paperasse/shared/look-config";

// Config commune à toute la collection (CSP, base, sortie statique) : voir packages/shared.
// PAPERASSE_ORIGIN (facultatif) change l'origine autorisée par la CSP, pour les e2e locaux.
export default defineConfig(lookConfig("reunion-metre", process.env));
