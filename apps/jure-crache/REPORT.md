# Rapport jure-crache · tour 1

## Verdict

**Pas fini.** 1 bloquant (reviewer : impression d'un acte long, CA-6 et CA-8), 0 critique ou élevé
(security : 2 moyens). 3 tests e2e en échec, tous sur CA-6.

Décisions de l'orchestrateur à l'issue du tour (spec, commit « rapport tour 1 ») :

- Acte jugé : « Verdict déclaré. Échéance du pari : … », sans date de verdict (le lien n'en porte
  pas ; « Jugé le <échéance> » inventait une date).
- Numéro d'acte sur 64 bits (`N° AAAA-XXXX-XXXX-XXXX-XXXX`) : à 32 bits, forger un autre acte au
  même numéro coûtait de quelques secondes à quelques minutes (security).
- 4 Ko décodés mesurés en unités UTF-16 : un acte d'emoji aux bornes n'est plus refusé.
- Impression : une page A4 par construction (plafond de hauteur par texte libre, coupé au-delà),
  pas de page blanche, pied d'acte répété en marge de chaque page (`@page`).
- Actés : forme propre réécrite, Rédaction J+7 20 h, boutons ajoutés, année UTC.

## Tester

| ID | Statut |
| -- | -- |
| CA-1 à CA-5, CA-7 à CA-11 | ✅ |
| CA-6 impression (idéogrammes aux bornes : 2 pages dont une blanche ; jugé match nul : 3 pages ; U+FDFD forgé : 3 pages dont une tamponnée sans pied) | ❌ 3 |
| CL-1 à CL-8 | ✅ |
| Lighthouse | ⚠️ non testable ici |

Trous de spec relevés : bornes en points de code contre 4 Ko en octets, graphèmes contre points
de code, numéro qui change sans différence visible (voulu, CA-3), « 10 ans » calendaire, formes de
hash `#abc`, `#0.x`, `#1..p`, CL-6 à l'impression (bandeau masqué), écran pour un acte refusé.

Durcissements proposés : bombe de décompression des tests réduite à 200 000 caractères ; moins de
workers e2e (tests de géométrie lents sous charge).

## Reviewer

- **[Bloquant]** CA-6/CA-8 : retirer `break-inside: avoid`, masquer `.top` et le `gap` en impression,
  plafond `max-height: calc(N * 1lh)` + `overflow: clip` par texte libre, test sous
  `emulateMedia print`.
- [Important] « Jugé le … » affirme une date inconnue (tranché ci-dessus).
- [Important] 4 Ko en octets UTF-8 refuse des actes valides (tranché : unités UTF-16).
- [Important] « Acte trop long pour tenir dans un lien » non relié à un champ, sans focus, sans test.
- [Important] Numéro 32 bits + marges invisibles (ms de `t`/`d`, U+200B) : collision en ~2^32.
- Mineurs : `print` → `fingerprintHex` ; type discriminé pour l'erreur d'horloge ; `MAX` limité aux
  textes ; palette en double et non testée au rendu ; `renderedHash` avant l'`await` ;
  `copy-dialog` lu deux fois ; doublon « Nouvel acte » sur l'écran de refus ; `dom.ts` à mettre dans
  shared ; découpage d'`app.ts` ; heure inexistante au passage à l'heure d'été acceptée.
- Factorisation `copy.ts`/`ticker.ts` correcte ; réexports du Réunion-mètre à supprimer, test en
  double, commentaire qui cite un look.

## Security

Aucun point critique ou élevé. Puits, prototype, parseurs, bombe de décompression (ratio max
168:1, rejet immédiat), 300 `hashchange`, CSP et dépendances : rien à signaler.

- **Moyen** : numéro sur 32 bits, collision ciblée en secondes à minutes (tranché : 64 bits).
- **Moyen** : impression multi-pages d'un acte forgé ; pied non répété (tranché : `@page`).
- Info : homoglyphes inter-écritures (« Sam » / « Ѕаm ») non assimilés par CL-4.
