# Précision des positions — #23

## Symptôme

Un astre vu à mi-distance (approche d'une planète, voisine qui passe) tremblait ; de très près, plus rien.

## Pourquoi

Un même astre a deux représentations :

| représentation | où la position est calculée | précision |
|---|---|---|
| maillage détaillé (`lib/stellar-lod.ts`) | CPU, `particlePosition`, puis matrice modèle‑vue three.js | double |
| point, imposteur, profondeur, sélection (`vertexShader` de `lib/galaxy.ts`) | GPU, repère galactique | float32 |

Une planète mesure 1e‑5 à 2e‑4 unité de rayon, une lune quelques 1e‑6, à 1–12 unités du centre galactique. Le shader multiplie en plus `uRotation`, horloge qui croît sans fin (0,065 par seconde à vitesse 1). L'erreur float32 grandit avec la session :

| session | erreur GPU max |
|---|---|
| 1 min | 1,7e‑5 u |
| 10 min | 1,1e‑4 u |
| 1 h | 5,5e‑4 u |
| 4 h | 1,9e‑3 u |

Le maillage n'apparaît qu'en fondu sous 48 rayons (`surfaceVisibility`) : au‑delà, et pendant le fondu, c'est l'imposteur qui se voit.

## Principe retenu

`lib/local-precision.ts` :

1. Les objets de points (`stars`, `impostors`, poussière, `pointDepth`, `pickPoints`) sont placés à la position de la caméra dans le repère galactique. three.js résout donc la grande translation en double, et le shader ne voit plus que des écarts à la caméra.
2. Les 16 systèmes dont l'enveloppe est la plus proche de la caméra (dans un rayon d'une unité, système sélectionné en priorité) reçoivent leurs positions calculées sur le CPU en double, relatives à la caméra, via une texture flottante 32×16. Le shader les lit par `anchorToCamera(aId, p)`.
3. Les systèmes plus lointains gardent le calcul GPU : l'erreur, rapportée à leur profondeur, y reste de l'ordre du pixel au plus.
4. La capture du ciel (lentille) dessine des copies restées à l'origine : elle suspend ce chemin le temps du rendu.

Coût borné : au plus 16 systèmes × 24 corps recalculés par image, et une boucle de 16 comparaisons au plus par sommet, interrompue dès le dernier emplacement occupé.

## Validation

- Tests : `tests/local-precision.test.mjs`, `tests/system-spatial-index.test.mjs`.
- Navigateur (Chromium headless, vitesse ×3, attente 60 s, planète à ~57 rayons) : déplacement de la planète visée d'une capture à l'autre, médiane 1,05 px (max 3,5 px) avant, 0,001 px après. Pour la voisine, il ne reste que son mouvement orbital (0,87 → 0,23 px).
- Sélection au clic, scène en pause : les astres visés sont sélectionnés. Scène en mouvement : même taux de réussite avant et après. Trou noir et lentille : rendu inchangé.
