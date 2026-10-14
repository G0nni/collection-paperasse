# Rapport lookbook · retouche « tout sur un écran » · tour 2 (final)

## Verdict

**Fini.** Les 6 points de la définition de « fini » sont vrais : CA-1 à CA-7 couverts et verts,
pas de CL, `pnpm verify` vert relancé par l'orchestrateur (232 unitaires, 280 e2e, 72 sautés
volontairement), reviewer « Prêt », security sans point critique ou élevé, axe sans violation.
`pnpm build` + `check-csp` : CSP de production correcte sur les 4 pages.

Tour 2 : titre calé sur la largeur de l'affiche (container query), vérifié avec une police
navigateur à 24 px (nouveau test via `Page.setFontSizes`) ; pistes partagées au lieu de
`subgrid` ; aperçus alignés ; `posterTitle` en chaîne. Le tour 2 ne touchant que du CSS et un
test, seul le reviewer l'a relu (CSP et dépendances inchangées, confirmé par `check-csp`).

Restent ouverts (mineurs) : test d'alignement des fiches, position du titre (bords) dans le test
de police agrandie, découpage de `tests/e2e/lookbook/tester.spec.ts` (passe de ménage dédiée).

---

# Historique : tour 1

## Verdict

Reviewer : **Prêt** (0 bloquant). Security : aucun point critique ou élevé (CSP identique à
`main`, 60 scénarios navigateur sans violation). Tester : 0 échec, CA-1 à CA-7 couverts.

Un tour 2 court est lancé pour les points « Important » qui touchent le livrable : le titre en
`nowrap` sort de l'affiche (sous le post-it bleu) quand la taille de police du navigateur est
agrandie (mesuré : 551 px pour 471 disponibles à 1000 px). Règle 5 de CLAUDE.md.

## Tester

| ID | Statut |
| -- | -- |
| CA-1 liens | ✅ |
| CA-2 trois dispositions (360, 800, 1280 + seuils 639/640/999/1000, 1440, 1920) | ✅ |
| CA-3 aucune ressource externe | ✅ |
| CA-4 axe (360, 800, 1000×720, 1280) | ✅ |
| CA-5 étiquette de collection | ✅ |
| CA-6 pas de défilement à 1280×720 (scrollHeight 720, contenu à 672-676 px) | ✅ |
| CA-7 ordre de tabulation, contour de focus non rogné | ✅ |
| Rendu `subgrid` hors Chromium | ⚠️ seul Chromium disponible |

Durcissements proposés : repli si `subgrid` absent, titre calé sur la largeur de l'affiche,
tolérance de hauteur du bandeau. Trous de spec : défilement entre 1000 et 1279 px non tranché,
zone d'affichage réelle d'un écran 1280×720, token du post-it jaune, CA-7 cite l'affiche qui n'a
rien de focalisable, zoom 200 %.

## Reviewer

- [Important] Titre en `nowrap` dimensionné sur la fenêtre et non sur l'affiche : déborde avec une
  police agrandie → container query sur `.poster` (`min(3.5rem, 9cqi)`) ou retrait du `nowrap`.
- [Important] Deux assouplissements de spec (numéros ≥ 24 px, même ligne à 1280 px) absents de
  « Décisions prises » → ajoutés par l'orchestrateur.
- [Important] `tests/e2e/lookbook/tester.spec.ts` (1738 lignes) rangé par historique : découper par
  section de spec, helpers dans `tests/e2e/support/lookbook.ts`, fusionner les doublons. Reporté à
  une passe de ménage dédiée (aucun impact sur le livrable).
- [Mineur] `min-height` des aperçus trop petit (Look 01 décalé de 6 px) → `10rem`.
- [Mineur] `subgrid` : remplacer par des pistes partagées (`--board-columns`), plus simple et sans
  question de repli (Chrome 111 à 116 n'ont pas `subgrid`).
- [Mineur] zones de grille `left`/`right` inutilisées ; `posterTitle` devenu une chaîne ;
  extraction facultative de `LookCard.astro`.

## Security

Aucun point critique ou élevé. Info : hash de chaîne vide dans `style-src`, déjà présent sur `main`.
