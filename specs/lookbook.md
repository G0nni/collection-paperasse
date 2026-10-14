# Lookbook · Collection Paperasse AH26

> La page d'accueil de la collection, présentée comme le lookbook d'un défilé. Trois looks,
> chacun avec sa fiche.

## Contenu

- En-tête : « Collection Paperasse », « Automne-Hiver 2026 », la règle de la saison : « Trois
  documents officiels. Aucune valeur. Zéro inscription. »
- Trois cartes « Look 01 / 02 / 03 », chacune avec : nom de l'app, une phrase d'accroche, une
  fiche façon défilé (Matière, Coupe, Prix), un aperçu statique en HTML/CSS (une miniature du document du look, `role="img"` avec un nom
  accessible),
  un lien vers l'app.
  - Look 01 · Réunion-mètre · Matière : papier thermique 80 mm · Coupe : en temps réel · Prix :
    0 € (mais la réunion, elle, coûte cher)
  - Look 02 · Juré Craché · Matière : papier vergé, cire · Coupe : notariale · Prix : un kebab,
    selon l'issue
  - Look 03 · Le SAV de ta vie · Matière : papier listing 132 colonnes · Coupe : en file
    d'attente · Prix : 0 €, SLA non garanti
- Deux post-its : jaune « Prochaine collection : bientôt. » et bleu « Aucun cookie, aucun compte,
  aucun serveur. » avec le lien vers le repo GitHub. Dans le HTML, ils viennent **après** les
  looks (ordre de lecture et de tabulation), même quand ils s'affichent sur les côtés.

## Disposition (fait foi)

| Largeur | Affiche | Looks | Post-its |
| -- | -- | -- | -- |
| ≥ 1000 px | bandeau centré, titre sur une ligne | 3 colonnes | jaune à gauche, bleu à droite de l'affiche |
| 640 à 999 px | pleine largeur | 2 colonnes (le 3e seul sur la ligne suivante) | côte à côte, sous les looks |
| < 640 px | pleine largeur, titre sur deux lignes possible | 1 colonne | l'un sous l'autre, sous les looks |

- **À 1280×720, toute la page tient sans défilement vertical** (affiche, 3 looks avec leur fiche
  complète Matière / Coupe / Prix, post-its). L'affiche est un bandeau compact (environ 160 px de
  haut) ; si la place manque, on réduit d'abord la hauteur des aperçus, jamais les fiches.
- En dessous de 1000 px, défiler est normal.

## Le `CollectionTag` (composant partagé, `packages/shared`)

Une étiquette de vêtement cousue en bas de chaque look (pas sur le lookbook, qui est la racine).
Texte exact, avec des « · » visibles entre les blocs :

- looks 01 et 02 : `COLLECTION PAPERASSE · AH26 · LOOK 01/03 · Suivant : Juré Craché →`
- look 03 : `COLLECTION PAPERASSE · AH26 · LOOK 03/03 · Retour au lookbook →`

« Collection Paperasse · AH26 » est un lien vers le lookbook, le dernier bloc est un lien vers le
look suivant. Espace insécable avant « : ». L'étiquette s'adapte au fond de chaque look via deux
custom properties (`--tag-bg`, `--tag-fg`) et reste un vrai `<nav aria-label="Collection">`.

## Critères d'acceptation

- **CA-1** Les trois liens mènent aux bonnes apps, en respectant `BASE_URL`.
- **CA-2** Les looks et les post-its suivent le tableau « Disposition » aux trois largeurs
  (testé à 360, 800 et 1280 px).
- **CA-3** Aucune ressource externe chargée (vérifié en e2e par interception réseau).
- **CA-4** Axe : zéro violation.
- **CA-5** Chaque look affiche un `CollectionTag` correct (testé depuis le lookbook en suivant
  les liens « suivant » jusqu'au retour au lookbook).
- **CA-6** À 1280×720, aucun défilement vertical : `scrollHeight ≤ innerHeight`, polices chargées.
- **CA-7** L'ordre de tabulation suit l'ordre du HTML : affiche, looks 01 à 03, puis le lien GitHub.

## Design (tokens)

Concept : **le tableau d'affichage de la mairie**. Un panneau en liège sur lequel sont punaisés
l'affiche « Avis à la population » et les trois documents de la collection.

- Liège `#C38F55` avec texture en points (deux `radial-gradient` superposés), affiche jaune
  `#FFE45C`, encre `#1B1B1B`, rouge tampon `#B3261E`, étiquettes kraft `#EAD3A2`, numéros de look
  `#C2410C` (uniquement en très grand, ≥ 34 px), post-it bleu `#A7E0F2`.
- Polices (fontsource) : Alfa Slab One (titres façon affiche en caractères bois, numéros de
  look) ; JetBrains Mono (texte, fiches). Les aperçus de chaque look reprennent les polices de
  ce look (Doto, Young Serif, Courier Prime), chargées uniquement sur cette page.
- Modules signature : affiche « Avis à la population » légèrement inclinée avec deux punaises et
  un tampon ENTRÉE LIBRE ; chaque look = un aperçu de son document (ticket, acte, listing)
  punaisé ou scotché de travers, et en dessous une étiquette kraft trouée avec la fiche défilé
  (numéro et nom du look sur la même ligne) ; post-its de part et d'autre de l'affiche.
- Les inclinaisons s'appliquent aux aperçus, à l'affiche et aux post-its (comme sur la maquette).
  Les étiquettes kraft (fiches) et les boutons restent droits, pour la lisibilité. Les post-its
  sont en Courier Prime, comme sur la maquette.
  Le lien GitHub posé sur un post-it penche avec lui.
- Un aperçu peut contenir un SVG inline décoratif (le sceau de l'acte), en `aria-hidden`.
- Insécable : U+00A0 partout (pas d'espace fine U+202F), pour un seul cas à tester.
- Maquette de référence : canvas Design « Projets débiles », artboard « Lookbook · tout sur un
  écran (1280×720) ». L'artboard « Lookbook · Collection Paperasse (avis à la population) » est la
  version précédente, gardée pour comparaison.

## Décisions prises (à valider par Gonni)

- Pas de nom de domaine perso pour la v1 : `g0nni.github.io/collection-paperasse/`.
- Direction « tableau d'affichage de mairie » plutôt que lookbook blanc, demandée par Gonni le
  14/10/2026, maquette validée le même jour.
- Version « tout sur un écran » (bandeau compact, post-its sur les côtés puis dessous, fiches
  complètes), validée par Gonni le 14/10/2026.
