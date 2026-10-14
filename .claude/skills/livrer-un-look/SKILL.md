---
name: livrer-un-look
description: Pipeline complet pour livrer un look de la Collection Paperasse (builder → tester → reviewer → security → corrections, jusqu'à la définition de « fini »). Lancer avec /livrer-un-look <dossier>, par ex. /livrer-un-look jure-crache.
argument-hint: <reunion-metre | jure-crache | sav-de-ta-vie | lookbook | tous>
disable-model-invocation: true
---

Tu orchestres la livraison du look `$ARGUMENTS`. Tu ne codes pas toi-même : tu délègues aux agents
et tu consignes leurs rapports.

Si l'argument est `tous`, lance le pipeline ci-dessous pour `reunion-metre`, `jure-crache` et
`sav-de-ta-vie` **en parallèle** (un builder par look, chacun dans son propre worktree avec
`isolation: worktree`), puis `lookbook` en dernier, une fois les trois autres finis.

## Pré-requis

1. `specs/$ARGUMENTS.md` existe et n'a pas de section « Questions ouvertes » non tranchée.
   Sinon : arrête-toi et liste les questions.
2. `pnpm install` et `pnpm verify` passent sur `main` avant de commencer. Sinon : arrête-toi et
   dis ce qui casse.
3. Crée la branche `look/$ARGUMENTS`.

## Boucle (3 tours maximum)

Pour chaque tour N :

1. **builder** : « Construis (tour 1) ou corrige (tours suivants) le look `$ARGUMENTS` selon
   `specs/$ARGUMENTS.md`. » Aux tours 2 et 3, passe-lui le contenu de `apps/$ARGUMENTS/REPORT.md`.
   Commit : `$ARGUMENTS: build tour N`.
2. **tester** : « Écris et lance les tests du look `$ARGUMENTS` à partir de sa spec. »
   Commit : `$ARGUMENTS: tests tour N`.
3. **reviewer** et **security**, en parallèle (ils ne modifient rien).
4. Écris `apps/$ARGUMENTS/REPORT.md` avec, dans cet ordre : verdict, rapport du tester (tableau de
   couverture), rapport du reviewer, rapport de security. Commit : `$ARGUMENTS: rapport tour N`.
5. Vérifie la définition de « fini » de `CLAUDE.md`, point par point, en lançant toi-même
   `pnpm verify`. Si tout est vrai : sors de la boucle.

## Fin

- **Fini** : ouvre une PR `look/$ARGUMENTS` → `main` avec le tableau de couverture et les verdicts
  dans la description. Ne merge pas.
- **Pas fini après 3 tours** : arrête-toi. En tête de `REPORT.md`, écris ce qui bloque et
  pourquoi le builder n'y arrive pas, puis ouvre la PR en brouillon.

Dans les deux cas, termine par un résumé de 5 lignes maximum : état, nombre de tests, points restants.
