# Rapport jure-crache · tour 3 (final)

## Verdict

**Fini.** Les 6 points de la définition de « fini » sont vrais :

1. CA-1 à CA-11 couverts et verts.
2. CL-1 à CL-9 couverts et verts.
3. `pnpm verify` vert au build du tour 3 (1717 e2e, 225 sautés volontairement), tests du tester
   ajoutés ensuite verts (867 e2e desktop jure-crache + reunion-metre) ; confirmé par la CI.
4. Reviewer : « Prêt » (0 bloquant).
5. Security : aucun point critique ou élevé ; le moyen du tour 2 (collision préparée à 64 bits)
   est fermé par le numéro sur 128 bits.
6. Axe : 0 violation.

Tour 3 : numéro sur 128 bits en base32 Crockford (200 000 empreintes contre un oracle
indépendant, sans écart ni biais), « 1er », pied en marge limité aux pages de l'acte, échéance
discriminée, `pdf.ts` durci, `trapFocus` dans le copieur partagé (testé sur les deux looks).

Restent ouverts (non bloquants) :
- `seal.ts:97` utilise un lookbehind dans une regex (Safari < 16.4 : module entier en panne) ;
  correction en une ligne proposée par le reviewer.
- Règle `white-space: normal` inutile et commentaire inexact sur les `<wbr>` (`index.astro:940`).
- Découpage d'`app.ts` (561 lignes).
- Télémétrie d'`astro build` (outil de build, pas le site) : `ASTRO_TELEMETRY_DISABLED=1` proposé.
- Décision 128 bits à confirmer par Gonni ; Lighthouse non mesuré ici.

---

# Historique : tour 2

## Verdict

**Fini au sens de CLAUDE.md** (tester sans échec, reviewer « Prêt », security sans critique ni
élevé, `pnpm verify` vert au build du tour 2). Un tour 3 court est lancé pour un point Important
du reviewer et un point Moyen de security qui touchent le livrable :

- dates « 1 janvier » au lieu de « 1er janvier » dans l'acte ;
- numéro sur 64 bits : un auteur peut préparer deux versions au même numéro en ~2^32 calculs
  (paradoxe des anniversaires, via les millisecondes invisibles de `t` et `d` ou des invisibles
  conservés). Décision : 128 bits en base32 Crockford (spec, à confirmer par Gonni).

Spec précisée (commit « rapport tour 2 ») : A4 seul garanti, pied en marge limité aux pages de
l'acte, CL-9 (lien trop long d'un acte dans les bornes), heure double en octobre, « 1er ».

## Tester

Aucun échec. Les 3 échecs CA-6 du tour 1 passent pour de bonnes raisons (une page, aucun texte
légitime coupé, pied deux fois sur la page) ; modifications de ses tests par le builder
justifiées (lignes 14, 41, 49). Trous : heure double, « 1 janvier », Letter, refus « lien trop
long » dans les bornes. Durcissements : `pdf.ts` (drapeaux, positions).

## Reviewer

Tous les points du tour 1 fermés sauf le découpage d'`app.ts` (547 lignes). Verdict : Prêt.

- [Important] « 1 janvier » au lieu de « 1er janvier » (`format.ts`), test qui fige la faute.
- Mineurs : `draft.ts` (défaut de déstructuration, sentinelle `"nonexistent"`), `@page` qui
  imprime une page vide avec pied sur la Rédaction et les refus (page nommée),
  `overflow-clip-margin` à 0 en impression, fragilités de `pdf.ts` (Length indirecte, `endobj`
  absent, racine `/Pages`), `trapFocus` à appliquer au repli de copie partagé (Réunion-mètre).

## Security

Aucun critique ou élevé. Forme propre et numéro toujours cohérents (20 000 actes piégés),
impression sans débordement à la lecture du code, 4 Ko en UTF-16 sans risque, CSP et
dépendances sains.

- **Moyen** : collision préparée par l'auteur à 64 bits (décision : 128 bits).
- Info : homoglyphes inter-écritures.
