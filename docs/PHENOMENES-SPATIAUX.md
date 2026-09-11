# Phénomènes spatiaux

Le catalogue V2 permet des systèmes de tailles variables et des identités persistantes distinctes des indices de sélection. Chaque système est activé en entier selon la densité choisie. Les tirages aléatoires nommés rendent les variantes reproductibles.

## Trous noirs

**Options → Phénomènes rares** donne accès aux trous noirs du catalogue actif. Le premier système en contient un ; les autres suivent une distribution déterministe de 0,3 % des systèmes. Les architectures binaires et pulsars sont réservées avec un substitut ordinaire ; leurs phénomènes visuels ne sont pas activés.

Un trou noir constitue une destination unique : disque et ombre partagent sa sélection. La caméra reste hors du disque et ne propose aucune exploration de surface. Le cadrage tient compte de l’enveloppe et du format de l’écran. Une ambiance grave utilise le graphe audio existant. Les contrôles sont traduits en français, anglais, espagnol et portugais du Portugal.

La pause fige les animations, mais laisse actifs la caméra, les fondus et le nettoyage des ressources. Le mouvement réduit fige le disque et raccourcit les trajets ; le ciel suit les orbites encore mobiles.

## Rendu et ressources

Huit candidats détaillés sont partagés entre les corps ordinaires et les phénomènes. Le cache réserve huit entrées ordinaires et quatre phénomènes, soit douze au maximum. Le détail apparaît à six pixels de rayon projeté, avec conservation jusqu’à 4,8 pixels et fondu de 0,4 seconde.

Une seule lentille détaillée est active à la fois. Elle utilise une cible couleur/profondeur et une cubemap, libérées après quatre secondes hors détail. Le ciel est capturé à chaque image rendue lorsqu’il évolue. Une mesure GPU asynchrone adapte sa résolution entre 512 et 256 ; sans extension de chronométrage GPU, le temps de soumission CPU sert de repli explicitement identifié.

Les équations, le filtrage et les limites physiques sont décrits dans [Optique du trou noir](LOT-3-LENTILLE.md).

## Validation

`npm test` couvre le catalogue déterministe, les orbites, le cache, les trajectoires lumineuses, la sélection et l’adaptation de résolution. `npx tsc --noEmit`, `npm run lint` et `npm run build:static` vérifient l’intégration.

Le banc WebGL de développement `tests/fixtures/lensing-lab.ts` permet d’examiner une grille déformée, les images d’une étoile, le disque de profil et l’occlusion du premier plan. Il ne fait pas partie de l’interface utilisateur. Les performances varient selon l’appareil ; aucune certification sur téléphone physique n’est déclarée.
