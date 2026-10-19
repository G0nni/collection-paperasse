# Rapport jure-crache · tour 2

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
