# Phénomènes spatiaux

Le catalogue V2 permet des systèmes de tailles variables et des identités persistantes distinctes des indices de sélection. Chaque système est activé en entier selon la densité choisie. Les tirages aléatoires nommés rendent les variantes reproductibles.

## Trous noirs

**Options → Phénomènes rares** donne accès aux trous noirs et aux pulsars du catalogue actif, regroupés par catégorie avec leur effectif. Le premier système en contient un ; les autres suivent une distribution déterministe de 0,3 % des systèmes. Les étoiles doubles ont leur propre catégorie, tronquée aux 24 premières destinations, l’effectif total restant affiché.

Un trou noir constitue une destination unique : disque et ombre partagent sa sélection. La caméra reste hors du disque et ne propose aucune exploration de surface. Le cadrage tient compte de l’enveloppe et du format de l’écran. Une ambiance grave utilise le graphe audio existant. Les contrôles sont traduits en français, anglais, espagnol et portugais du Portugal.

La pause fige les animations, mais laisse actifs la caméra, les fondus et le nettoyage des ressources. Le mouvement réduit fige le disque et raccourcit les trajets ; le ciel suit les orbites encore mobiles.

## Pulsars

Le lot 4 active les pulsars déjà réservés en V2 : cœur blanc bleuté, halo contenu et deux cônes opposés tournant autour d’un axe magnétique incliné. Leur période artistique déterministe varie de 4 à 10 secondes. Le passage d’un faisceau vers la caméra module doucement la lumière et la couche sonore locale ; le cœur ne s’éteint jamais.

La caméra cadre l’enveloppe des faisceaux, respecte une exclusion de trois rayons du cœur et ne propose aucune exploration de surface. La pause fige la phase ; le mouvement réduit fixe les faisceaux et leur intensité. Les fiches et catégories sont traduites dans les quatre langues.

L’activation conserve les identités, rayons et orbites existants. Les pulsars ne créent aucune lentille, cible de rendu ou texture supplémentaire.

## Étoiles doubles

Le lot 5 active la seconde source réservée en V2, sur 5 % des systèmes. Les deux composantes partagent un barycentre invisible, une vitesse angulaire et une inclinaison, et tournent en phases opposées sur des rayons pondérés par des masses artistiques. Leur séparation est donc constante, et le compagnon contraste en couleur avec l’étoile principale trois fois sur quatre.

Les planètes tournent autour de la paire entière, à l’extérieur de trois fois la séparation. La vue système centre le barycentre : il ne porte ni marqueur ni sélection et ne compte pas dans la densité. Sélectionner une composante la suit, et la fiche mène à sa compagne.

Les planètes détaillées sont éclairées par deux sources dont les poids somment à un, de sorte qu’elles ne sont pas plus claires qu’ailleurs. Les emplacements suivent l’ordre du catalogue et ne sont jamais triés, ce qui évite un claquement du reflet au croisement des étoiles ; le reflet spéculaire suit la source dominante. Une étoile isolée rend exactement comme avant. Le son conserve la musique existante avec une coloration légère suivant l’angle de la paire.

L’activation conserve les identités, rayons et orbites existants : la séparation est bornée pour tenir dans la première orbite planétaire, si bien qu’aucune orbite n’a été déplacée.

## Rendu et ressources

Huit candidats détaillés sont partagés entre les corps ordinaires et les phénomènes. Le cache réserve huit entrées ordinaires et quatre phénomènes, soit douze au maximum. Le détail apparaît à six pixels de rayon projeté, avec conservation jusqu’à 4,8 pixels et fondu de 0,4 seconde.

Une seule lentille détaillée est active à la fois. Elle utilise une cible couleur/profondeur et une cubemap, libérées après quatre secondes hors détail. Le ciel est capturé à chaque image rendue lorsqu’il évolue. Une mesure GPU asynchrone adapte sa résolution entre 512 et 256 ; sans extension de chronométrage GPU, le temps de soumission CPU sert de repli explicitement identifié.

Les équations, le filtrage et les limites physiques sont décrits dans [Optique du trou noir](LOT-3-LENTILLE.md).

## Validation

`npm test` couvre le catalogue déterministe, les orbites, le cache, les trajectoires lumineuses, la sélection, l’adaptation de résolution, la géométrie des paires et le mélange des deux lumières locales. `npx tsc --noEmit`, `npm run lint` et `npm run build:static` vérifient l’intégration.

Le banc WebGL de développement `tests/fixtures/lensing-lab.ts` permet d’examiner une grille déformée, les images d’une étoile, le disque de profil et l’occlusion du premier plan. Il ne fait pas partie de l’interface utilisateur. Les performances varient selon l’appareil ; aucune certification sur téléphone physique n’est déclarée.
