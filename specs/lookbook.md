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

- Blanc `#FFFFFF`, noir `#0E0E0E`, un seul accent : orange signalétique `#E8590C` (utilisé
  uniquement pour les numéros de look, jamais en texte courant sur fond blanc).
- Polices (fontsource) : Bodoni Moda (titres éditoriaux, très grands) ; JetBrains Mono (fiches).
- Modules signature : numéros de look géants qui débordent de la carte ; fiches techniques en
  tableau à filets fins ; étiquette de collection cousue (points de couture en pointillés).

## Décisions prises (à valider par Gonni)

- Pas de nom de domaine perso pour la v1 : `g0nni.github.io/collection-paperasse/`.
