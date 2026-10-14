# Lookbook · Collection Paperasse AH26

> La page d'accueil de la collection, présentée comme le lookbook d'un défilé. Trois looks,
> chacun avec sa fiche.

## Contenu

- En-tête : « Collection Paperasse », « Automne-Hiver 2026 », la règle de la saison : « Trois
  documents officiels. Aucune valeur. Zéro inscription. »
- Trois cartes « Look 01 / 02 / 03 », chacune avec : nom de l'app, une phrase d'accroche, une
  fiche façon défilé (Matière, Coupe, Prix), un aperçu statique (capture ou illustration SVG),
  un lien vers l'app.
  - Look 01 · Réunion-mètre · Matière : papier thermique 80 mm · Coupe : en temps réel · Prix :
    0 € (mais la réunion, elle, coûte cher)
  - Look 02 · Juré Craché · Matière : papier vergé, cire · Coupe : notariale · Prix : un kebab,
    selon l'issue
  - Look 03 · Le SAV de ta vie · Matière : papier listing 132 colonnes · Coupe : en file
    d'attente · Prix : 0 €, SLA non garanti
- Pied de page : lien vers le repo GitHub, « Aucun cookie, aucun compte, aucun serveur. »,
  « Prochaine collection : bientôt. »

## Le `CollectionTag` (composant partagé, `packages/shared`)

Une étiquette de vêtement cousue en bas de chaque look :
« COLLECTION PAPERASSE · AH26 · LOOK 02/03 · suivant → ». Elle s'adapte au fond de chaque look
via deux custom properties (`--tag-bg`, `--tag-fg`) et reste un vrai `<nav aria-label="Collection">`
avec des liens. Le dernier look renvoie au lookbook.

## Critères d'acceptation

- **CA-1** Les trois liens mènent aux bonnes apps, en respectant `BASE_URL`.
- **CA-2** À 360 px, les cartes s'empilent ; à partir de 960 px, trois colonnes.
- **CA-3** Aucune ressource externe chargée (vérifié en e2e par interception réseau).
- **CA-4** Axe : zéro violation.
- **CA-5** Chaque look affiche un `CollectionTag` correct (testé depuis le lookbook en suivant
  les liens « suivant » jusqu'au retour au lookbook).

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
  punaisé ou scotché de travers, et en dessous une étiquette kraft trouée avec la fiche défilé ;
  post-its en pied de page.
- Les inclinaisons ne s'appliquent qu'aux aperçus et à l'affiche. Les fiches et les liens
  restent droits, pour la lisibilité.
- Maquette de référence : canvas Design « Projets débiles », artboard « Lookbook · Collection
  Paperasse (avis à la population) ».

## Décisions prises (à valider par Gonni)

- Pas de nom de domaine perso pour la v1 : `g0nni.github.io/collection-paperasse/`.
- Direction « tableau d'affichage de mairie » plutôt que lookbook blanc, demandée par Gonni le
  14/10/2026 (maquette à valider).
