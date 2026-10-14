# Look 01 · Réunion-mètre

> Un taximètre qui affiche en direct ce que coûte la réunion en cours, et sort un ticket de caisse
> à la fin. Tu balances le lien dans le chat de la réunion : tout le monde voit le même compteur.

## Écrans

1. **Configuration** (pas de paramètre `s` dans l'URL) : titre optionnel, tarif, participants,
   bouton « Lancer le compteur ».
2. **Compteur** (`s` présent, `e` absent) : montant qui tourne, durée, nombre de personnes,
   €/heure, tarif, liste des participants, ticket en cours à droite, bouton « Terminer ».
3. **Ticket** (`s` et `e` présents) : montant figé, ticket de caisse complet, boutons « Copier le
   lien du ticket » et « Nouvelle réunion ».

## Format d'URL (fait foi)

```
/reunion-metre/?v=1&t=B&p=68|Cheffe%20de%20projet&p=48|Kevin%20du%20marketing&p=6|Stagiaire&s=1760425200&n=Point%20rapide
```

| Param | Obligatoire | Format | Bornes | Défaut si invalide |
| ----- | ----------- | ------ | ------ | ------------------ |
| `v` | oui | entier | `1` uniquement | écran Configuration + message « Lien d'une version inconnue » |
| `t` | non | `A` \| `B` \| `C` | liste blanche | `A` |
| `p` | oui, répétable | `taux\|libellé`, un paramètre `p` par participant | 1 à 30 participants ; taux entier 0 à 1000 (€/h) ; libellé 1 à 40 caractères, nettoyé comme `n` | participant invalide ignoré ; 0 participant valide → Configuration |
| `s` | non | timestamp Unix en secondes, entier | 2020-01-01 ≤ s ≤ maintenant + 60 s | Configuration |
| `e` | non | timestamp Unix en secondes, entier | s < e ≤ s + 86 400 | ignoré (retour à l'écran Compteur) |
| `n` | non | texte | 0 à 60 caractères après trim, caractères de contrôle retirés | vide |

- **Chaque participant est libre** : on choisit son libellé (« Kevin du marketing ») et ce qu'il
  gagne de l'heure. `p` est le seul paramètre répétable ; pour tous les autres, on garde le
  premier (CL-7). Le séparateur est le premier `|` : un `|` dans le libellé reste du texte.
- Les libellés et le titre `n` sont les seuls textes libres. Ils sont affichés en `textContent`,
  jamais sous forme de lien.
- Tarifs : `A` « Point rapide » ×1 ; `B` « Sans ordre du jour » ×1,5 ; `C` « Aurait pu être un
  mail » ×2.
- `ROLES` : suggestions proposées dans le formulaire (un `<datalist>` sur le champ libellé, qui
  pré-remplit aussi le taux si le champ taux est vide). Elles ne sont jamais référencées dans
  l'URL. Liste (libellé, taux suggéré) : Cheffe de projet (68) · Dev qui code sous la table
  (48) · Responsable « transverse » (72) · Celui qui a la caméra coupée (51) · Stagiaire qui
  prend les notes (6) · Quelqu'un du juridique, au cas où (80) · Le N+2 qui « passe juste »
  (95) · Consultant externe (120) · Patrick (55).

## Calcul

- `coût = (fin − s) / 3600 × Σ taux × multiplicateur`, où `fin = e` si présent, sinon maintenant.
- Arrondi au centime à l'affichage uniquement. Format `Intl.NumberFormat('fr-FR', currency EUR)`.
- Lignes du ticket : « Café tiède × N » à 0,00 €, puis le coût réparti en Tour de table 32 %,
  « Tu m'entends, là ? » 14 %, Digression sur le parking 28 %, Récap de ce qui vient d'être dit
  26 %. La somme des lignes affichées doit être égale au total affiché (le reste d'arrondi va sur
  la dernière ligne). Puis « Décisions prises : 0 », « Aurait pu être un mail : OUI » (tarif C) ou
  « PEUT-ÊTRE » (A, B).

## Critères d'acceptation

- **CA-1** Sans paramètre, l'écran Configuration s'affiche avec 5 participants pré-remplis
  (les 5 premières suggestions) et le tarif B sélectionné. Chaque participant a deux champs
  étiquetés : « Qui » (libellé) et « €/heure » (taux), plus un bouton « Retirer ».
- **CA-2** « Lancer le compteur » met `s = maintenant` dans l'URL (via `history.replaceState`) et
  affiche le Compteur.
- **CA-3** Deux navigateurs qui ouvrent la même URL de Compteur affichent le même montant à
  ±0,01 € près, au même instant.
- **CA-4** Le montant se met à jour chaque seconde. Avec `prefers-reduced-motion`, aucune
  animation ni lueur, mais la mise à jour du chiffre continue.
- **CA-5** Changer le tarif, ajouter/retirer un participant, ou modifier son libellé ou son taux
  pendant le Compteur met l'URL à jour
  et recalcule tout depuis `s` (le montant peut sauter, c'est voulu : « tarif rétroactif »).
- **CA-6** « Terminer » ajoute `e = maintenant`, affiche le Ticket, et le montant ne bouge plus.
- **CA-7** « Copier le lien » copie l'URL courante complète ; confirmation visible et annoncée
  (`aria-live="polite"`) ; si l'API presse-papiers est refusée, le lien s'affiche dans un champ
  sélectionné.
- **CA-8** Le compteur a `role="timer"`, `aria-live="off"`, et un résumé accessible
  (« 247 euros et 80 centimes, 42 minutes ») mis à jour au plus toutes les 30 s.
- **CA-9** L'afficheur montre derrière les chiffres des « 8 » fantômes du même nombre de
  caractères que le montant.
- **CA-10** Le `CollectionTag` affiche « Look 01/03 » et mène au look suivant.

## Cas limites

- **CL-1** `s` dans le futur (> maintenant + 60 s) → Configuration + message « Cette réunion n'a
  pas encore commencé. Profitez-en. »
- **CL-2** Durée > 24 h sans `e` → le compteur s'arrête à 24 h et affiche « Réunion de plus de
  24 h. Respirez. »
- **CL-3** `e ≤ s` → `e` ignoré.
- **CL-4** 31 paramètres `p` ou plus → on garde les 30 premiers + message.
- **CL-5** Taux décimal, négatif, `1e3`, `NaN` ; `p` sans `|` ; libellé vide ou de plus de 40
  caractères après nettoyage → participant ignoré. Libellé avec du HTML → affiché tel quel, en texte.
- **CL-11** Deux participants avec le même libellé → autorisé (deux Kevin, ça arrive).
- **CL-6** Tous les taux à 0 → montant 0,00 € et message « Réunion bénévole. Suspect. »
- **CL-7** Paramètres en double (`?t=A&t=C`) → on prend le premier.
- **CL-8** Query de plus de 4 Ko → Configuration + message « Lien trop long ».
- **CL-9** Onglet en arrière-plan puis revenu → le montant est juste immédiatement (calcul depuis
  l'heure, jamais par incrément).
- **CL-10** Horloge de l'appareil décalée : rien à faire, on l'assume ; le ticket indique « heure
  de votre appareil ».

## Modèle de menace

- Textes libres : `n` (60 caractères) et les libellés des participants (40 caractères chacun,
  30 au plus). Affichés en `textContent`, caractères de contrôle et bidirectionnels
  (U+200E, U+200F, U+202A à U+202E, U+2066 à U+2069) retirés, jamais transformés en lien.
- Risque accepté : un lien forgé peut afficher un libellé trompeur (« Cliquez sur ce lien »). La
  parade est la longueur bornée et l'absence de lien cliquable ; on ne cherche pas à filtrer le
  sens des mots.
- Aucun paramètre ne finit dans un `href`, `src` ou `style`.
- Un lien ne peut pas geler la page : nombre d'entrées et durée bornés.

## Design (tokens)

- Fond `#16120E`, panneau `#211B15`, écran LED `#0B0907`, ambre `#FFB000`, ambre fantôme
  `rgba(255,176,0,0.09)`, texte `#F3E9D6`, labels `#A8977A`, papier ticket `#FAFAF7`, encre
  ticket `#1A1714`.
- Polices (fontsource) : Doto 900 pour tous les chiffres ; Archivo (variable, largeur 80 %) pour
  les labels en capitales espacées ; JetBrains Mono pour le ticket.
- Modules signature : afficheur LED avec chiffres fantômes ; enseigne « OCCUPÉ / LIBRE » façon
  lumineux de taxi (c'est le bouton Lancer/Terminer) ; ticket thermique à bord dentelé avec
  code-barres décoratif.
- Maquette de référence : canvas Design « Projets débiles », artboard « 5 · Réunion-mètre ».

## Décisions prises (à valider par Gonni)

- Pas de pause : un lien partagé ne peut pas apprendre une pause après coup, donc on l'enlève
  plutôt que d'avoir des compteurs qui divergent.
- Participants libres (libellé + taux), validé par Gonni le 14/10/2026. Les rôles drôles restent
  proposés comme suggestions.
