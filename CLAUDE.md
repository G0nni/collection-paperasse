# Collection Paperasse · AH26

Collection de 3 mini-apps web absurdes, livrées ensemble. Chaque app (un « look ») est la parodie
d'un document administratif français qui n'a aucune valeur réelle.

| Look | App | Dossier | Parodie de | État stocké dans |
| ---- | --- | ------- | ---------- | ---------------- |
| 01 | Réunion-mètre | `apps/reunion-metre` | taximètre + ticket de caisse | l'URL (query) |
| 02 | Juré Craché | `apps/jure-crache` | acte notarié | l'URL (hash, compressé) |
| 03 | Le SAV de ta vie | `apps/sav-de-ta-vie` | ticket de helpdesk sur papier listing | localStorage |
| — | Lookbook | `apps/lookbook` | lookbook de défilé | rien |

La spec de chaque app est dans `specs/`. **La spec fait foi** : si le code et la spec divergent,
on corrige le code, ou on modifie la spec explicitement dans le même commit, en le disant.

## Règles de la collection (non négociables)

1. **Zéro inscription, zéro backend, zéro tracking.** Pas de compte, pas d'API, pas d'analytics,
   pas de cookie, aucune requête réseau vers un tiers au runtime (polices incluses : elles sont
   auto-hébergées via `@fontsource`).
2. **Un lien suffit.** Tout ce qui se partage tient dans l'URL. Ouvrir le lien sur un autre appareil
   donne exactement le même écran.
3. **Toute donnée venant de l'URL ou du localStorage est hostile** tant qu'elle n'est pas validée
   (voir Sécurité).
4. **Chaque look garde son propre style.** Seuls l'étiquette de collection (`CollectionTag`) et
   les utilitaires de `packages/shared` sont communs. Les tokens de design de chaque look sont
   dans sa spec.
5. **Drôle, mais utilisable.** L'humour est dans les textes et la mise en scène, jamais au prix de
   l'accessibilité ou de la lisibilité.

## Stack

- pnpm workspaces, Node ≥ 22.12, TypeScript 6 en mode `strict` (TS 7 n'est pas encore supporté
  par `@astrojs/check`).
- Astro 7, sortie **100 % statique** (`output: 'static'`). Aucun adaptateur serveur.
- **Pas de framework UI.** L'interactivité se fait en TypeScript vanilla dans des `<script>`
  Astro. La logique métier vit dans des modules purs (`src/lib/*.ts`) sans accès au DOM, testés
  unitairement. Le code DOM se contente de lire l'état, appeler la logique, afficher.
- CSS : styles scopés Astro + custom properties. Pas de Tailwind, pas de lib de composants.
- Tests : Vitest (logique pure) + Playwright (e2e, accessibilité avec `@axe-core/playwright`).
- Lint : ESLint 10 (flat config) + typescript-eslint + eslint-plugin-astro, Prettier.

## Commandes

```bash
pnpm install
pnpm dev --filter reunion-metre   # dev d'une app
pnpm build                        # build de production (CSP limitée au préfixe Pages) + site/
pnpm build:e2e                    # même build, CSP limitée à http://127.0.0.1:4321 (PAPERASSE_ORIGIN)
pnpm check                        # astro check + tsc sur tout le monorepo
pnpm lint                         # eslint + prettier --check
pnpm test                         # vitest sur tout le monorepo
pnpm test:e2e                     # playwright sur site/ : exige pnpm build:e2e avant
pnpm audit --prod                 # audit des dépendances
pnpm verify                       # check + lint + test + build:e2e + test:e2e : la porte de sortie
```

## Déploiement

GitHub Pages, un seul déploiement. `scripts/assemble.mjs` copie le build de chaque app dans
`site/` : le lookbook à la racine, chaque look dans son sous-dossier
(`/collection-paperasse/reunion-metre/`…). Chaque app définit `base` en conséquence.
Les liens d'une app vers elle-même passent par `import.meta.env.BASE_URL` ; les liens entre apps
(lookbook ↔ looks) passent par `baseFor()` de `packages/shared/src/config.ts`, puisque chaque app
a sa propre base. Jamais de chemin absolu en dur.

## Sécurité

Le modèle de menace est court mais sérieux : **quelqu'un forge un lien et l'envoie à une victime.**

- Parser chaque paramètre avec un validateur explicite (`packages/shared/src/url.ts`) : type,
  bornes, longueur max, liste blanche. Valeur invalide → valeur par défaut + message visible,
  jamais d'exception non gérée ni d'écran blanc.
- **Jamais `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`,
  `new Function`** avec une donnée utilisateur. On écrit le texte avec `textContent`.
  ESLint l'interdit (`no-restricted-properties` / `no-restricted-syntax`).
- Jamais de donnée utilisateur dans un `href`, un `src` ou un attribut `style`.
- Config Astro commune : `lookConfig()` de `packages/shared/src/look-config.ts` (CSP, base,
  `assetsInlineLimit: 0` pour que les petites polices ne soient pas inlinées en `data:`).
  Scripts, styles, polices et images ne sont autorisés que sous le préfixe de la collection
  (sur `g0nni.github.io`, `'self'` couvrirait tous les repos Pages du compte).
- CSP activée via `security.csp` d'Astro (meta tag avec hashes). Conséquence : **pas d'attribut
  `style="…"` dans le HTML** ; les valeurs dynamiques passent par
  `element.style.setProperty('--var', …)` ou par des classes.
- Taille max du hash/query décodé : 4 Ko. Au-delà, on refuse proprement.
- localStorage : lecture dans un `try/catch`, données validées comme une URL, versionnées
  (`{ v: 1, … }`), avec migration ou remise à zéro si la version est inconnue.
- Pas de dépendance ajoutée sans raison écrite dans le message de commit.
- Aucun caractère invisible ou bidirectionnel littéral dans le code (`pnpm lint` le vérifie) :
  écris `String.fromCodePoint(0x202e)` ou un échappement `\u…` à la place.

## Accessibilité et qualité

- Vrais éléments : `<button>`, `<a href>`, `<label>` + `<input>`. Cibles tactiles ≥ 44 px.
- Contraste texte ≥ 4.5:1 (3:1 au-delà de 24 px). Ne jamais distinguer deux états par la couleur seule.
- Tout ce qui bouge respecte `prefers-reduced-motion`. Les compteurs live ont `aria-live="off"`
  et un résumé accessible mis à jour au plus toutes les 30 s.
- Fonctionne à 360 px de large sans scroll horizontal.
- Langue : `lang="fr"`. Les textes sont en français, avec des espaces insécables avant `: ; ! ?`
  et `«  »`. Montants : `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })`.
- Budget : < 50 Ko de JS par page (gzip), Lighthouse ≥ 95 sur les 4 axes.

## Style de code

- Fonctions pures et petites ; pas de classes sauf besoin réel. Pas d'abréviations obscures.
- Noms de code en anglais, textes d'interface en français.
- Pas de `any`, pas de `as` pour faire taire le compilateur, pas de `// @ts-ignore`.
- Les commentaires expliquent le pourquoi, pas le quoi.
- Pas de tiret cadratin (—) dans les textes d'interface : Gonni n'en veut pas.

## Définition de « fini » pour un look

Un look est fini quand **tout** ceci est vrai :

1. Chaque critère d'acceptation de sa spec est couvert par au moins un test, et le test passe.
2. Chaque cas limite listé dans la spec a un test (unitaire ou e2e).
3. `pnpm verify` passe en entier.
4. L'agent `reviewer` n'a plus de point « bloquant ».
5. L'agent `security` n'a plus de point « critique » ou « élevé ».
6. Axe ne remonte aucune violation sur les écrans de la spec.

## Workflow avec les agents

Agents dans `.claude/agents/`. Le pipeline complet se lance avec `/livrer-un-look <dossier>`.

1. `builder` construit le look à partir de sa spec (un builder par look, en parallèle possible,
   chacun dans son worktree).
2. `tester` écrit les tests manquants à partir de la spec, sans regarder l'implémentation d'abord.
3. `reviewer` relit le diff par rapport à ce fichier et à la spec. Il ne modifie rien.
4. `security` attaque le look (liens forgés, données corrompues, dépendances). Il ne modifie rien.
5. Le `builder` corrige. On reboucle 2 → 5 jusqu'à la définition de « fini », 3 tours maximum ;
   au-delà, on s'arrête et on écrit ce qui bloque dans `REPORT.md` du look.

`reviewer` et `security` ne peuvent rien écrire : c'est la session principale qui consigne
leurs rapports dans `apps/<look>/REPORT.md` (écrasé à chaque tour, historique dans git). Un commit par étape, message en français, préfixé par le look : `jure-crache: …`.
