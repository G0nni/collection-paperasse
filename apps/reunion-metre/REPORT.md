# Rapport reunion-metre · tour 1

## Verdict

**Pas fini.** 1 bloquant (reviewer : CA-11 casse dès qu'un message s'affiche), 0 critique ou élevé
(security : 2 moyens dans le nettoyeur de texte partagé). 3 tests e2e en échec, tous sur CA-11.

Décisions de l'orchestrateur à l'issue du tour (spec et CLAUDE.md, commit « rapport tour 1 ») :

- Écran Compteur : bouton « Copier le lien du compteur » acté.
- CA-6 : `e` borné à `[s + 1, s + 86 400]` à la fin, pour que le lien du ticket reste valide.
- URL réécrite sous forme propre après lecture (paramètres inconnus, doublons, invalides, hash).
- « Nouvelle réunion » garde équipe, tarif et titre ; URL sans `s`/`e` puis suit la Configuration.
- CL-3 : `e` dans le futur (> maintenant + 60 s) ignoré avec message.
- CL-8 et CLAUDE.md : 4 Ko mesurés sur la query brute, avant décodage.
- Afficheur : « € » avant le montant (maquette) et U+00A0 en séparateur ; ticket en Intl strict.
- Messages du Compteur comptés dans CA-11 ; Doto pour tous les chiffres hors ticket.
- Textes libres : `\p{Bidi_Control}` retiré (dont U+061C), texte sans caractère visible refusé,
  longueurs en points de code (pas de `maxlength`).

## Tester

CA-1 à CA-10 et CL-1 à CL-11 couverts et verts (747 e2e sur toute la collection, 145 unitaires
dont 20 000 liens hostiles au hasard et toutes les sommes de ticket de 0 à 2 000 €).

| ID | Statut |
| -- | -- |
| CA-1 à CA-10 | ✅ |
| CA-11 sans message (1, 5, 8 participants ; 12 et 30 en défilement interne) | ✅ |
| CA-11 avec 8 participants + un message (CL-6, CL-2, notice du lien) | ❌ 3 |
| CL-1 à CL-11, menace (bidi, HTML, URL non cliquable), CLAUDE.md (axe, 360 px, typo, 44 px, JS) | ✅ |
| Lighthouse | ⚠️ non testable ici |

Trous de spec relevés et tranchés ci-dessus : libellés invisibles, `e` futur, messages et CA-11,
`maxlength` en UTF-16, mesure des 4 Ko. Reste : `v` absent avec seulement des paramètres
étrangers (Configuration vierge sans message, jugé acceptable).

## Reviewer

- **[Bloquant]** CA-11 : la liste n'a aucune marge à 8 participants ; un message (≈ 46 px) la fait
  défiler. Sortir les messages du flux vertical (alertes sur la ligne de l'afficheur, notices
  refermables, stats à droite de l'afficheur) + test du pire cas (8 + CL-2 + CL-6 + notice).
- [Important] `#form-error` sans région live : erreurs non annoncées.
- [Important] Décision « participants valides / lien assez court » codée trois fois dans `app.ts`
  sans test → fonction pure `proposeMeeting` dans `lib/drafts.ts`.
- [Important] Bloc « mettre à jour la réunion » dupliqué → `updateMeeting(next)`.
- [Important] Lignes du ticket reconstruites chaque seconde (lecteur d'écran perd sa position) →
  construire une fois, ne mettre à jour que les montants.
- [Important] `whenText` (formatage) dans le module DOM, branche « autre jour » non testée.
- Mineurs : calculs constants refaits à chaque tick, `launch` qui interroge le DOM, double
  `refreshRows`, réannonce de la copie, `ParsedLink.screen` inutilisé, type discriminé pour
  `Meeting`, code mort dans `drafts.ts`, tarif B en dur, règle « masqué visuellement » triplée,
  chiffres hors Doto. Découpage de `app.ts` (540 lignes) après ces corrections.

## Security

Aucun point critique ou élevé. CSP effective conforme (script sous le préfixe, 5 hashes Astro
connus, rien d'autre), aucun puits dangereux, pas de pollution de prototype, ticker sans fuite,
0 vulnérabilité.

- **Moyen M1** : libellé ou titre entièrement invisible accepté (17 caractères testés) :
  « participant fantôme » à 1000 €/h. Exiger au moins un caractère visible dans `sanitizeText`.
- **Moyen M2** : U+061C (ALM) contourne le retrait bidi et inverse l'affichage d'un titre. Utiliser
  `\p{Bidi_Control}`.
- Info : copie du lien non normalisée (réécriture `replaceState` proposée, actée) ; `e` futur
  accepté (acté : refusé) ; entiers non canoniques (`v=01`) acceptés, sans conséquence.
