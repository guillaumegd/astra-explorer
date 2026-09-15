# Référence visuelle — #10

Cette fiche définit le rendu de référence des objets touchés par la régression
de fidélité. Les poses sont versionnées dans
[`lib/reference-replay.ts`](../lib/reference-replay.ts) : le parcours de
référence les répète sans dépendre du zoom ou de la sélection précédente.

## Familles et compromis

| Famille | Scène de référence | Élevé et Ultra | Dégradation autorisée |
| --- | --- | --- | --- |
| Monde glacé | `ice` | Relief, fractures, micro-grain et reflet directionnel de glace. Le reflet dépend de la normale et reste brisé par la texture ; il ne doit pas devenir un miroir uniforme. | Auto peut réduire les octaves fines, les normales par pixel et la géométrie de proximité, dans cet ordre. |
| Relief et textures proches | `rocky-ground`, `ocean`, `volcano` | Grille rapprochée, normales de pente, grain et matériaux restent lisibles. Les côtes et la topographie ne changent pas entre paliers. | Auto baisse la grille et les octaves fines ; le relief de base, les côtes et les masques restent communs. |
| Géante à anneaux | `ringed-gas` | Anneaux présents, fondus avec le corps et 72 segments radiaux. | Auto abaisse graduellement à 64, 48 puis 32 segments ; aucun palier ne supprime les anneaux. |
| Nébuleuse et vestige | `nebula-crossing`, `remnant` | Raymarch de 16 pas, morphologie interne, filaments/poussières et profondeur lors de la traversée. Ultra rétablit aussi la priorité volumétrique de référence. | Auto répartit 12, 8, 4 puis 2 pas entre régions et utilise un imposteur doux pendant la transition, jamais un nuage plat de remplacement. |

Un profil manuel (Économie, Équilibré, Élevé ou Ultra) est fixe. Seul Auto
peut ajuster ce budget, avec le repli de sécurité explicite en cas de surcharge
sévère. Une approche sur appareil contraint ne réduit donc pas un profil
manuel, y compris Ultra.

## Captures de validation

Avant de valider une modification de matériau ou de LOD, exécuter le parcours
de référence à DPR 1 et capturer les scènes ci-dessus aux images 60 et 150.
Comparer chaque capture avec la dernière validation sur la même machine :

- la glace ne présente pas de zone spéculaire continue et conserve ses
  fractures à proximité ;
- la géante `ringed-gas` garde un anneau visible à l’entrée, à l’approche et
  après un changement de profil ;
- les volumes conservent leur cavité, leurs filaments ou leurs poches pendant
  la transition 16 → 12 → 8 → 4 pas.

Les tests de `reference-replay` garantissent que ces quatre destinations,
leurs identifiants et leurs poses restent disponibles. Les tests de LOD et de
profils vérifient les budgets et l’actualisation des anneaux déjà affichés.
