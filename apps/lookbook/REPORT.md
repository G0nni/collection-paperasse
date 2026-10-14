# Rapport lookbook · passage final (après le tour 3)

## Verdict

**Fini.** Les 6 points de la définition de « fini » de `CLAUDE.md` sont vrais :

1. CA-1 à CA-5 couverts et verts (la spec ne liste pas de CL).
2. Aucun cas limite listé dans la spec.
3. `pnpm verify` vert, relancé par l'orchestrateur : 222 + 10 tests unitaires, 247 e2e
   (41 sautés volontairement, tests à viewport fixe limités au desktop).
4. Reviewer : 0 bloquant au tour 3.
5. Security : aucun point critique ou élevé au tour 3.
6. Axe : 0 violation (360, 960, 1280 px).

Passage final, décidé avec Gonni après le tour 3 :

- `cspProblems` / `check-csp.mjs` en liste blanche (8 directives, hashes seulement dans
  script-src et style-src, nonces, `strict-dynamic` et sources schéma refusés).
- Oracle typographique : suite d'insécables sautée, ponctuation finale rognée des URL (sauf `!`,
  qui fait partie des URL dans deux tests existants).
- `&nbsp;→` remplacés par la constante `NBSP` partagée.
- Périmètre du tester et du reviewer recadré dans `.claude/agents/` pour les prochains looks.

Toujours ouverts (non bloquants) : actions GitHub épinglées par tag et non par SHA ;
`check-csp.mjs` importe un fichier de `tests/e2e/support/` ; `check-csp` ne contrôle pas la liste
des hashes présents (seul l'e2e le fait) ; Lighthouse non mesuré dans cet environnement.

---

# Historique : rapport du tour 3

## Ce qui bloque

**Pas fini après 3 tours.** Le lookbook livré est conforme : 0 bloquant au reviewer, 0 critique
ou élevé chez security, tous les CA de la spec couverts et verts. Mais `pnpm verify` est rouge
à cause de **15 tests en échec qui portent sur l'outillage partagé**, pas sur la page :

1. `tests/e2e/support/csp.ts` (`cspProblems`, utilisé par `scripts/check-csp.mjs` et les e2e)
   fonctionne en liste noire : une directive inconnue qui élargirait la CSP (`script-src-elem`,
   `frame-src`, `worker-src`, nonce…) passe. 12 tests e2e. Reviewer : Important ; security : Moyen.
   Personne d'extérieur ne peut introduire ces directives ; le risque crédible est une montée de
   version d'Astro. Correction connue (≈ 10 lignes) : liste blanche des noms de directives, refus
   des nonces, de `'strict-dynamic'` et des sources schéma.
2. `packages/shared/src/typography.ts` : une espace sécable après **deux** insécables n'est pas vue
   (2 tests), et une URL avale « ) » et « : » (1 test). Aucun texte du dépôt n'est concerné.

**Pourquoi le builder n'y arrive pas en 3 tours** : ce n'est pas une incapacité, c'est que la
boucle ne converge pas. L'oracle typographique et le contrôle de CSP sont des heuristiques ; à
chaque tour le tester trouve un cas plus marginal (une espace, puis deux, puis la parenthèse,
puis `script-src-elem`) que le builder corrige au tour suivant. Le reviewer recommande de
recadrer le périmètre du tester (formulation proposée plus bas) avant de livrer les 3 autres looks.

## Tester

| ID | Fichier | Statut |
| -- | ------- | ------ |
| Contenu, aperçus `role="img"` nommés, SVG décoratif `aria-hidden` | lookbook/tester.spec.ts | ✅ |
| CA-1 liens | tester.spec.ts | ✅ |
| CA-2 (360 à 1440 px) | tester.spec.ts | ✅ |
| CA-3 réseau, CSP dans le navigateur, hashes en liste blanche calculée | csp.spec.ts | ✅ |
| CA-3 CSP fermée (fetch, formulaire, `<base>`, object, iframe bloqués) | lookbook/csp-tester.spec.ts | ✅ |
| CA-3 `PAPERASSE_ORIGIN` hostile (43 cas) | config.tester.test.ts | ✅ |
| CA-3 `check-csp.mjs` refuse une directive inconnue qui élargit la CSP | csp-tester.spec.ts:62, 73, 85 | ❌ 12 |
| CA-4 axe, contraste, focus, 44 px, WCAG 2.5.3 | collection.spec.ts, tester.spec.ts | ✅ |
| CA-5 tour des étiquettes au texte exact, U+00A0 seule | collection.spec.ts, tester.spec.ts | ✅ |
| Lien GitHub incliné avec son post-it | tester.spec.ts | ✅ |
| Oracle typographique (rigueur) | typography.tester.test.ts | ❌ 3 |
| Lighthouse ≥ 95 | | ⚠️ non testable ici |

Résultats : e2e 235 ✅ / 12 ❌ / 41 sautés (desktop seulement, voulu) ; unitaires 219 ✅ / 3 ❌.
JS envoyé par le lookbook : 0 octet.

Trous de spec relevés : insécable avant « → » du `CollectionTag` ajoutée par le builder sans
modifier la spec ; `normalizeSpaces` des e2e compte encore U+202F comme une espace ; double
insécable acceptée alors que le commentaire de l'oracle dit « exactement une ».

## Reviewer

Tous les points du tour 2 sont fermés sauf : actions GitHub épinglées par tag et non par SHA
(ouvert depuis le tour 1), assertion e2e vague sur l'accroche.

- [Important] `tests/e2e/support/csp.ts` en liste noire (voir « Ce qui bloque », point 1).
- [Important] Épingler les actions des workflows par SHA.
- [Mineur] Oracle : sauter toute la suite d'insécables avant de classer le caractère suivant.
- [Mineur] `URL_PATTERN` : rogner la ponctuation finale, ou retirer le test (aucune URL affichée).
- [Mineur] `check-csp.mjs` importe un fichier de `tests/e2e/support/` : déplacer `csp.ts` dans
  `scripts/lib/` ou `packages/shared`.
- [Mineur] `&nbsp;→` littéral dans `index.astro:112`.

Proposition pour `.claude/agents/tester.md` (section « Périmètre ») : un test en échec doit
montrer un défaut observable dans le site construit ou le code du look ; une faille de
l'outillage sur une entrée que rien dans le dépôt ne produit va dans une section « Durcissements
proposés » du rapport ; au dernier tour, aucun nouveau test en échec sur l'outillage. Même règle
pour le reviewer : un trou d'outillage n'est Bloquant que s'il masque un défaut réel.

Verdict : 0 bloquant, mais `pnpm verify` rouge.

## Security

Aucun point critique ou élevé. M1 (validation de `PAPERASSE_ORIGIN`, 29 valeurs testées, et
contrôle de la CSP au déploiement) et M2 (CSP fermée par défaut, sondes bloquées dans Chromium)
sont corrigés et vérifiés.

- **Moyen** : `check-csp` ne refuse pas les directives qu'il ne connaît pas, ni les nonces, ni un
  hash arbitraire dans `script-src` (la liste blanche calculée n'existe que dans l'e2e).
  Non exploitable : filet contre une régression accidentelle, pas une barrière.
- Info : 0 vulnérabilité ; `filter` anti-symlink en place dans `assemble.mjs`.
