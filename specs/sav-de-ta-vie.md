# Look 03 · Le SAV de ta vie

> Un helpdesk pour tes problèmes perso, imprimé sur du papier listing. Support niveau 1 : toi.
> Niveau 2 : toi, mais fatigué. C'est une vraie to-do list, déguisée en parodie de logiciel de
> tickets.

## Écrans

1. **File d'attente** : en-tête avec compteurs (Ouverts, En retard, Résolus), tableau des tickets
   sur papier listing, bouton « Nouveau problème ».
2. **Détail d'un ticket** (panneau à droite sur desktop, plein écran sur mobile) : formulaire
   façon liasse carbone, tampon de priorité, historique, actions.
3. **Nouveau problème** : `<dialog>` avec objet, priorité, catégorie.

L'URL ne contient que l'identifiant du ticket ouvert (`#t-4021`), jamais son contenu.

## Données (fait foi)

Clé localStorage : `collection-paperasse:sav:v1` (préfixée, car tout `G0nni.github.io` partage le
même origine).

```ts
type Store = { v: 1; nextId: number; examplesDismissed: boolean; tickets: Ticket[] };
type Ticket = {
  id: number;                 // ≥ 1000, unique
  subject: string;            // 1 à 120 caractères
  priority: 'critique' | 'haute' | 'moyenne' | 'basse';
  category: 'logistique' | 'administratif' | 'social' | 'menage' | 'sante-du-frigo' | 'divers';
  status: 'ouvert' | 'en-attente' | 'rouvert' | 'resolu' | 'wont-fix' | 'contourne';
  createdAt: number;          // ms Unix
  updatedAt: number;
  postponed: number;          // nombre de « Reporter à demain », 0 à 9999
  reopened: number;           // 0 à 9999
  example: boolean;           // ticket de démonstration
  log: { at: number; text: string }[]; // 0 à 50 entrées, text 1 à 160, les plus anciennes sautent
};
```

- 500 tickets maximum. Au-delà : « File d'attente saturée. Comme dans la vraie vie. » et
  création bloquée.
- Lecture : `try/catch`, puis validation champ par champ. Un ticket invalide est écarté (et
  compté dans un message discret « N tickets illisibles ont été écartés »), jamais d'écran blanc.
- Version inconnue → proposer d'exporter le contenu brut puis de repartir de zéro.
- Synchronisation multi-onglets via l'événement `storage`.

## Règles métier

- SLA par priorité : critique 4 h, haute 1 jour, moyenne 7 jours, basse 30 jours, depuis
  `createdAt`. « En retard » = statut ouvert, en-attente ou rouvert et SLA dépassé.
- Tri par défaut « par culpabilité » : en retard d'abord, puis priorité, puis le plus ancien.
- Libellés de statut : Ouvert · En attente (de toi) · Rouvert · Résolu · Ne sera pas corrigé ·
  Contourné.
- Chaque action ajoute une ligne à l'historique, avec un texte drôle tiré d'une liste fixe par
  action (pas de hasard non reproductible dans les tests : le choix dépend de `id + nombre
  d'entrées`).
- Actions :
  - « Clôturer sans rien faire » → `wont-fix`, log « Clôturé par lassitude ».
  - « Reporter à demain » → `en-attente`, `postponed + 1`, log « Reporté à demain (pour la
    N-ième fois) ».
  - « C'est réglé » → `resolu`.
  - « Ça recommence » (sur un ticket résolu) → `rouvert`, `reopened + 1`.
  - « Contourner » → `contourne`, log « Problème contourné. Il est toujours là. »
  - « Supprimer » → confirmation, puis suppression définitive.
- Premier lancement : 7 tickets d'exemple (ceux de la maquette), avec un bandeau « Ce sont des
  exemples. Vider les exemples ». Une fois vidés, ils ne reviennent pas (`examplesDismissed`).

## Export / import

- « Exporter » télécharge `sav-de-ta-vie-AAAA-MM-JJ.json` (le `Store` tel quel).
- « Importer » accepte un fichier ≤ 1 Mo, le valide **exactement comme le localStorage**, affiche
  « N tickets valides, M écartés. Remplacer votre file actuelle ? », et ne remplace qu'après
  confirmation.

## Critères d'acceptation

- **CA-1** Premier lancement : les 7 exemples s'affichent avec le bandeau ; « Vider les
  exemples » les retire et ils ne reviennent pas après rechargement.
- **CA-2** Créer un ticket l'ajoute en tête selon le tri, persiste après rechargement, ouvre son
  détail.
- **CA-3** Chaque action de la liste « Actions » produit le statut, les compteurs et la ligne
  d'historique attendus.
- **CA-4** Les compteurs de l'en-tête sont toujours cohérents avec la liste.
- **CA-5** Un ticket « en retard » a un indicateur visible qui n'est pas que de la couleur
  (texte « SLA dépassé de 2 j »).
- **CA-6** Deux onglets ouverts : une modification dans l'un apparaît dans l'autre sans
  rechargement.
- **CA-7** Export puis import du même fichier redonne exactement la même file.
- **CA-8** Le tableau reste utilisable à 360 px (défilement horizontal dans son cadre, pas de la
  page) et au clavier (chaque ligne ouvre le détail avec Entrée).
- **CA-9** `#t-<id>` dans l'URL ouvre directement ce ticket ; id inexistant → file d'attente +
  message « Ticket introuvable. Il a peut-être été résolu, qui sait. »
- **CA-10** Impression : le papier listing (bandes et trous) est conservé, sans les boutons.
- **CA-11** Le `CollectionTag` affiche « Look 03/03 » et mène au lookbook.

## Cas limites

- **CL-1** localStorage indisponible (navigation privée stricte, quota plein) → l'app fonctionne
  en mémoire avec le bandeau « Mode amnésique : rien ne sera gardé ».
- **CL-2** localStorage contient du JSON invalide, un tableau, `null`, un objet avec `__proto__`,
  une version 2 → voir Données.
- **CL-3** Ticket avec un `subject` de 10 000 caractères ou du HTML → écarté (longueur) ou affiché
  en texte (HTML).
- **CL-4** Deux tickets avec le même `id` → on garde le plus récent (`updatedAt`).
- **CL-5** Fichier importé : pas du JSON, 5 Mo, image renommée en `.json` → message clair, file
  actuelle intacte.
- **CL-6** `nextId` incohérent (plus petit qu'un id existant) → recalculé à `max(id) + 1`.
- **CL-7** Horloge qui recule (`createdAt` dans le futur) → affiché « créé dans le futur », SLA
  non calculé.

## Modèle de menace

- Même origine partagé avec les autres sites de `G0nni.github.io` : une autre page peut écrire
  dans notre clé. Donc validation stricte à chaque lecture, et `textContent` partout.
- Fichier importé = donnée hostile. Taille bornée avant `JSON.parse`.
- L'id dans le hash est parsé comme entier strict (`/^t-\d{1,9}$/`).

## Design (tokens)

- Bureau `#CFCAC0`, papier `#FCFBF5`, bande listing `#DDEBD8`, encre `#1C1B18`, rouge tampon
  `#B42318`, texte secondaire `#55524A`, perforation `#BDB7AA`.
- Polices (fontsource) : Rubik Mono One (titres, tampons, numéros de ticket) ; Courier Prime
  (tout le reste).
- Modules signature : papier listing à bandes avec trous d'entraînement des deux côtés ; liasse
  carbone en grille de champs encadrés ; tampon de priorité incliné ; historique horodaté façon
  journal d'imprimante.
- Maquette de référence : canvas Design « Projets débiles », artboard « 2 · Helpdesk de ta vie ».

## Décisions prises (à valider par Gonni)

- Pas de date d'échéance libre par ticket : le SLA par priorité suffit et c'est plus drôle.
- Pas de recherche texte dans la v1 (le tri par culpabilité fait le travail).
