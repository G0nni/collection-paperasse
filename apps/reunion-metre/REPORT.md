# Rapport reunion-metre · tour 3 (dernier tour)

## Ce qui bloque

**Pas fini après 3 tours, à cause d'un seul défaut, dans le look livré :** sur l'écran Compteur,
entre 640 et environ 1100 px de large, la liste des participants passe en deux colonnes et les
champs « Qui » ne montrent que 3 à 10 lettres (« Che », « Kev », « Sta » à 960 px). Les noms ne sont
lisibles nulle part ailleurs sur cet écran. C'est l'usage principal (Compteur en demi-écran à
côté du chat) et la règle 5 de CLAUDE.md. 2 tests e2e en échec (960×1000, 1024×768).

Correction connue et essayée par le reviewer : choisir le nombre de colonnes selon la largeur de
la liste (container query, deux colonnes seulement au-delà de 50rem de liste). Résultat mesuré :
une colonne et noms entiers de 640 à 1270 px, deux colonnes et CA-11 tenu à 1280×720.

**Pourquoi pas corrigé dans les 3 tours** : le défaut n'est apparu qu'au tour 3, quand le tester
a élargi les tailles d'écran (demi-écran 960 px). Ce n'est pas une boucle qui diverge : chaque
tour a fermé tous les bloquants du tour précédent.

Tout le reste est fermé : CA-1 à CA-11 et CL-1 à CL-11 verts, reviewer sans autre bloquant,
security sans point critique ou élevé.

## Tester

987 e2e passent, 2 échouent ; 187 unitaires. Les 2 échecs du tour 2 passent pour de bonnes
raisons ; l'adaptation de son test CA-11 au dialogue modal est justifiée (spec lignes 24-26).

| ID / décision | Statut |
| -- | -- |
| CA-1 à CA-11, CL-1 à CL-11 | ✅ |
| Dialogue de copie (modal, champ sélectionné, Fermer, Échap, focus rendu), statut hors ticket | ✅ |
| `v` inconnu non réécrit, forme propre > 4 Ko refusée, `e` sans `s` signalé, notices | ✅ |
| Zalgo plafonné, débordements coupés, ticket du Compteur sans débordement (3 tailles) | ✅ |
| Règle 5 : noms lisibles sur le Compteur à 960×1000 et 1024×768 | ❌ 2 |
| Lighthouse | ⚠️ non testable ici |

Trous de spec : `v` absent traité comme inconnu, « Lien copié » qui reste affiché après une
modification, bouton qui se décale quand le statut apparaît, pas d'exigence entre 360 et 1280 px.

## Reviewer

Points du tour 2 tous fermés ; `capCombiningMarks` correct.

- **[Bloquant]** Noms illisibles sur le Compteur de 640 à ~1100 px (container query proposée).
- [Important] « Lien copié » reste affiché après un changement de lien (le presse-papiers contient
  l'ancien) : effacer le statut dans `updateMeeting`.
- [Important] Boucle de 200 001 itérations dans `tester.test.ts:44` : 3,1 s seule, dépasse 5 s sous
  charge (échec aléatoire de `pnpm verify`).
- [Important] Test « Règle 5 » à étendre (640, 768, 1093, 1100, contrôle à 1280).
- Mineurs : largeur réservée au statut (boutons qui se décalent), `aria-describedby` sur le
  dialogue, coche du statut lue par les lecteurs d'écran.

## Security

Aucun point critique ou élevé. M1 bis, M2 bis et M3 fermés (fuzz de 300 000 chaînes : forme propre
idempotente, jamais plus de 4 marques ; pire expansion NFC couverte par le contrôle final).

- **Moyen M4** : un demi-surrogate collé dans un champ lève « URI malformed » (non déclenchable par
  un lien) : retirer `\p{Cs}` dans `sanitizeText` ou `toWellFormed()`.
- Info : alternance marques / ZWJ (dessinées à côté, contenues) ; hash du vide dans `style-src`.
