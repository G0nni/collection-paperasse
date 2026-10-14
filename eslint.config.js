import js from "@eslint/js";
import astro from "eslint-plugin-astro";
import globals from "globals";
import tseslint from "typescript-eslint";

const xssMessage =
  "Puits XSS interdit (voir CLAUDE.md, Sécurité). Utilise textContent ou des éléments créés avec createElement.";

/** Règles de sécurité communes : on interdit les puits DOM dangereux à la source. */
const securityRules = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-script-url": "error",
  "no-restricted-properties": [
    "error",
    { property: "innerHTML", message: xssMessage },
    { property: "outerHTML", message: xssMessage },
    { object: "document", property: "write", message: xssMessage },
    { object: "document", property: "writeln", message: xssMessage },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
      message: xssMessage,
    },
    {
      selector:
        "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(style|href|src|srcdoc|action|formaction|on[a-z]+)$/i]",
      message:
        "Pas de donnée dynamique dans style/href/src/on* (CSP + XSS). Utilise style.setProperty ou une valeur construite depuis une liste blanche.",
    },
    {
      selector: "CallExpression[callee.object.name='Object'][callee.property.name='assign']",
      message:
        "Pas d'Object.assign sur des données décodées (pollution de prototype). Lis les clés attendues une par une.",
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "site/**",
      "**/.astro/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...astro.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...securityRules,
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/*.test.ts", "tests/**/*.ts", "scripts/**/*.mjs", "*.config.{js,ts,mjs}"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
    },
  },
);
