# Performance — lot 2, démarrage progressif et génération du catalogue en Worker

Issue [#4](https://github.com/guillaumegd/astra-explorer/issues/4), au-dessus du
lot 1 ([ordonnanceur et politique de qualité commune](LOT-1-ORDONNANCEUR.md)).
`quality.budget.population` publiait déjà, depuis le lot 1, la population à
préparer pour le premier rendu — rien ne la consommait encore.

## Le problème

`createGalaxy` appelait `catalogue.activeCount(120000)` avant même de créer les
buffers WebGL : cela forçait la génération synchrone des 120 000 astres et la
compilation de leurs orbites, alors que l'interface démarre affichée à une
fraction de ce total et autorise de descendre à 10 000. Deux boucles sur cette
même borne remplissaient ensuite les attributs GPU en rappelant
`compileOrbitChain` par astre, qui allouait un `Set` de détection de cycle à
chaque appel. `resolveReference` forçait lui aussi la génération complète dès
qu'un ID V2 valide était demandé, quel que soit l'astre visé.

## Démarrage léger

Les buffers par-astre (`positions`, `orbites`, couleurs, types…) sont
désormais alloués une seule fois à la capacité `MAX_BODIES`, jamais
réalloués ; ce qui change, c'est qu'ils ne sont **remplis** qu'au fur et à
mesure. Au démarrage, seule `quality.budget.population` est générée et
compilée de façon synchrone (20 000 en Automatique, 10 000 en Économie,
d'après les paliers du lot 1) — plus jamais 120 000. `geometry.setDrawRange`
suit exactement cette population initiale.

## Croissance en fond

Le reste du catalogue est généré en tâche de fond, par tranches, jusqu'à
`MAX_BODIES` :

- un **Worker** (`lib/catalogue/generate.worker.ts`) exécute `generateSystem`
  hors du thread principal — la fonction est pure (seed + index), donc son
  résultat est strictement identique à une génération synchrone ;
- sans Worker disponible, la même fonction de découpe (`generateChunk`,
  `lib/catalogue/generate.ts`) tourne sur le thread principal par tranches
  courtes programmées via `requestIdleCallback` (repli `setTimeout`), jamais
  en tâche longue ;
- chaque tranche est adoptée par `RuntimeCatalogue.adopt()` (même garantie
  déterministe que `ensure`), puis ses attributs GPU compacts sont écrits
  dans la plage nouvellement disponible et `geometry.setDrawRange` avance en
  conséquence, jusqu'à la densité demandée par l'utilisateur.

Un système complet peut dépasser légèrement `MAX_BODIES` (les systèmes ne
sont jamais coupés en deux) : la borne est reclampée à chaque adoption avant
de toucher les buffers GPU, pour ne jamais dépasser leur capacité allouée.

Le curseur de densité ne force plus de génération bloquante : il lit
désormais `RuntimeCatalogue.activeCountWithin()`, une variante en lecture
seule d'`activeCount()` qui ne grossit jamais le catalogue — seules
`ensure`/`adopt`/la croissance en fond le font. Monter le curseur au-delà de
ce qui est déjà généré affiche ce qui est disponible et rattrape sans à-coup
à mesure que la croissance en fond avance.

`resolveReference` extrait désormais l'index système contenu dans l'ID
(`v2:system:NNNNNN:body:BBB`) et n'ensure plus que jusqu'à ce système précis
via `ensureSystem()`, plus jamais jusqu'à `MAX_BODIES`.

## Allocations de la compilation orbitale

`compileOrbitChain` (`lib/orbits.ts`) détectait les cycles avec un `Set`
alloué à chaque appel ; la profondeur de chaîne étant bornée à
`ORBIT_DEPTH = 3`, un simple tableau local suffit et coûte moins à allouer.
Aucun changement de signature : tous les appelants existants (moteur, LOD
stellaire, comètes, tests) sont inchangés.

## Découpage du bundle

`lib/galaxy.ts` (le moteur, three.js compris) et `lib/ambient-audio` étaient
importés statiquement dans `app/page.tsx`, entraînant tout le reste de
l'application dans le même chunk que le moteur. Les deux sont maintenant
chargés par `import()` dynamique, en parallèle, dans l'effet de montage : la
coque (React, contrôles, i18n) forme un chunk séparé du moteur et de l'audio.

Le moteur reste **indispensable au premier canvas** — le découper ne réduit
pas à lui seul son poids sur le chemin critique, seuls les chunks non requis
avant le premier rendu (audio, worker de croissance) en sortent. Sur le build
statique réel (`out/`, celui déployé) :

| Chunk                | Rôle                              | Sur le chemin critique |
| --------------------- | ---------------------------------- | :---------------------: |
| `index-*.js`           | coque (React, contrôles, i18n)     | oui                     |
| `galaxy-*.js`          | moteur (three.js + `lib/galaxy.ts`)| oui                     |
| `ambient-audio-*.js`   | bande sonore                       | non                     |
| `generate.worker-*.js` | Worker de croissance du catalogue  | non (chargé après coup) |

`scripts/check-build-budget.mjs` mesure désormais ce chemin critique
séparément (`index-*` + `galaxy-*`) du total livré, au lieu de sommer tout
`out/` sans distinction — un chunk différé pouvait auparavant faire échouer
le budget à tort. Le calcul gzip Node peut différer de l'estimation affichée
par Vite.

**Plafonds actuels (provisoires) :** chemin critique 320 000 octets gzip
(mesuré 307 611 sur ce build), total livré 340 000 (mesuré 314 122). L'objectif
de 250 000 octets de l'issue **n'est pas atteint** par ce lot : le moteur seul
pèse ~188 000 octets gzip, la coque ~122 000, et le découpage ne réduit ni l'un
ni l'autre puisque les deux restent nécessaires avant le premier rendu.
Atteindre 250 000 demande une attribution des octets (empreinte three.js,
icônes) qui reste un suivi, comme l'anticipe l'issue ("250 ko dans un premier
temps, puis 200 ko après attribution des octets"). Les dictionnaires i18n
(quatre langues, ~30 ko non compressés au total) ont été évalués et **laissés
tels quels** : `lib/i18n/use-locale.ts` les résout délibérément de façon
synchrone avant le tout premier rendu pour éviter un flash de langue, et leur
poids est de toute façon négligeable face au moteur.

## Validation

`npm test` : 151 tests Node (152 avec le sous-test navigateur simulé), dont
trois nouveaux pour `RuntimeCatalogue` (`resolveReference` borné à son
système, croissance par tranches `adopt()`/`generateChunk()` bit-identique à
`ensure()` y compris après réduction puis remontée de densité) et un pour le
budget de build (chemin critique isolé des chunks différés). Lint, `tsc
--noEmit`, `npm run build` et `npm run build:static` passent, aussi sous
Linux x64 (`node:22.23.2-slim`) avant ce commit.

Vérification navigateur, build de développement local, Chromium sans
interface (Playwright), 1 280 × 800 — machine de développement, donc **aucune
mesure d'appareil ni de réseau bridé** :

| Contrôle                                          | Résultat                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------|
| Canvas présent / état « prêt » atteint             | ~1,3 s après navigation, sans réseau ni CPU bridés               |
| Curseur de densité glissé au minimum (10 000)      | affichage à 9 991, aucune erreur console                        |
| Curseur glissé au maximum (120 000) puis relâché   | affichage à 119 999, aucune erreur console                      |
| Descente puis remontée du curseur                  | densité affichée cohérente, aucune régénération visible          |
| Rendu du champ d'étoiles                            | dense et stable aux trois positions du curseur, aucun artefact  |

Non mesuré ici : le profil labo de l'issue (cache vide, 4 Mbit/s, RTT 150 ms,
appareil cible) et les critères « première UI ≤1 s / galaxie manipulable
≤3 s » qui s'y réfèrent — ils demandent le matériel et le réseau bridés listés
dans l'issue #2, qui porte la campagne. Non mesuré non plus : la mémoire
réellement économisée en Économie (10 000 corps) face au comportement
précédent (120 000 systématiques), qui demanderait un profil mémoire
navigateur plutôt qu'une estimation.
