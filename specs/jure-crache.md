# Look 02 · Juré Craché

> Étude notariale fondée dans la cour de récré. Tu enregistres un pari entre potes, l'app te sort
> un acte officiel (sans aucune valeur) avec compte à rebours, signatures, sceau de cire, et un
> numéro d'acte qui change si quelqu'un trafique le lien.

## Écrans

1. **Rédaction** (pas de hash) : formulaire parieur, contre-parieur, objet, enjeu, articles
   (3 pré-remplis, modifiables, 0 à 5), échéance. Bouton « Sceller l'acte ».
2. **Acte** (hash valide, pas de verdict) : l'acte complet, compte à rebours, boutons « Copier
   le lien de l'acte », « Imprimer », « Déclarer le vainqueur ».
3. **Acte jugé** (hash valide + verdict) : même acte, tampon VAINQUEUR (ou MATCH NUL) sur le nom,
   compte à rebours remplacé par « Verdict déclaré. Échéance du pari : <date> ». Le lien ne porte
   pas la date du verdict : l'app n'en affiche aucune.

## Format d'URL (fait foi)

```
/jure-crache/#1.<payload>            acte
/jure-crache/#1.<payload>.p          acte jugé : le parieur gagne (c = contre-parieur, n = nul)
```

- `<payload>` = `LZString.compressToEncodedURIComponent(JSON.stringify(acte))`.
- Tout est dans le **hash** : rien n'est envoyé au serveur (GitHub Pages ne le voit pas).

Schéma de `acte` (clés courtes, ordre fixe pour l'empreinte) :

| Clé | Sens | Format | Bornes |
| --- | ---- | ------ | ------ |
| `p` | parieur | texte | 1 à 40 caractères |
| `c` | contre-parieur | texte | 1 à 40, différent de `p` (insensible à la casse) |
| `o` | objet du pari | texte | 1 à 200 |
| `e` | enjeu | texte | 1 à 120 |
| `a` | articles | tableau de textes | 0 à 5 éléments, chacun 1 à 160 |
| `d` | échéance | entier, ms Unix UTC | > `t`, ≤ `t` + 10 ans |
| `t` | date de rédaction | entier, ms Unix UTC | ≥ 2026-01-01, ≤ maintenant + 1 jour |

- Tous les textes : trim, caractères de contrôle et bidirectionnels retirés, puis vérification
  des bornes. Clé inconnue → acte refusé. Clé manquante → acte refusé.
- Payload décompressé > 4 Ko (mesuré en unités UTF-16, `decoded.length` : un acte aux bornes
  tient toujours, emoji compris), JSON invalide, lz-string qui renvoie `null` ou `""` → écran
  « Acte illisible » avec bouton « Rédiger un nouvel acte ».

## Empreinte et numéro d'acte

- `empreinte = SHA-256(JSON canonique de acte)` via `crypto.subtle.digest`. JSON canonique =
  clés dans l'ordre `p, c, o, e, a, d, t`, sans espace.
- Numéro affiché : `N° AAAA-` suivi des 128 premiers bits de l'empreinte en base32 Crockford
  (26 caractères, alphabet `0-9 A-Z` sans `I L O U`), groupés par 4 avec des tirets
  (`N° 2026-K7QM-4XRT-…`). `AAAA` = année UTC de `t`. Pourquoi 128 bits : à 32 bits, copier le
  numéro d'un acte existant coûtait quelques minutes (security, tour 1) ; à 64 bits, l'auteur
  pouvait encore préparer deux versions au même numéro en ~2^32 calculs (paradoxe des
  anniversaires, security, tour 2). À 128 bits, les deux attaques sont hors de portée. Le numéro
  détecte la retouche, il ne prouve rien juridiquement (pied d'acte).
- La couleur de la cire est choisie dans une palette fixe de 4 teintes à partir de l'empreinte.
- Les signatures sont des tracés SVG générés de façon déterministe à partir du nom (même nom →
  même gribouillis).
- **Le verdict ne fait pas partie de l'empreinte** : il est déclaratif. L'acte jugé l'affiche
  honnêtement : « Verdict déclaré par la personne qui a envoyé ce lien. En cas de litige, le
  tribunal des potes statue en dernier ressort. »

## Critères d'acceptation

- **CA-1** « Sceller l'acte » valide le formulaire (erreurs reliées aux champs avec
  `aria-describedby`, focus sur le premier champ en erreur), puis met le hash et affiche l'Acte.
- **CA-2** Recharger la page ou ouvrir le lien ailleurs affiche le même acte et le même numéro.
- **CA-3** Modifier un seul caractère de l'acte (en recréant le payload) change le numéro d'acte.
- **CA-4** Le compte à rebours (jours, heures, min, sec) se met à jour chaque seconde ; à
  l'échéance il affiche « Échéance passée. Le tribunal des potes attend votre verdict. »
- **CA-5** « Déclarer le vainqueur » propose parieur / contre-parieur / match nul dans une boîte
  de dialogue accessible (`<dialog>`, focus piégé, Échap ferme), puis ajoute le suffixe au hash.
- **CA-6** « Imprimer » ouvre l'impression ; la feuille de style d'impression tient l'acte sur une
  page A4 sans les boutons, sans page blanche, pour tout acte qui respecte les bornes, y compris
  en idéogrammes. Chaque texte libre a un plafond de hauteur en impression : au-delà (lien forgé
  avec des glyphes très larges), il est coupé, jamais reporté sur une 2e page. Le pied d'acte est
  en plus répété en marge basse de chaque page imprimée (`@page`), pour qu'aucune page « officielle »
  ne sorte sans lui. Seul l'A4 est garanti (`size: A4`). Le pied en marge n'apparaît que sur les
  pages de l'acte (page nommée), pas en imprimant la Rédaction ou un écran de refus.
- **CA-7** « Copier le lien » : même comportement que le Réunion-mètre (CA-7 et section Écrans) :
  copie de l'URL courante, confirmation annoncée à côté du bouton qui s'efface si le lien change,
  et repli dans un `<dialog>` modal (champ sélectionné, Fermer, Échap, focus rendu) si le
  presse-papiers est refusé.
- **CA-8** Un pied d'acte permanent indique « Acte sans aucune valeur juridique. Juré, craché. »
- **CA-9** Le `CollectionTag` affiche « Look 02/03 ».
- **CA-10** Le formulaire propose 3 articles par défaut : retard > 10 min ; « j'suis en bas » ne
  vaut pas arrivée ; toute excuse impliquant la SNCF est examinée par le tribunal des potes.
- **CA-11** De 360 à 1280 px (dont 640, 768, 960, 1024 et 1093×614), l'acte reste lisible : aucun
  texte de l'acte coupé ou recouvert, sceau et signatures ne masquent rien, pas de défilement
  horizontal. Textes libres nettoyés par `sanitizeText` (CLAUDE.md, Sécurité).

## Cas limites

- **CL-9** Acte dans les bornes dont le lien dépasserait 4 Ko bruts (beaucoup de caractères
  rares) → refusé au formulaire, erreur sur le texte le plus lourd une fois compressé, focus dessus.

- **CL-1** Hash `#1.` vide, `#2.xxx` (version inconnue), `#1.xxx.z` (verdict inconnu) →
  respectivement Rédaction, « Acte d'une version inconnue », acte sans verdict.
- **CL-2** Payload qui décompresse en tableau, nombre, `null`, ou objet avec `__proto__` →
  « Acte illisible ». Le parseur n'utilise jamais `Object.assign` ou spread sur l'objet décodé :
  il lit les clés attendues une par une.
- **CL-3** Texte contenant `<script>`, `<img onerror>`, une URL → affiché tel quel, en texte, sans
  lien cliquable.
- **CL-4** Noms identiques (« Théo » / « théo ») → erreur de formulaire, et acte refusé s'il
  arrive par l'URL.
- **CL-5** Échéance déjà passée à la rédaction → erreur de formulaire.
- **CL-6** `crypto.subtle` indisponible (contexte non sécurisé) → numéro « N° NON-SCELLÉ » et
  bandeau d'explication, l'acte reste lisible.
- **CL-7** Noms très longs sans espace (40 caractères) → coupure propre (`overflow-wrap: anywhere`),
  pas de débordement à 360 px.
- **CL-8** Hash modifié pendant que la page est ouverte (`hashchange`) → l'acte se recharge.

## Modèle de menace

- Le risque principal n'est pas le JS mais **le contenu trompeur** : un lien forgé peut faire dire
  n'importe quoi à un « acte officiel ». Parades : pied d'acte permanent (CA-8), aucun lien
  cliquable, aucun texte libre hors des champs prévus et de leurs bornes, mise en page fixe
  (l'attaquant ne peut ni ajouter de bloc, ni changer les libellés).
- Falsification : modifier l'acte change le numéro (CA-3). Le verdict, lui, est déclaratif et le
  dit (voir Empreinte).

## Design (tokens)

- Fond `#DCE4D8`, papier `#F7F9F3`, encre verte `#1E4636`, cire par défaut `#9E2A24` (palette :
  `#9E2A24`, `#1E4636`, `#2B3A67`, `#7A4B12`), texte sur cire `#F6E3D8`.
- Polices (fontsource) : Young Serif (titres, chiffres du compte à rebours) ; Special Elite (champs
  remplis « à la machine ») ; Spectral (texte juridique, labels en capitales espacées).
- Modules signature : rosace guillochée en fond du titre ; cadre double filet ; champs tapés à la
  machine sur une ligne ; compte à rebours en souches perforées ; signatures SVG générées ; sceau
  de cire à bord irrégulier avec texte circulaire « PAS DU TOUT LÉGAL · MAIS TRÈS SÉRIEUX ».
- Maquette de référence : canvas Design « Projets débiles », artboard « 3 · Le Notaire des Paris
  Débiles ».

## Décisions prises (à valider par Gonni)

- Verdict déclaratif, hors empreinte (sinon il faudrait un serveur pour savoir qui a le droit de
  juger).
- Les dates sont affichées dans le fuseau de l'appareil qui regarde, en `fr-FR`.
- Décisions de l'orchestrateur après le tour 1 (à confirmer) : « Verdict déclaré » sans date ;
  numéro sur 64 bits ; 4 Ko en unités UTF-16 ; impression bornée à une page avec pied répété ;
  forme propre réécrite (`replaceState`) sauf lien illisible ou de version inconnue ; Rédaction
  vide avec échéance proposée à J+7, 20 h, et les 3 articles par défaut ; boutons « Nouvel acte »
  et « Modifier le verdict » ; année du numéro en UTC (même numéro dans tous les fuseaux).
- Dates : « 1er » pour le premier du mois (« 1er janvier 2027 »), `Intl` ne le fait pas.
- Heure qui existe deux fois (passage à l'heure d'hiver) : la première occurrence est retenue.
- Numéro sur 128 bits en base32 (décision de l'orchestrateur après le tour 2, à confirmer par
  Gonni : l'alternative est de garder 64 bits et d'assumer qu'un auteur peut préparer deux
  versions au même numéro).
