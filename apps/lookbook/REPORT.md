# Rapport lookbook · tour 1

## Verdict

**Pas fini.** 4 bloquants (reviewer), 0 critique ou élevé (security), 4 tests e2e et 3 tests
unitaires en échec. `pnpm verify` échoue.

Décisions de spec prises par l'orchestrateur à l'issue du tour (commit « rapport tour 1 ») :

- Format exact du `CollectionTag` fixé dans `specs/lookbook.md` : « · » visibles entre les blocs,
  « Suivant : <nom> → » (insécable avant « : »), « Retour au lookbook → » pour le look 03,
  pas d'étiquette sur le lookbook.
- Post-its : inclinés et en Courier Prime, comme sur la maquette validée (la spec disait droits).
- CA-2 : une colonne sous 960 px, trois au-delà.
- Aperçus en HTML/CSS (`role="img"` nommé) reconnus conformes.
- CLAUDE.md : liens d'une app vers elle-même par `BASE_URL`, liens entre apps par `baseFor()`.

## Tester

| ID | Fichier | Statut |
| -- | ------- | ------ |
| CA-1 liens | tester.spec.ts | ✅ |
| CA-2 empilement / 3 colonnes | tester.spec.ts | ✅ |
| CA-3 aucune ressource externe (interception réseau) | tester.spec.ts | ✅ |
| CA-4 axe 360 / 960 / 1280, contraste repos, survol, focus | tester.spec.ts | ✅ |
| CA-4 état distingué par la couleur seule (lien GitHub) | tester.spec.ts:694 | ❌ |
| CA-5 tour des étiquettes, format exact | tester.spec.ts:743 | ❌ |
| CA-5 `--tag-bg` / `--tag-fg`, contraste, 44 px | tester.spec.ts | ✅ |
| CA-5 typographie de l'étiquette | tester.spec.ts:838, spec.test.ts | ❌ |
| Insécables et absence de tiret cadratin dans le HTML rendu | tester.spec.ts | ✅ |
| Aucun `style="…"`, aucune violation CSP | tester.spec.ts | ✅ |
| Tokens de design, polices locales, inclinaisons, mouvement réduit | tester.spec.ts | ✅ |
| JS < 50 Ko | tester.spec.ts | ✅ (0 octet) |
| Lighthouse ≥ 95 | | ⚠️ non testable ici |

Échecs :

1. Étiquette sans séparateurs « · » (`packages/shared/src/CollectionTag.astro`).
2. Espace normale avant « : » dans `packages/shared/src/looks.ts:38` (et `looks.test.ts` attend
   la chaîne fautive).
3. `.repo:hover` ne change que la couleur (`apps/lookbook/src/pages/index.astro`).
4. `findTypographyIssues` ignore U+2009, tabulation et retour à la ligne avant « : ; ! ? ».

## Reviewer

Les 4 points du tester sont confirmés comme **bloquants**.

Important :

- `assetsInlineLimit: 0` seulement dans le lookbook : à partager. Créer `lookConfig(slug)` dans
  `packages/shared` qui renvoie toute la config Astro (supprime aussi la quadruple copie).
- `tests/e2e/lookbook/lookbook.spec.ts` fait doublon, en plus faible, avec `tester.spec.ts` :
  migrer le test « pas d'étiquette sur le lookbook », supprimer le reste.
- Doublons avec `collection.spec.ts` : une seule passe axe par viewport, le format exact de
  l'étiquette dans le tour commun, le test « aucun attribut style » dans collection.spec.
- Tests qui fixent leur viewport : ne les faire tourner que dans le projet desktop.
- ~300 lignes d'outils de test dans `tester.spec.ts` : les sortir dans `tests/e2e/support/`.
- Deux oracles typographiques divergents : un seul, pur, dans `packages/shared/src/typography.ts`.
- `Record<string, LookContent>` : exporter `LookSlug` depuis shared et taper `Record<LookSlug, …>`.

Mineur : `catalog.ts` mélange catalogue et textes de page (renommer ou séparer) ; texte d'UI
contraint par un sélecteur de test ; `pad` dupliqué ; trois rendus conditionnels d'aperçu
(table de composants) ; motif de lignes répété ; couleurs en dur (custom properties) ;
`role="list"` sur l'`<ol>` sans puces ; assertions d'accroche trop vagues ; tests de `tagFor` à
déplacer dans shared.

Verdict : Pas prêt, 4 bloquants.

## Security

Aucun point critique ou élevé.

- **Moyen M1** : `script-src 'self'` vaut pour tout `g0nni.github.io`, donc tous les repos Pages de
  Gonni. Restreindre `scriptDirective.resources` et `styleDirective.resources` au préfixe
  `https://g0nni.github.io/collection-paperasse/` (variante localhost pour les e2e). Les 5 hashes
  de scripts d'hydratation Astro sont inutiles sur une page sans island. `img-src data:` inutile
  pour le lookbook.
- Info : URL forgées sans effet (13 cas), CSP bien appliquée, un seul lien sortant sans
  `target`, polices identiques aux paquets fontsource, 0 vulnérabilité.
- Info `serve.mjs` : écouter sur `127.0.0.1`, `fileURLToPath` au lieu de `.pathname`.
- Info `assemble.mjs` : détecter les collisions de dossiers, refuser les liens symboliques.
- Info workflows : actions épinglées par tag majeur, pas par SHA.
