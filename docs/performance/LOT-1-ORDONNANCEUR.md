# Performance — lot 1, ordonnanceur et politique de qualité commune

Issue [#3](https://github.com/guillaumegd/astra-explorer/issues/3), au-dessus du
lot 0. Deux modules remplacent le limiteur et la politique de la révision
auditée `ad69261` : `lib/frame-scheduler.ts` pour le calendrier de rendu,
`lib/quality-policy.ts` pour les budgets. Le moteur ne décide plus lui-même de
sa cadence ni de sa qualité.

## Ordonnanceur

Le calendrier conserve le reliquat temporel : la date de la prochaine image
avance d'une période, elle n'est pas recalée sur l'horloge à chaque image
rendue. Le rendu a lieu au callback le plus proche de cette date, à une
demi-période d'écran près. Le rafraîchissement est estimé par la médiane des
seize derniers intervalles plausibles ; les gels et les périodes masquées sont
écartés de cette estimation. Une cible plus rapide que l'écran est ramenée à
« un rendu par callback », sans file d'attente.

Le temps de simulation vient de l'horloge murale entre deux images rendues,
borné à 100 ms : sauter un rendu ne ralentit rien, et un gel ne se rattrape
pas. Après un gel ou un retour d'arrière-plan, le calendrier repart de
l'instant courant ; la première image ne fait avancer le monde d'aucun temps.

`npm run benchmark:cadence` rejoue ces situations sans navigateur et écrit le
JSON complet ; `cadence-baseline.json` est la sortie du 14 septembre 2026.
Callbacks parfaitement réguliers, dix secondes par cas :

| Écran simulé | Avant | Cible 30 | Cible 60 | Intervalles rendus à 60 |
| ------------ | ----: | -------: | -------: | ----------------------- |
| 60 Hz        |    30 |     30,0 |     60,0 | 16,7 ms                 |
| 90 Hz        |    45 |     30,0 |     60,0 | 11,1 et 22,2 ms         |
| 120 Hz       |    40 |     30,0 |     60,0 | 16,7 ms                 |
| 144 Hz       |    36 |     30,0 |     60,0 | 13,9 et 20,8 ms         |

À 144 Hz la cible 30 alterne 27,8 et 34,7 ms. Avec un bruit de ±3 ms sur les
callbacks, les moyennes restent à 30,0 et à 59,9–60,0. Les intervalles ne sont
donc uniformes que lorsque la cible divise le rafraîchissement : à 90 et
144 Hz, la moyenne est exacte et l'écart vaut une période d'écran. Aucune
uniformité n'est promise ailleurs.

Après un gel de trois secondes, la seconde suivante rend exactement 60 images
sur les quatre écrans : pas de rafale de rattrapage.

## Politique de qualité commune

Le contrôleur mesure en **temps écoulé**, jamais en nombre d'images rendues, et
publie un objet de budgets unique : cadence cible, DPR, plafond de pixels,
quota CPU, corps détaillés, résolution de grille, pas nuages, pas volumiques,
résolution optique et population préparée. Le moteur consomme aujourd'hui la
cadence, le DPR, le plafond de pixels, les pas volumiques, les corps détaillés
et la résolution optique ; grille, nuages et population sont le contrat des
lots 2 et 3.

Trois fenêtres glissantes d'une seconde : coût CPU du moteur, cadence rendue et
temps GPU complet. La fenêtre GPU n'est alimentée que lorsque les requêtes
asynchrones du lot 0 tournent, c'est-à-dire en mode `?diagnostics=1` et si
l'extension existe ; sinon elle est déclarée absente (`gpu: "unavailable"`) et
la décision repose sur le CPU et la cadence. Un temps CPU n'est jamais présenté
comme un temps GPU. Les marges sont
relatives à la période **réellement programmée**, pas à la cible théorique : un
écran 50 Hz ne déclenche donc pas de descente perpétuelle. Le temps
volontairement attendu est retiré du coût comme de la fenêtre.

- Descente : médiane au-dessus du quota, ou cadence sous 85 % de la cadence
  programmée, sur au moins 500 ms de mesures. Première baisse à 0,6 s.
- Secours : deux paliers d'un coup, sous le plancher du profil si nécessaire,
  quand une image dépasse à elle seule 1,5 fois sa période ou que la cadence
  tombe sous la moitié.
- Remontée : 95ᵉ centile sous 70 % du quota du palier **visé**, cadence tenue,
  pendant 12 s. Une descente qui suit de moins de 20 s une remontée double ce
  délai, jusqu'à 48 s.
- Réinitialisation des fenêtres au changement de visibilité, au redimensionnement
  réel et à la perte de contexte.

Un aller-retour de palier demande donc au minimum 12,6 s à charge stable.

Coût constant par image, profil Automatique, depuis son démarrage prudent :

| Coût par image | Première baisse avant | Première baisse après | Palier atteint après    |
| -------------- | --------------------: | --------------------: | ----------------------- |
| 40 ms          |                 3,6 s |                 0,6 s | `economy-floor` à 1,2 s |
| 50 ms          |                 4,5 s |                 0,6 s | `economy-floor` à 1,2 s |
| 100 ms         |                   9 s |                 0,6 s | `rescue` à 1,2 s        |

Ces durées décrivent le contrôleur sous un coût qui ne bouge jamais. Sur un
appareil réel, une baisse change le coût : la descente s'arrête plus haut.

## Profils

| Palier          | Cadence |  DPR | Plafond pixels | Corps détaillés | Pas volumiques | Optique |
| --------------- | ------: | ---: | -------------: | --------------: | -------------: | ------: |
| `high-60`       |      60 | 1,75 |            4 M |               8 |             16 |     512 |
| `high-entry`    |      60 | 1,25 |            4 M |               8 |             16 |     512 |
| `balanced-60`   |      60 | 1,25 |            2 M |               4 |              8 |     512 |
| `balanced-30`   |      30 |    1 |            2 M |               4 |              8 |     512 |
| `economy-30`    |      30 |    1 |            1 M |               2 |              4 |     256 |
| `economy-floor` |      30 |  0,8 |            1 M |               2 |              4 |     256 |
| `rescue`        |      30 |  0,7 |          0,7 M |               1 |              2 |     128 |

**Automatique** démarre à `balanced-30` — 30 images/s et DPR 1, démarrage
prudent — et peut monter jusqu'à `high-60`. **Économie**, choix explicite dans
Options › Avancé, démarre à `economy-floor` et plafonne à `economy-30`. Les
modes manuels fixent un plafond et une préférence de cadence ; le secours reste
possible sous surcharge sévère. Le mode mouvements réduits n'entre pas dans
cette décision : c'est une préférence d'accessibilité, pas un indicateur
d'appareil lent.

Un changement de palier ne touche ni les identités, ni les graines, ni la
sélection, ni les orbites, ni la navigation : `configure` conserve la
destination suivie et seul le rendu change. Le parcours de référence fige un
budget explicite (DPR 1, 16 pas, capture 512, cible 60) : ses mesures CPU et
GPU restent comparables au lot 0, ses intervalles ne le sont pas puisque la
cadence n'est plus plafonnée à 45.

## Arrière-plan

La boucle est réellement arrêtée quand l'onglet est masqué — `cancelAnimationFrame`
sur l'événement, pas seulement un `return` dans le callback — et relancée au
retour. Le calendrier, les fenêtres de mesure et l'intervalle de rendu sont
remis à zéro dans les deux sens.

## Validation

`npm test` : 148 tests Node, dont 8 pour l'ordonnanceur (60/90/120/144 Hz,
callbacks bruités, gel, retour d'arrière-plan, cible plus rapide que l'écran)
et 12 pour le contrôleur (contrat, démarrage prudent, première baisse ≤1 s,
absence d'aller-retour sur 10 s, attentes volontaires, fenêtres GPU,
réinitialisations, budget figé, plafond de pixels). Lint, `tsc --noEmit` et
build statique passent ; budget de build : 308 842 / 315 000 octets gzip.

Le test de l'ancienne politique par comptage d'images a été retiré : le
comportement qu'il protégeait est précisément celui que ce lot remplace.

Vérification navigateur, build statique local, Chrome 152 sans interface,
SwiftShader, 1 280 × 800, DPR écran 1 — un rendu logiciel, donc **aucune
mesure d'appareil** :

| Contrôle                                  | Résultat                                                                    |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Démarrage                                 | `balanced-30`, cible 30, DPR 1, 8 pas volumiques appliqués au premier rendu |
| Cadence rendue sur 12 s                   | 29,99 images/s pour une cible de 30                                         |
| Marge stable                              | promotion en `balanced-60` après une trentaine de secondes, une seule fois  |
| Onglet gelé (`Page.setWebLifecycleState`) | `document.hidden` vrai, **0 image** rendue en 5 s                           |
| Options › Avancé › Économie               | `economy-floor` appliqué : cible 30, DPR 0,8, 4 pas volumiques              |
| Retour à Automatique                      | `balanced-30` appliqué : cible 30, DPR 1, 8 pas volumiques                  |

La reprise après masquage n'a pas pu être déclenchée dans ce harnais :
`Emulation.setPageVisibilityOverride` n'existe plus dans ce Chrome et l'état
`active` ne rend pas la page visible sans interface. Elle reste couverte par les
tests de l'ordonnanceur (delta nul et absence de rafale au retour) et par le
bouton « Tester l'arrière-plan (35 s) » du panneau de diagnostic, à exécuter
manuellement.

Non mesuré ici : navigateur réel, GPU, téléphone physique et scènes de
référence exécutées. Les tableaux ci-dessus sont des simulations de
contrôleurs, pas des cadences d'appareil. Les mesures avant/après sur les
scènes du lot 0 restent à relever avec `?diagnostics=1` et « Parcours de
référence × 3 », sur le matériel listé dans l'issue #2.
