# Phénomènes spatiaux

Le catalogue V2 permet des systèmes de tailles variables et des identités persistantes distinctes des indices de sélection. Chaque système est activé en entier selon la densité choisie. Les tirages aléatoires nommés rendent les variantes reproductibles.

## Trous noirs

**Options → Phénomènes rares** donne accès aux trous noirs et aux pulsars du catalogue actif, regroupés par catégorie avec leur effectif. Le premier système en contient un ; les autres suivent une distribution déterministe de 0,3 % des systèmes. Les étoiles doubles ont leur propre catégorie, tronquée aux 24 premières destinations, l’effectif total restant affiché.

Un trou noir constitue une destination unique : disque et ombre partagent sa sélection. La caméra reste hors du disque et ne propose aucune exploration de surface. Le cadrage tient compte de l’enveloppe et du format de l’écran. Une ambiance grave utilise le graphe audio existant. Les contrôles sont traduits en français, anglais, espagnol et portugais du Portugal.

La pause fige les animations, mais laisse actifs la caméra, les fondus et le nettoyage des ressources. Le mouvement réduit fige le disque et raccourcit les trajets ; le ciel suit les orbites encore mobiles.

## Pulsars

Le lot 4 active les pulsars déjà réservés en V2 : cœur blanc bleuté, vent équatorial diffus, jets polaires et deux faisceaux opposés tournant autour d’un axe magnétique incliné. Cette vue représente un jeune pulsar à nébuleuse de vent ; les jets restent sur l’axe de rotation. Leur période artistique déterministe varie de 4 à 10 secondes. Le passage d’un faisceau vers la caméra module doucement la lumière et la couche sonore locale ; le cœur ne s’éteint jamais.

La caméra cadre l’enveloppe des faisceaux, respecte une exclusion de trois rayons du cœur et ne propose aucune exploration de surface. La pause fige la phase ; le mouvement réduit fixe les faisceaux et leur intensité. Les fiches et catégories sont traduites dans les quatre langues.

L’activation conserve les identités, rayons et orbites existants. Les pulsars ne créent aucune lentille, cible de rendu ou texture supplémentaire.

## Nébuleuses et vestiges de supernova

Le lot 7 ajoute des régions : des volumes que la caméra traverse, sans centre solide, qui couvrent plusieurs systèmes. Elles ne sont ni des astres ni des systèmes, ne comptent pas dans la densité affichée et n'interceptent jamais un clic destiné à une étoile. On les atteint depuis **Options → Phénomènes rares** ou par leur repère à l'écran.

Neuf nébuleuses sont réparties dans des complexes irréguliers par un tirage déterministe indépendant de la densité. Leurs identifiants restent stables. Rubans, lobes asymétriques et arcs creusés se déclinent dans huit palettes d’émission et de diffusion illustratives. Leur opacité est bornée pour que les étoiles restent lisibles au travers, y compris depuis l'intérieur du nuage.

Un vestige de supernova entoure environ un système à pulsar sur sept : une coque fragmentée autour d'une cavité creuse, avec son pulsar en son centre. Ses nappes de choc restent stables à l’échelle de la visite ; la coque ne s’étend jamais. Sa fiche mène directement au pulsar, et celle du pulsar revient au vestige. Il apparaît et disparaît avec son système hôte.

Le nuage est dessiné comme un vrai volume traversé pas à pas, de seize à quatre pas selon la charge, après que la résolution a atteint son plancher. Toutes les nébuleuses restent présentes, même hors du budget détaillé : quatre pas sous six pixels, huit en vue intermédiaire, jusqu’à seize pour les deux régions prioritaires suffisamment proches. Le cache des vestiges conserve deux entrées. Les régions s’activent depuis le menu. La région activée se signale dans la scène elle-même, sans rien dessiner par-dessus : son volume monte en luminance et ses filaments se renforcent, en fondu à l’entrée comme à la sortie. Sa transparence, elle, ne bouge pas — les étoiles situées derrière restent aussi lisibles qu’avant. L'ambiance sonore de la région se mélange à celle de l'astre observé, sans jamais la remplacer : on peut être dans une nébuleuse tout en regardant une planète. Fiches et catégories sont traduites dans les quatre langues.

### Échelle apparente des régions

Les deux familles sont tirées sur une seule échelle : une fraction du diamètre du disque galactique. La taille d'un vestige ne dépend plus du nombre de planètes tirées par son pulsar hôte.

| Famille | Diamètre réel | Repères | Plage tirée (% du disque) | Observé au catalogue complet |
| --- | --- | --- | --- | --- |
| Disque galactique | ~100 000 al | Voie lactée | — | 100 % |
| Nébuleuse | 20–350 al | Orion 24 al, Aigle 70 al, W51 350 al | 0,5–1,4 % | 0,58–1,21 % (9 nuages) |
| Vestige de supernova | 8–40 al | Crabe 11 al, Cassiopée A 16 al | 0,12–0,26 % | 0,14–0,45 % (126 coques) |

**Principe.** Les deux plages sont comprimées et agrandies pour la navigation — d'environ onze fois — mais par le même facteur, si bien que le rapport entre les familles survit : un complexe de nébuleuse vaut à peu près quatre fois un vestige à pulsar. Le rapport des rayons médians rendus est de 3,4, et le plus gros vestige atteint 78 % de la plus petite nébuleuse : un vestige est toujours la plus petite des deux. Un vestige s'étale d'un facteur 3,2 d'un bout à l'autre du catalogue, une nébuleuse d'un facteur 2,1.

**Systèmes hôtes.** Les systèmes rendus sont, eux, agrandis bien davantage — l'application n'a pas d'échelle métrique unique entre étoiles, systèmes et galaxie. Une coque doit malgré tout envelopper le système qu'elle entoure : c'est un plancher de dégagement, pas la loi de taille, et il est plafonné. Au-delà, c'est le système rendu qui est hors d'échelle, et la coque cesse de le suivre : trois hôtes sur cent vingt-six laissent alors leurs corps les plus lointains à l'extérieur.

Le cadrage est le même pour les deux familles — la distance de cadrage de l'enveloppe — et n'entrait donc pas dans la disproportion. Les plages précédentes faisaient varier le rayon d'un vestige d'un facteur 217 selon son hôte, jusqu'à 2,1 % du disque, soit 1,7 fois la plus grande nébuleuse.

## Étoiles doubles

Le lot 5 active la seconde source réservée en V2, sur 5 % des systèmes. Les deux composantes partagent un barycentre invisible, une vitesse angulaire et une inclinaison, et tournent en phases opposées sur des rayons pondérés par des masses artistiques. Leur séparation est donc constante, et le compagnon contraste en couleur avec l’étoile principale trois fois sur quatre.

Les planètes tournent autour de la paire entière, à l’extérieur de trois fois la séparation. La vue système centre le barycentre : il ne porte ni marqueur ni sélection et ne compte pas dans la densité. Sélectionner une composante la suit, et la fiche mène à sa compagne.

Les planètes détaillées sont éclairées par deux sources dont les poids somment à un, de sorte qu’elles ne sont pas plus claires qu’ailleurs. Les emplacements suivent l’ordre du catalogue et ne sont jamais triés, ce qui évite un claquement du reflet au croisement des étoiles ; le reflet spéculaire suit la source dominante. Une étoile isolée rend exactement comme avant. Le son conserve la musique existante avec une coloration légère suivant l’angle de la paire.

L’activation conserve les identités, rayons et orbites existants : la séparation est bornée pour tenir dans la première orbite planétaire, si bien qu’aucune orbite n’a été déplacée.

## Comètes

Le lot 6 active les identifiants réservés dans 2 % des systèmes ordinaires, sans modifier les identités ni les orbites des corps existants. L’ellipse utilise une excentricité entre 0,45 et 0,8, avec huit itérations de Kepler partagées entre CPU et GLSL. Le cadrage inclut l’apoastre et l’enveloppe maximale des queues. Les guides montrent ces ellipses et la période artistique est accélérée pour rendre le mouvement observable. Les comètes restent liées à leur système hôte.

La chevelure et les queues s’intensifient à proximité de l’étoile. La queue ionique bleue pointe à l’opposé de la source principale, y compris quand celle-ci tourne dans une binaire ; la queue de poussière dorée est courbée. Seul le noyau est sélectionnable, avec une cible minimale de douze pixels CSS. La chevelure est intégrée dans un volume, visible aussi quand la caméra y entre. La pause conserve position, activité et orientation ; le zoom approche le noyau jusqu’à son rayon d’exclusion.

Un écoulement de 128 grains anime la chevelure et le départ de la queue de poussière, avec naissance et disparition progressives. La pause et le mouvement réduit figent cet écoulement. Les quatre langues et une légère coloration sonore sont intégrées. La recette visuelle et la mesure GPU restent à exécuter : [lot 6](local/phenomenes/LOT-6-COMETES.md).

## Éruptions stellaires

Vue de près, une étoile porte une couronne et des éruptions (#25) décrites dans [`lib/stellar-activity.ts`](../lib/stellar-activity.ts). Tout se calcule à partir de la graine de l’étoile et du temps de simulation : une étoile évincée du cache puis recréée rejoue le même ciel.

**Couronne et vent.** Les jets coronaux ne dépendent que de la direction : ils restent radiaux, sans le damier des sinus haute fréquence d’avant. L’octave la plus fine s’efface quand elle crénellerait. Le vent n’est plus une passe de lignes : ce sont des condensations qui s’éloignent lentement le long des jets. La couronne s’éclaire autour d’un site en éruption.

**Déroulé d’une éruption.** Chaque cycle tire un nouveau site, à ±35° de latitude, avec une orientation d’arche propre. Les phases sont exprimées en fraction de la durée de l’événement :

1. **Montée** : un faisceau de filaments torsadés entre deux pieds s’illumine, avec un plasma qui coule le long des brins.
2. **Impulsion** : les pieds flambent et deux rubans s’allument sur la photosphère, de part et d’autre de la ligne neutre. L’éclair monte en 0,3 s au moins, sans clignotement.
3. **Éjection** : le sommet de la corde monte avec le cœur de la bulle, puis se déchire ; les jambes retombent. La bulle, une coque épaisse et optiquement mince, est intégrée analytiquement le long du regard. On voit un front brillant en ampoule de profil et un halo de face, sans contour dur, autour d’une cavité et d’un cœur chaud. Elle s’étend jusqu’à environ trois rayons en perdant de l’éclat.
4. **Déclin** : une arcade de boucles post-éruptives luit bas entre les rubans, qui s’écartent. Une pluie coronale redescend le long des jambes en refroidissant.

**Rythme par type.** Trois sites se partagent l’étoile :

| Type | Durée | Écart moyen | Arche |
| --- | --- | --- | --- |
| Naine rouge | ~7 s | ~13 s | référence |
| Géante | ~14 s | ~25 s | × 1,35 |
| Étoile bleue | ~8 s | ~30 s | × 0,9 |
| Naine blanche | ~6 s | ~60 s | × 0,7, faible |

**Qualité.** Le champ `flareDetail` du budget (3 à 0) ne fait que déplacer des plages de dessin et des commutateurs de shader : les géométries sont construites une fois, au détail maximal, et partagées par les trois sites. Un changement de palier s’applique donc aux étoiles déjà visibles.

| `flareDetail` | Paliers | Brins | Boucles d’arcade | Gouttes | Couronne | Filaments de la bulle |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | ultra-60, high-60 | 8 | 7 | 72 | 3 octaves, vent | 2 octaves |
| 2 | high-entry, balanced-60 | 6 | 6 | 48 | 2 octaves, vent | 1 octave |
| 1 | balanced-30, economy-30 | 4 | 4 | 24 | 1 octave, vent | 1 octave |
| 0 | economy-floor, rescue | 2 | 3 | aucune | 1 octave, figée | lisse |

Au palier 0, l’éruption reste lisible : arche, éclair, rubans et bulle. Une couche éteinte n’est pas dessinée. Hors éruption, il ne reste que la couronne, soit une passe de moins qu’avant la reprise.

**Chargement.** Le module (6,4 ko gzip) ne fait pas partie du chemin de la première image : il se charge quand une première étoile obtient une surface détaillée, et se greffe à elle dès qu’il est prêt. L’effet n’apparaît qu’à partir de 35 px de rayon, donc bien après. Le contrôle de budget compte désormais le bloc three.js que ce découpage isole, pour ne pas s’alléger en trompe-l’œil.

## Rendu et ressources

Huit candidats détaillés sont partagés entre les corps ordinaires et les phénomènes. Le cache réserve huit entrées ordinaires et quatre phénomènes, soit douze au maximum. Le détail apparaît à six pixels de rayon projeté, avec conservation jusqu’à 4,8 pixels et fondu de 0,4 seconde.

Une seule lentille détaillée est active à la fois. Elle utilise une cible couleur/profondeur et une cubemap, libérées après quatre secondes hors détail. Le ciel est capturé à chaque image rendue lorsqu’il évolue. Une mesure GPU asynchrone adapte sa résolution entre 512 et 256 ; sans extension de chronométrage GPU, le temps de soumission CPU sert de repli explicitement identifié.

Les équations, le filtrage et les limites physiques sont décrits dans [Optique du trou noir](LOT-3-LENTILLE.md).

## Validation

`npm test` couvre le catalogue déterministe, les orbites, le cache, les trajectoires lumineuses, la sélection, l’adaptation de résolution, la géométrie des paires et le mélange des deux lumières locales. `npx tsc --noEmit`, `npm run lint` et `npm run build:static` vérifient l’intégration.

Le banc WebGL de développement `tests/fixtures/lensing-lab.ts` permet d’examiner une grille déformée, les images d’une étoile, le disque de profil et l’occlusion du premier plan. Il ne fait pas partie de l’interface utilisateur. Les performances varient selon l’appareil ; aucune certification sur téléphone physique n’est déclarée.

## Révision visuelle scientifique

Le [rapport préalable](local/phenomenes/RAPPORT-VISUEL-SCIENTIFIQUE.md) décrit les sources, les choix et les limites. Les volumes associent désormais émission et extinction avec une couverture cohérente, un échantillonnage temporellement stable et des nappes irrégulières. Les faisceaux sont adoucis, les photosphères perdent leurs anneaux lumineux artificiels et la poussière cométaire se courbe derrière le mouvement orbital relatif à la source. Le noyau sombre possède un éclairage solaire directionnel.

## Vie locale et échelle — reprise du 13 septembre

Le diamètre des nébuleuses est ramené de 7–13 % à 0,5–1,4 % du disque galactique. Cette échelle reste volontairement amplifiée pour la navigation. Une déformation lente et bornée du gaz anime les filaments sans gonflement global.

La cubemap de lentille capture désormais les volumes de nébuleuses, y compris ceux hors du champ de la caméra principale, ainsi que les vestiges actuellement chargés. La capture réutilise les matériaux et restaure les parents, la visibilité et le LOD après chaque passage, même en cas d’erreur. Cela reste une approximation de ciel distant : le transfert radiatif dans un nuage proche traversé par la caméra et le trou noir n’est pas résolu le long de la géodésique.

Six concentrations émissives spiralent lentement vers l’intérieur du disque d’accrétion. Le même champ est utilisé dans le rendu direct et le rendu géodésique, avec conversion cohérente de l’orientation du disque. Elles représentent de la matière lumineuse, pas des photons orbitant sur des spirales artificielles.
