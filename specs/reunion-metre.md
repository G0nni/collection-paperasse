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
/reunion-metre/?v=1&t=B&p=68.0,48.1,72.2,51.3,6.4&s=1760425200&e=1760428800&n=Point%20rapide
```

| Param | Obligatoire | Format | Bornes | Défaut si invalide |
| ----- | ----------- | ------ | ------ | ------------------ |
| `v` | oui | entier | `1` uniquement | écran Configuration + message « Lien d'une version inconnue » |
| `t` | non | `A` \| `B` \| `C` | liste blanche | `A` |
| `p` | oui | liste `taux.rôle` séparée par `,` | 1 à 30 entrées ; taux entier 0 à 1000 ; rôle = index dans `ROLES` | entrée invalide ignorée ; 0 entrée valide → Configuration |
| `s` | non | timestamp Unix en secondes, entier | 2020-01-01 ≤ s ≤ maintenant + 60 s | Configuration |
| `e` | non | timestamp Unix en secondes, entier | s < e ≤ s + 86 400 | ignoré (retour à l'écran Compteur) |
| `n` | non | texte | 0 à 60 caractères après trim, caractères de contrôle retirés | vide |

- Les rôles ne sont **jamais du texte libre dans l'URL** : c'est un index dans une liste fixe
  `ROLES` définie dans le code. Ça empêche d'injecter un faux texte « officiel » dans la liste
  des participants. Le titre `n` est le seul texte libre et il est affiché en `textContent`.
- Tarifs : `A` « Point rapide » ×1 ; `B` « Sans ordre du jour » ×1,5 ; `C` « Aurait pu être un
  mail » ×2.
- `ROLES` (index → libellé, taux suggéré) : 0 Cheffe de projet (68) · 1 Dev qui code sous la table
  (48) · 2 Responsable « transverse » (72) · 3 Celui qui a la caméra coupée (51) · 4 Stagiaire qui
  prend les notes (6) · 5 Quelqu'un du juridique, au cas où (80) · 6 Le N+2 qui « passe juste »
  (95) · 7 Consultant externe (120) · 8 Patrick (55). L'ordre ne change jamais (les vieux liens en
  dépendent) ; on ajoute seulement à la fin.

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
  (rôles 0 à 4) et le tarif B sélectionné.
- **CA-2** « Lancer le compteur » met `s = maintenant` dans l'URL (via `history.replaceState`) et
  affiche le Compteur.
- **CA-3** Deux navigateurs qui ouvrent la même URL de Compteur affichent le même montant à
  ±0,01 € près, au même instant.
- **CA-4** Le montant se met à jour chaque seconde. Avec `prefers-reduced-motion`, aucune
  animation ni lueur, mais la mise à jour du chiffre continue.
- **CA-5** Changer le tarif ou ajouter/retirer un participant pendant le Compteur met l'URL à jour
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
- **CL-4** `p` avec 31 entrées ou plus → on garde les 30 premières + message.
- **CL-5** Taux décimal, négatif, `1e3`, `NaN`, rôle inexistant → entrée ignorée.
- **CL-6** Tous les taux à 0 → montant 0,00 € et message « Réunion bénévole. Suspect. »
- **CL-7** Paramètres en double (`?t=A&t=C`) → on prend le premier.
- **CL-8** Query de plus de 4 Ko → Configuration + message « Lien trop long ».
- **CL-9** Onglet en arrière-plan puis revenu → le montant est juste immédiatement (calcul depuis
  l'heure, jamais par incrément).
- **CL-10** Horloge de l'appareil décalée : rien à faire, on l'assume ; le ticket indique « heure
  de votre appareil ».

## Modèle de menace

- Texte libre : seulement `n`, 60 caractères, `textContent`, caractères de contrôle et
  bidirectionnels (U+202A à U+202E, U+2066 à U+2069) retirés.
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
- Pas de nom de participant libre (voir Modèle de menace). Les rôles drôles sont une liste fixe.
