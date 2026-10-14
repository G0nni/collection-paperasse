# Rapport reunion-metre · tour 2

## Verdict

**Pas fini.** 1 bloquant (reviewer : le repli de copie flotte sur le ticket à 1093×614 et 960×600,
masque le Total et ne se ferme pas), 0 critique ou élevé (security : 3 moyens). 2 tests e2e en
échec. Tous les points du tour 1 sont fermés, dont le bloquant CA-11 (pire cas tenu à 1280×720).

Décisions de l'orchestrateur à l'issue du tour (spec et CLAUDE.md, commit « rapport tour 2 ») :

- Repli de copie dans un `<dialog>` modal (champ sélectionné, Fermer, Échap, focus rendu) ; statut
  « Lien copié » à côté du bouton, jamais par-dessus le ticket.
- Lien de version inconnue non réécrit ; forme propre de plus de 4 Ko refusée.
- Notices : affichées jusqu'à Fermer ou changement d'écran, non réaffichées au rechargement.
- CA-11 : une erreur de saisie en cours peut faire défiler la liste dans son cadre ; les messages
  ne doivent jamais masquer une ligne du ticket sans moyen de la lire.
- CL-3 : `e` sans `s` valide ignoré avec message.
- `sanitizeText` (partagé) : U+FFFC refusé comme invisible, marques combinantes réduites à 4,
  ordre retrait → NFC → trim ; conteneurs de texte libre qui coupent le débordement (CLAUDE.md).

## Tester

876 e2e passent, 2 échouent. Les 3 échecs CA-11 du tour 1 passent pour de bonnes raisons ; les
deux modifications de ses tests par le builder sont justifiées (CL-3, ligne 96).

| ID / décision | Statut |
| -- | -- |
| CA-1 à CA-11, CL-1 à CL-11, cumul maximal de messages | ✅ |
| URL propre, Nouvelle réunion, `e` futur, plus de `maxlength`, Doto, invisibles et bidi | ✅ |
| Repli de copie à 1280×720 | ✅ |
| Repli de copie à 1093×614 et 960×600 (Total masqué, pas de fermeture) | ❌ 2 |
| Lighthouse | ⚠️ non testable ici |

## Reviewer

- **[Bloquant]** Repli de copie en superposition, non refermable : le passer dans un `<dialog>`.
- [Important] « Lien copié » reste affiché sans limite sur le ticket : le sortir de la pile.
- [Important] `v` inconnu : la réécriture efface le lien (perdu à la première montée de version).
- Mineurs : `showProposalError` partagé, `goTo(next, { push, focus })` pour les 3 transitions,
  `launch` qui lit encore le DOM, `ParsedLink.screen` et `firstId` inutilisés, `e` sans `s`
  silencieux, ticket qui déborde de 4 à 18 px sans élément focalisable.

## Security

Aucun point critique ou élevé. M2 du tour 1 (bidi) corrigé ; M1 corrigé pour les 17 caractères.

- **Moyen M1 bis** : U+FFFC passe `VISIBLE_CHAR` et ne s'affiche pas dans Chromium.
- **Moyen M2 bis** : la forme propre peut dépasser 4 Ko (`%FF` → `%EF%BF%BD`) : le lien copié est
  refusé au rechargement.
- **Moyen M3** : marques combinantes dessinées en largeur : un libellé peut barrer son propre montant
  et le titre peut élargir la page à 360 px.
- Info : NFC avant retrait rend la forme propre instable (retirer, puis NFC, puis trim).
