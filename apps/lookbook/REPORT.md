# Rapport lookbook · tour 2

## Verdict

**Pas fini.** 2 bloquants (reviewer), 0 critique ou élevé (security, 2 points moyens).
5 tests unitaires (oracle typographique) et 1 test e2e × 8 (hashes CSP) en échec.
Les 4 bloquants du tour 1 sont corrigés.

Décisions de l'orchestrateur à l'issue du tour (commit « rapport tour 2 ») :

- Les 5 hashes des directives client d'Astro sont tolérés (aucune option pour les retirer,
  confirmé par le builder, le reviewer et security dans le code d'Astro 7.3.8). Documenté dans
  `CLAUDE.md` et `.claude/agents/security.md`. Le test doit les accepter via une liste blanche
  **calculée** depuis `astro/runtime/client/*.prebuilt.js`, plus les hashes des scripts réellement
  présents dans la page ; tout autre hash fait échouer le test.
- Les agents qui lisent `site/` ne doivent pas lancer de build en même temps qu'un autre agent
  (security a reconstruit `site/` pendant les e2e du reviewer).

## Tester

Rien de perdu depuis le tour 1, modifications du builder justifiées par la spec.

| ID | Fichier | Statut |
| -- | ------- | ------ |
| Contenu, aperçus HTML `role="img"` nommés | tester.spec.ts | ✅ |
| CA-1 | tester.spec.ts | ✅ |
| CA-2 (360, 600, 768, 959, 960, 1440 px) | tester.spec.ts | ✅ |
| CA-3 réseau + CSP appliquée par le navigateur (préfixe, inline bloqué) | tester.spec.ts, csp.spec.ts | ✅ |
| CA-3 chaque hash `script-src` correspond à un script de la page | csp.spec.ts:213 | ❌ (hashes Astro) |
| CA-4 axe, contraste, focus, couleur seule, 44 px, WCAG 2.5.3 | collection.spec.ts, tester.spec.ts | ✅ |
| CA-5 tour au texte exact, pas d'étiquette sur le lookbook, `--tag-*` | collection.spec.ts, tester.spec.ts | ✅ |
| Oracle typographique (rigueur) | typography.tester.test.ts | ❌ 5 cas |
| Lighthouse ≥ 95 | | ⚠️ non testable ici |

Oracle : espace sécable collée à l'insécable non détectée (un seul voisin examiné), masquage
d'URL qui avale « » » et le tiret cadratin, pas de drapeau `i` (faux positif sur `HTTPS://`).

Trous de spec : U+00A0 exigé par le tour CA-5 alors que l'oracle accepte U+202F ; le lien
GitHub penche avec son post-it ; SVG inline dans l'aperçu de l'acte ; `'self'` restant.

## Reviewer

Points du tour 1 traités (reste : épinglage des actions par SHA, assertion d'accroche e2e vague).

- **[Bloquant]** Oracle typographique : corriger dans `typography.ts` (voisin + au-delà,
  `URL_PATTERN = /\bhttps?:\/\/[^\s«»]+/giu`, tiret cadratin testé sur le texte original).
- **[Bloquant]** Test des hashes : liste blanche calculée (voir décision ci-dessus), qui accepte
  aussi les hashes des `<script src>` de la page servis sous le préfixe.
- [Important] `tests/e2e/lookbook/csp.spec.ts` couvre les 4 pages : le déplacer dans
  `tests/e2e/csp.spec.ts` et fusionner avec la partie CSP de `collection.spec.ts`.
- [Important] Trois analyseurs de CSP : un seul `readCsp()` dans `tests/e2e/support/csp.ts`,
  indépendant de l'ordre des attributs.
- Mineurs : insécable avant la flèche du `CollectionTag` ; `NBSP` exporté une fois depuis shared ;
  supprimer les tests d'oracle redondants de `spec.test.ts` ; tests `request` limités au projet
  desktop ; erreur explicite si aucun `.woff2` ; message si `pnpm` introuvable dans
  `build-e2e.mjs` ; vérifier dans `deploy.yml` que `site/` porte la CSP de production.

Verdict : Pas prêt, 2 bloquants.

## Security

Aucun point critique ou élevé. M1 du tour 1 corrigé en production (vérifié sur les 4 pages).

- **Moyen M1** : `PAPERASSE_ORIGIN` mal validée. `https://*` élargit la CSP à tout hôte,
  `https://a"b` casse la meta (Astro n'échappe pas les guillemets) et désactive la CSP,
  `https://x;script-src` injecte une directive. Corriger : n'accepter que `http:` sur un hôte
  local avec port numérique ; tests pour `*`, `"`, `;`, `'` ; étape de contrôle de la CSP de
  production dans `deploy.yml`.
- **Moyen M2** : `default-src`, `connect-src`, `base-uri`, `form-action` en `'self'` couvrent tout
  `g0nni.github.io` (iframe, media, fetch vers un autre repo prouvés). Aucune app n'en a besoin :
  `default-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'`, `img-src` et
  `font-src` sur le préfixe.
- Info : hashes Astro tolérables (liste blanche calculée) ; la restriction de chemin CSP ne tient
  plus après redirection (CSP3, non exploitable sur Pages) ; refus d'`assemble.mjs` vérifiés
  (suggestion : `filter` dans `cp`) ; `serve.mjs` bien limité à 127.0.0.1 ; 0 vulnérabilité.
