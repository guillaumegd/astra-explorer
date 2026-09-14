# Performance — lot 3, profils des surfaces/nuages, budget de régions, préchauffage et mémoire

Issue [#5](https://github.com/guillaumegd/astra-explorer/issues/5), au-dessus du
lot 1 ([ordonnanceur et politique de qualité commune](LOT-1-ORDONNANCEUR.md)).
`quality.budget.gridResolution` et `quality.budget.cloudSteps` publiaient déjà,
depuis le lot 1, un plafond de résolution de grille et de pas de nuages pour
les surfaces — rien ne les consommait encore. `quality.budget.pixelCap` et
`effectivePixelRatio` (plafond de pixels par profil, 1/2/4 M selon le palier)
existent eux aussi depuis le lot 1 et sont déjà appliqués : ce lot ne les
refait pas, il documente cet état et comble les deux trous mémoire restants.

## D — Surfaces et nuages

Toutes les fonctions de bruit (`terrainLand`, `mountainRange`) gardent leur
octave 0 — celle qui porte la forme de la côte ou de la chaîne montagneuse —
à tous les paliers ; seules les octaves fines suivantes se coupent par palier,
via le même motif de sortie anticipée déjà utilisé par `fbm` pour les étoiles
et géantes gazeuses (`if(weight<=0.0) break;`). Les coordonnées données à ces
fonctions ne changent jamais avec la qualité : côtes, fissures, cratères et
relief de référence restent au même endroit à tous les paliers, par
construction, pas par vérification a posteriori.

- **Normales fines (le plus gros P0 de l'audit)** : la différence finie à 4
  appels de `terrainHeight` par fragment (`lib/stellar-lod.ts:94-101` avant ce
  lot) ne tourne plus qu'aux deux paliers les plus riches (`gridResolution >=
  128`) ; en dessous, l'ombrage retombe sur la normale géométrique du
  maillage — c'est l'instruction de l'issue "réduire d'abord le détail
  d'éclairage" appliquée littéralement.
- **Octaves de relief** : `terrainLand` (7 octaves) et `mountainRange` (4)
  tombent à 5/3 puis 3/2 sous 128 et 64 de résolution de grille.
  `terrainLand` renormalise sa somme par le nombre d'octaves réellement
  exécutées (`1.0-pow(0.5,maxOctaves)`), pour ne pas paraître artificiellement
  plat aux paliers réduits.
- **Cratères non touchés** : la recherche 3×3×3 (27 cellules) n'est pas
  réduite — rétrécir ce rayon changerait quels cratères apparaissent, donc
  déplacerait une feature de référence, explicitement interdit par l'issue.
- **Grilles** : `patchFor`/`geometryFor` (`lib/stellar-lod.ts`) plafonnent
  leur ladder existante (32/64/128 patch, 20/48/96/192 sphère) par
  `budget.gridResolution`, au moment de la demande — un maillage déjà
  construit n'est jamais rétrogradé en place, seules les prochaines
  créations/promotions de niveau respectent un nouveau plafond, pour éviter
  le pop visuel que l'issue demande d'éviter ("transitions fondues"). Les
  caches de géométries partagées restent bornés en nombre d'entrées quel que
  soit le nombre de corps visités (au plus 7 tailles de segments possibles
  au total sur toute la session).
- **Nuages** : la boucle à 6 pas de l'atmosphère (`lib/stellar-lod.ts`) sort
  au premier pas non couvert par `budget.cloudSteps` (0/2/4/6 selon le
  palier) — aucune variante de shader, un seul programme compilé par corps
  avec atmosphère.

**Non fait (évalué, documenté par l'issue elle-même comme un "évaluer")** :
cartes procédurales de hauteur/normales pré-cuites en texture. Aucun
render-to-texture n'existe dans cette base aujourd'hui ; l'ajouter est un
changement d'architecture plus large qu'un ajustement de paliers, laissé de
côté pour un lot dédié si le profil GPU en montre le besoin.

## H — Budget de régions et imposteurs doux

`lib/phenomena/region-manager.ts` limitait à deux le nombre de régions en
« priorité détail », mais laissait les neuf nébuleuses (et tout vestige
caché) tourner leur raymarch à 4 ou 8 pas même hors priorité — rien ne
plafonnait la somme quand plusieurs étaient visibles à la fois.

- **`allocateRegionSteps`** (`lib/phenomena/region-budget.ts`, fonction pure)
  remplace le calcul par créneaux fixes par une allocation gloutonne sur un
  budget total (`3 × 120 × budget.volumeSteps`, une approximation du nombre
  d'invocations fragment — l'issue note elle-même que le poids exact
  nécessite un profil GPU, à affiner en conséquence). La région cadrée ou
  traversée n'est jamais dégradée ; les autres reçoivent le palier le plus
  riche que le budget restant peut encore payer, dans l'ordre de priorité
  existant.
- **Imposteur doux** (`lib/phenomena/region-impostor.ts`) : un unique
  `THREE.Points` partagé (même famille que l'imposteur des corps stellaires
  déjà en place), toujours présent, dont l'intensité monte quand le budget de
  raymarch d'une région tombe à zéro — une région n'est donc jamais
  invisible, seulement moins détaillée. Respecte explicitement le
  « à ne pas faire » de l'issue sur la présence artistique des neuf régions.
- **Capture/vue stables** : `nebula.ts`/`supernova-remnant.ts` construisent
  désormais deux matériaux (`viewMaterial`, `captureMaterial` — ce dernier
  bâti une seule fois, à la première capture). `captureSky` échange la
  référence `mesh.material` au lieu de muter `defines.STEPS` : plus aucune
  recompilation de shader liée à la capture du ciel après le premier usage
  réel (vérifié par un test dédié : `.version`, qui n'augmente que sur
  `needsUpdate = true`, reste identique sur trois captures successives).

## I — Étaler les créations, préchauffer utilement

`createBodyLOD`, le gestionnaire de phénomènes et le gestionnaire de régions
créaient tous leurs `ShaderMaterial`/géométries de façon synchrone, dans la
même frame, dès qu'un corps ou une région devenait actif.

- **`quality.budget.creationsPerFrame`** (nouveau champ, `4/4/3/2/2/1/1` du
  palier le plus riche au plus modeste) plafonne le nombre de **nouvelles**
  entrées créées par appel à `update()`, identique dans les trois
  gestionnaires. Les candidats non servis restent dans la liste et sont
  repris à la frame suivante — sans changement visible immédiat, puisque les
  listes de candidats sont déjà triées par pertinence (plus gros à l'écran
  d'abord) et que le système de points/imposteurs (corps) ou l'imposteur de
  région (H) continue de représenter ce qui attend son tour.
- **`renderer.compileAsync`** : appelé en tâche de fond (jamais `await`, la
  boucle d'animation reste synchrone) dès qu'une entrée est créée, dans les
  trois gestionnaires. Le repli quand `KHR_parallel_shader_compile` est
  absent est déjà géré en interne par three.js — rien à coder côté
  application pour ce cas.
- **Mesure** : `stats().created` (bodyLOD, phénomènes, régions) alimente un
  nouveau champ `creations` dans l'événement diagnostics `frame` existant.

## J — Mémoire : les trous, pas le plafond

Le plafond en pixels par profil (`quality.budget.pixelCap`,
`effectivePixelRatio`) et l'estimation explicite d'octets
(`lib/performance-memory.ts`) datent du lot 1 et sont inchangés ici. Deux
trous concrets comblés :

- **Géométrie d'anneau partagée** : `new THREE.RingGeometry(1.35, 2.1, 72)`
  était allouée à chaque entrée avec anneau (`lib/stellar-lod.ts`), sans être
  mémoïsée contrairement aux géométries de sphère/patch — hissée en
  géométrie partagée au niveau module, disposée avec le reste des caches
  partagés quand plus aucune entrée ne l'utilise.
- **Tests de plateau mémoire** (`tests/memory-plateau.test.mjs`, nouveau) :
  20 « trajets » simulés à travers les corps, les phénomènes et les
  nébuleuses, chacun suivi d'un retour à l'état vide au-delà de la fenêtre
  d'inactivité existante (4 s) — vérifie à chaque cycle que les caches de
  géométrie partagée, les entrées en cache et les octets de buffer estimés
  (`estimateBufferBytes`) reviennent exactement à zéro, pas seulement qu'ils
  ne grossissent pas.

## Tests

167 tests Node (16 nouveaux : 5 dans `stellar-lod.test.mjs` pour les
uniforms de détail dérivés du palier, le plafonnement de grille et le
partage de la géométrie d'anneau ; 5 dans `regions.test.mjs` pour
`allocateRegionSteps` ; 1 dans `living-phenomena.test.mjs` pour la stabilité
des matériaux de capture ; 2 dans `phenomena.test.mjs` pour le throttle de
création ; 3 dans le nouveau `memory-plateau.test.mjs`), plus l'extension du
contrat testé dans `quality-policy.test.mjs` pour `creationsPerFrame`. Lint,
`tsc --noEmit`, `npm run build`, `npm run build:static` et
`npm run check:build-budget` passent, en local (macOS) et sous Linux x64
(`node:22.23.2-slim`) avant chaque commit poussé. Budget de build : chemin
critique 309 360 / 320 000 octets gzip, total livré 315 871 / 340 000 (contre
307 611 / 314 122 avant ce lot — le coût des deux nouveaux modules,
`region-budget.ts` et `region-impostor.ts`, reste marginal).

Vérification navigateur, build statique local (`npm run build:static` +
`npm run preview:static`), Chrome (canal `chrome` de Playwright),
1 280 × 800 — machine de développement, donc **aucune mesure d'appareil** :

| Contrôle                                                         | Résultat                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| Vue galaxie après l'intro, 65 001 astres actifs                   | rendue, aucune erreur console                                     |
| ~120 crans de molette vers un monde volcanique                    | surface, lave et glow rendus correctement, aucune erreur console  |
| Enchaînement de dix corps voisins (chevron suivant)                | aucune erreur console sur 2 000+ images rendues                    |
| Dataset diagnostics (`data-quality-tier`, `data-regions`, …)      | `qualityTier: high-entry`, `regions: 9`, `volumeSteps: 16` cohérents |

Cette vérification a trouvé un vrai bug que la suite Node (sans contexte
WebGL) ne pouvait pas voir : `lib/surface-activity.ts` (particules de
surface — sable, lave, glace) appelle aussi `terrainHeight`, avec l'ancienne
signature à 3 arguments ; oubliée lors du passage à 5 arguments pour le
budget d'octaves, elle cassait la compilation du vertex shader sur tout
corps avec particules de surface (astéroïde/dune/volcanique/glace) :
`'terrainHeight' : no matching overloaded function found`. Corrigée avec le
détail fixé au maximum (un effet borné à 768 points, qui ne justifie pas un
branchement sur le budget qualité).

**Parcours de référence réel** (bouton « Parcours de référence × 3 », panneau
`?diagnostics=1`, même build statique) : capture de 120 s, budget qualité
libre (non figé). Sur cette fenêtre, 2 des 57 créneaux scène/répétition
prévus se sont complétés (`binary`, `galaxy-10000` — le parcours complet
instrumente chaque scène en profondeur et n'est pas conçu pour tenir en
120 s) : intervalles de frame plats à 16,7–16,8 ms (p50/p95/p99/max), soit un
60 images/s régulier, **aucun intervalle supérieur à 100 ms** sur les 449
images retenues ; coût CPU p95 par scène entre 1,1 et 2,5 ms, largement sous
le quota du palier. Un résultat positif mais partiel — 2 scènes sur 19, sur
un Mac M4 Max qui ne représente aucun appareil cible — pas une preuve
d'absence de gel sur le reste du catalogue de scènes ni sur du matériel
modeste.

Non mesuré ici, comme pour les lots précédents : le parcours de référence
complet (19 scènes × 3 répétitions) et le gel réel sur matériel modeste,
profil GPU du poids exact de chaque levier (l'issue elle-même le demande
pour affiner les constantes introduites — `REGION_STEP_BUDGET`, la table
`creationsPerFrame`, le mapping d'octaves), et validation visuelle qu'aucun
relief de référence ne bouge par comparaison d'images à chaque palier plutôt
que par construction du code. Ces critères chiffrés, comme pour les lots
précédents, sont reportés dans l'issue #2, qui
porte la campagne matérielle.
