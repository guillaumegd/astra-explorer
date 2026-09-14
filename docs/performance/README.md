# Performance — lot 0, instrumentation et parcours

Lot suivant : [ordonnanceur de cadence et politique de qualité commune](LOT-1-ORDONNANCEUR.md).
Ce document décrit l'instrumentation du lot 0 ; le limiteur à 45 images/s et la
politique par comptage d'images qu'il mesurait n'existent plus depuis le lot 1.
La livraison DOM, pause, audio et HTTP est décrite dans le
[lot 5](LOT-5-DOM-PAUSE-AUDIO-LIVRAISON.md).

## Capture locale

Ouvrir le build statique avec `?diagnostics=1`, puis « Diagnostic local ».
« Afficher la capture » fige les mesures et affiche un résumé compact.
« Télécharger la capture » exporte le JSON complet correspondant. Cliquer de
nouveau sur « Afficher » pour actualiser avant un nouvel export.
L'événement `astra:export-diagnostics` reste disponible en console.
Aucun envoi réseau. Sans ce paramètre, pas de capture ni de panneau.
Le tampon conserve les 3 600 derniers événements (rAF, images, qualité,
sélection, première image). `dropped` indique les événements écrasés : exporter
rapidement pour garder tous les détails du démarrage. Les pics restent dans
les échantillons. Les 64 derniers événements importants sont aussi conservés
séparément dans `milestones`, avec un compteur cumulatif `renderedFrames`.
Les commandes de test permettent une perte/restauration WebGL et l'ouverture
d'un onglet neutre de 35 secondes pour un essai manuel d'arrière-plan.
La capture ne certifie le masquage que si deux événements `visibility` encadrent
une période ≥30 s, avec mêmes compteurs et temps de simulation.

`raf.intervalMs` mesure les callbacks ; `frame.intervalMs` les soumissions
réellement rendues par le moteur, pas les présentations du compositeur.
Les périodes masquées réinitialisent les intervalles. `cpuMs` couvre le moteur,
`updateCpuMs` sa préparation et `renderSubmissionCpuMs` la soumission des passes.
Ces mesures ne sont pas des durées GPU.

En diagnostic, `renderer.info.autoReset = false` et les compteurs sont remis
à zéro au début de chaque image : scène, faces cubiques, profondeur et composite
sont cumulés. Le picking a son propre événement et sa propre remise à zéro.
Géométries/textures sont des comptes de ressources, pas des octets de VRAM.
`skyCapture` reprend le chronomètre existant avec sa source CPU/GPU explicite ;
les événements `gpu-pass` et `gpu-frame` fournissent désormais les requêtes GPU
asynchrones sans chevauchement. `complete` indique si toutes les passes ont
une mesure valide ; extension absente, disjoint et perte de contexte donnent
une valeur nulle explicite. La somme des passes exclut la présentation écran. La caméra, la sélection, la densité,
le temps de simulation et la rotation sont inclus pour contextualiser la capture.
`first-frame.engineStartupMs` part de l'entrée dans createGalaxy, pas de la navigation.

## Microbenchmark et CI

`npm run benchmark:catalogue` : catalogue neuf pour chaque passage, budgets
10k/20k/65k/120k, un échauffement puis cinq mesures conservées et médianes.
La graine est celle du catalogue V2. `catalogue-baseline.json` est la mesure
locale du 13 septembre 2026 (macOS arm64, Node 22.23.2). Elle exclut le navigateur,
les transferts GPU et la compilation des shaders et ne certifie aucun mobile.

`npm run build:static && npm run check:build-budget` bloque la CI si le JS du
chemin critique (coque + moteur, voir le
[lot 2](LOT-2-DEMARRAGE-PROGRESSIF.md)) ou le total livré dépassent leurs
plafonds provisoires (320 000 puis 340 000 octets gzip). L'objectif de
250 000 octets sur le seul chemin critique reste ouvert : le moteur (three.js)
et la coque en représentent déjà la quasi-totalité à eux deux.
Le calcul gzip Node peut différer de l'estimation affichée par Vite.

## Parcours et mémoire

Les boutons « Parcours de référence × 3 » et « Endurance 15 min » utilisent
`lib/reference-replay.ts` : 19 scènes, IDs et poses versionnés, DPR 1,
16 pas volumétriques, capture cubique 512. Chaque scène conserve 60 images
d'échauffement séparées, puis 120 mesures, avec p50/p95/p99/max CPU/GPU.
Les résultats agrégés restent dans `replay.results` malgré la rotation du tampon.
L'endurance boucle jusqu'à 15 minutes, puis termine la scène courante.
Les premières approches sont identifiées, mais ne certifient pas un cache vide.

La mémoire estime les buffers attachés aux scènes (dédupliqués) et les cibles
connues. Elle exclut caches détachés, textures de matériaux et surcoûts pilote :
c'est une borne partielle, pas la VRAM totale. Les PerformanceObservers
collectent long tasks et événements lorsque le navigateur les expose.

## Validation et conditions de fermeture

129 tests Node et 2 tests Python de déploiement simulé passent ; lint,
TypeScript et build statique passent. Budget : 306 578 / 315 000 octets gzip.
Les tests couvrent aussi les requêtes GPU différées/disjointes, leur borne,
les estimations mémoire, les IDs et poses du parcours et le budget bloquant CI.
Voir [le rapport navigateur](BROWSER-VALIDATION.md) : ses captures précèdent
les derniers ajouts GPU/mémoire/parcours et ne les valident donc pas.
La reprise de cette validation Chrome a été refusée par le contrôle automatique
pour quota d'utilisation atteint le 14 septembre 2026.

L'issue #2 reste ouverte jusqu'à :

- validation navigateur des nouveaux chronomètres et exécution/export des trois
  passages et de l'endurance ; seuils de régression de rendu comparables en CI ;
- couverture complète : introduction/cache vide/audio, trou noir dans nébuleuse,
  gestes tactiles et 20 destinations distinctes (le manifeste compte 19 scènes) ;
- mesures physiques Windows iGPU/8 Go, Android/4 Go, ancien iPhone/Safari et
  contrôle 60/120 Hz, avec modèles, OS, pilotes et écrans documentés.

Aucune mesure de matériel absent ni exécution d'endurance n'est revendiquée.
