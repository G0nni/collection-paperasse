# Collection Paperasse · Automne-Hiver 2026

Trois documents officiels. Aucune valeur. Zéro inscription.

| Look | App | Le principe |
| ---- | --- | ----------- |
| 01 | **Réunion-mètre** | Un taximètre qui affiche en direct ce que coûte la réunion. Un lien, tout le monde voit le même compteur. |
| 02 | **Juré Craché** | Un acte notarié pour vos paris entre potes. Si quelqu'un trafique le lien, le numéro d'acte change. |
| 03 | **Le SAV de ta vie** | Un helpdesk pour vos problèmes perso. Support niveau 1 : vous. |

Pas de compte, pas de serveur, pas de cookie, pas de tracking. Tout tient dans l'URL ou dans votre
navigateur.

## Développer

```bash
pnpm install
pnpm dev          # toutes les apps en dev
pnpm build        # build de production (CSP limitée à https://g0nni.github.io/collection-paperasse/)
pnpm build:e2e    # même build, CSP limitée au serveur de test http://127.0.0.1:4321/collection-paperasse/
pnpm test:e2e     # e2e sur site/ : exige un site/ issu de pnpm build:e2e
pnpm verify       # check + lint + tests + build:e2e + e2e
```

La CSP n'autorise scripts, styles, polices et images que sous le préfixe de la collection. Ce
préfixe est fixé au build par la variable `PAPERASSE_ORIGIN` (origine seule, sans chemin) :
absente, c'est la production ; `pnpm build:e2e` la fixe à `http://127.0.0.1:$PORT` (4321 par
défaut) pour que les e2e testent la vraie CSP. Le déploiement lance `pnpm build`, jamais
`build:e2e`.

Les règles du projet sont dans [`CLAUDE.md`](CLAUDE.md), la spec de chaque app dans [`specs/`](specs/).

## Structure

```
apps/lookbook        page d'accueil de la collection
apps/reunion-metre   look 01
apps/jure-crache     look 02
apps/sav-de-ta-vie   look 03
packages/shared      étiquette de collection, validation d'URL et de texte, config commune
specs/               une spec par app : elle fait foi
tests/e2e            garde-fous communs + tests e2e de chaque look
.claude/             agents (builder, tester, reviewer, security) et skill /livrer-un-look
```
