# Optique du trou noir

Le rendu utilise des géodésiques de Schwarzschild : la capture des rayons produit l’ombre, la déviation révèle les images courbées du disque et détermine la direction du ciel visible.

## Modèle scientifique

Dans les unités où le rayon d’horizon et la vitesse de la lumière valent 1, avec `u = 1/r` :

```text
(du/dφ)² = e² − u²(1 − u)
d²u/dφ² = 3u²/2 − u
```

`e` est l’inverse du paramètre d’impact. La sphère des photons est à `r = 3/2` et le paramètre d’impact critique d’un rayon entrant depuis l’infini vaut `√27/2`. Pour une caméra à distance finie, la classification capture/échappement dépend aussi de la direction initiale.

Références : [Éric Bruneton, Real-time High-Quality Rendering of Non-Rotating Black Holes](https://ebruneton.github.io/black_hole_shader/paper.pdf), [documentation des fonctions](https://ebruneton.github.io/black_hole_shader/black_hole/functions.glsl.html), [visualisation NASA](https://svs.gsfc.nasa.gov/14619/). L’implémentation est écrite à partir des équations ; aucun code tiers n’a été repris.

## Solveur et disque

`lib/phenomena/geodesic.ts` et `lensing-shader.ts` utilisent une intégration RK4 directe, sans tables précalculées. Le pas maximal est de 0,04 radian pour 320 étapes au plus, avec réduction du pas pour les rayons presque radiaux. `body.radius` correspond au rayon d’horizon.

Les trajectoires rencontrent un disque d’épaisseur 0,36 rayon d’horizon. L’émission est accumulée avant capture ou échappement. Les images secondaires résultent de ces trajectoires, sans géométrie d’anneaux croisés. Le disque combine advection bornée, décalage gravitationnel, Doppler d’orbites circulaires locales et amplification bolométrique en `g⁴`. La palette thermique et les jets restent artistiques.

Le rendu utilise un, deux ou quatre sous-échantillons selon la région, avec quatre près de l’ombre. Le filtrage du ciel emploie un niveau de mipmap explicite : l’empreinte du rayon est calculée avant les branches et élargie près du rayon critique. Cela évite le cercle crénelé que provoquait le filtrage implicite au changement d’échantillonnage.

## Ciel, profondeur et sélection

La cubemap couvre six directions et utilise les mêmes géométries, mouvements et couleurs que le catalogue actif. La composition lit une cible couleur/profondeur distincte de sa sortie. Les corps détaillés et les cœurs des imposteurs fournissent la profondeur nécessaire au premier plan.

Le picking suit les trajectoires CPU, puis oriente une passe d’identifiants vers la direction d’échappement. Les images multiples d’un astre suivent la même convention. L’opacité cumulée du disque détermine si son bord transparent laisse sélectionner le fond. Les sprites de cette passe conservent leur taille réelle, avec une tolérance de deux pixels de cubemap.

## Cadence et qualité

Le ciel évolutif est capturé à chaque image du moteur, indépendamment de la vitesse de simulation. Le coût mesuré ajuste la résolution plutôt que la cadence : passage de 512 à 256 après huit moyennes au-dessus de 3 ms, remontée après 180 moyennes sous 0,6 ms. La taille angulaire des étoiles est préservée.

`capture-budget.ts` utilise `EXT_disjoint_timer_query_webgl2` de façon asynchrone, avec trois requêtes en attente au maximum et rejet des résultats disjoints. Sans cette extension, la mesure CPU constitue un repli, sans garantie de budget GPU. Le rendu de production n’utilise pas `gl.finish()`.

## Banc de validation

Dans la console de la prévisualisation locale :

```js
const lab = (await import('/tests/fixtures/lensing-lab.ts')).createLensingLab();
lab.view(0);                    // profil
lab.view(Math.PI / 2);          // face
lab.background('star');         // source ponctuelle
lab.foreground(true);           // objet au premier plan
lab.time(3600);                 // stabilité à temps long
await lab.benchmark();          // mesure GPU si disponible
lab.dispose();
```

Les tests automatisés vérifient notamment le seuil critique, le faible champ `2rs/b`, la convergence vers un pas huit fois plus fin, les images secondaires, les bords transparents, la cadence, l’hystérésis et la libération des cibles.

## Limites

Le modèle ne comprend ni rotation Kerr, ni transport spectral complet, ni temps de parcours différentiel. Les trajectoires critiques non résolues après 12,8 radians sont noires. La déviation rejoint progressivement le ciel direct entre 1,25 et 2 rayons externes du disque.

Les sources distantes sont traitées comme un ciel à l’infini. Les corps locaux conservent leur image directe lorsqu’ils ne sont pas occultés ; leur lentille exacte n’est pas calculée. Le filtrage n’implémente pas le filtre stellaire spécialisé de Bruneton. La sélection reste limitée par la résolution angulaire et le mélange des contributions transparentes. L’adaptation de résolution ne garantit pas un temps maximal de rendu sur tous les appareils.
