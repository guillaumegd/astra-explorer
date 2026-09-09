# Brief de relecture — Intro cinématique ASTRA

Document destiné à un audit externe. Il décrit une session de travail sur la séquence
d'ouverture du site : ce qui a été construit, **pourquoi**, ce qui a été vérifié, et où
sont les zones de risque.

---

## 1. Périmètre de la relecture

**À relire (travail de cette session) :**

| Fichier | État | Rôle |
|---|---|---|
| `lib/opening-sequence.ts` | non suivi par git | La timeline : une horloge unique, échantillonnée par frame |
| `lib/opening-audio.ts` | non suivi, **créé cette session** | Effets sonores procéduraux de l'intro (Web Audio) |
| `components/cinematic-intro.tsx` | non suivi | Le lecteur : boucle rAF, porte d'entrée, déclenchement des cues |
| `app/globals.css` | modifié | Styles de l'ouverture (section `.cinematic-opening` et suivantes) |
| `app/page.tsx` | modifié | Orchestration de la musique d'ambiance autour de l'intro |
| `lib/ambient-audio.ts` | modifié | 2 lignes seulement : durée de fondu paramétrable |
| `lib/i18n/types.ts` + 4 locales | modifiés | Clés `opening.start` et `opening.preparing` |

**Hors périmètre :** l'arbre de travail contient d'autres modifications non commitées
antérieures à cette session (`README.md`, `lib/galaxy.ts`, le gros du diff de
`app/page.tsx` qui vient d'un reformatage, `AUDIT-UI.md`, `PROPOSITION-UI.md`).
Le diff de `app/page.tsx` affiche ~1000 lignes changées : **seule une centaine
concerne cette session** (musique + props de `CinematicIntro`).

---

## 2. Architecture

### Une seule horloge

`sampleOpening(elapsed, reducedMotion)` est une **fonction pure** qui, pour un temps
écoulé donné, renvoie l'état complet de la scène : opacité de chaque lettre, du
sous-titre, du crédit, ouverture du voile, progression caméra, apparition de l'UI.
`CinematicIntro` accumule `elapsed` dans une boucle `requestAnimationFrame` et applique
le résultat via des variables CSS et des styles inline.

Conséquence à vérifier en relecture : **aucune transition CSS ni animation ne pilote le
contenu de la séquence**, tout passe par cette fonction. La seule animation CSS est la
respiration du bouton d'entrée.

### Deux domaines temporels

- `t` (unités internes de `sampleOpening`) : la chorégraphie, indépendante du rythme.
- `elapsed` (millisecondes réelles) : `elapsed = t × PACE`, avec `PACE = 2`.

`PACE` dilate toute la séquence sans toucher aux proportions. La durée totale est
`BASE_DURATION × PACE = 7800 × 2 = 15 600 ms`.

### Synchronisation son / image

`openingCues(reducedMotion)` dérive les instants de déclenchement sonore **des mêmes
constantes** que `sampleOpening`, converties en millisecondes réelles. C'est délibéré :
retoucher le rythme ne peut pas désynchroniser le son, il n'y a pas de nombres dupliqués
entre les deux.

---

## 3. La timeline (en millisecondes réelles, depuis le clic)

| Moment | Visuel | Son |
|---:|---|---|
| 600 → 5200 | Logo puis A·S·T·R·A, en cascade (départ toutes les 440 ms, fondu de 2400 ms chacun) | 6 tics à 600 / 1040 / 1480 / 1920 / 2360 / 2800 |
| 5400 → 6900 | Sous-titre | Souffle grave à 6000 |
| 7100 → 8400 | Crédit / nom | Souffle aérien à 7620 |
| 8400 → 10200 | **Pause tenue**, rien ne bouge | Drone grave à 8400 (gonfle sur 1800 ms) |
| 10200 → 13200 | Ouverture du voile, la galaxie apparaît | Pluie d'étoiles + riser + **montée de la musique** à 10800 |
| 10200 → 14800 | Vol de caméra | Riser d'air (4000 ms) |
| 12600 → 14600 | Titre, sous-titre et crédit s'effacent | — |
| 14800 → 15600 | L'interface apparaît | — |

Les écarts titre→sous-titre et sous-titre→nom sont volontairement identiques (100 unités
`t`, soit 200 ms), demande explicite.

---

## 4bis. Point d'honneur — réécouter et repenser les deux « souffles »

**C'est la priorité n°1 de cet audit, avant tout le reste de la section 4.** Les deux
effets qui accompagnent l'apparition du sous-titre (« Le temps peut attendre. ») et du
crédit/nom (« une expérience proposée par Guillaume Girard ») — méthode `breath()` dans
`lib/opening-audio.ts` — n'ont jamais été validés à l'oreille (voir §7 : le navigateur de
test n'a pas de sortie audio, seule leur planification a été vérifiée). Ils sont
probablement à revoir, pas seulement à confirmer.

Implémentation actuelle des deux appels `breath('invitation')` et `breath('credit')` :

- **Même source, même méthode, deux jeux de paramètres.** Un bruit blanc **brut** (non
  lissé — voir ci-dessous) passe dans un filtre passe-bande (`Q = 0.7`, large) dont la
  fréquence centrale balaie 300→950 Hz pour le sous-titre, 620→1900 Hz pour le crédit, sur
  1,5 s. Seuls le registre et le gain (0,17 vs 0,15) distinguent les deux — à vérifier que
  ça suffit à les rendre reconnaissables comme deux événements différents plutôt que comme
  la même texture jouée deux fois avec un filtre légèrement décalé.
- **Bruit non lissé.** Le buffer de bruit de `opening-audio.ts` est un bruit blanc pur
  (`random() * 2 - 1` échantillon par échantillon). C'est différent de
  `lib/ambient-audio.ts`, où le bruit ambiant passe par une marche aléatoire lissée
  (`smoothed = smoothed * 0.6 + bruit * 0.4`) avant tout filtrage — ce qui lui donne une
  texture plus douce, moins sifflante. Passer un bruit blanc brut dans un passe-bande large
  peut sonner plus proche d'un souffle d'air comprimé ou d'un « shhh » sifflant que d'un
  souffle organique. À réécouter en priorité : est-ce que ça correspond à l'intention
  (« souffle » évoquant la respiration, pas un bruit de synthé) ?
- **Décalage possible avec le fondu visuel.** Chaque `breath()` dure ~2,4 s de bout en
  bout (attaque 0,6 s, puis décroissance exponentielle), déclenché à 40 % du fondu visuel
  (`ONSET = 0.4`, voir §4-c). Le fondu du sous-titre ne dure que 750 ms, celui du crédit
  650 ms : le son continue donc bien après que le texte a fini d'apparaître. Vérifier si
  cette traîne est voulue (elle accompagne le texte qui reste affiché) ou si elle bave sur
  l'effet suivant — le crédit (7100→8400 ms) est suivi de très près par le drone de la
  pause tenue (8400 ms), donc les deux queues de `breath('credit')` et de `drone()` se
  chevauchent presque forcément.
- **Gain élevé pour du bruit filtré large.** 0,15–0,17 sur un passe-bande `Q = 0.7` (donc
  peu sélectif) laisse passer une bonne partie du spectre du bruit — à comparer au tic de
  lettre (gain 0,12, mais un ton pur, donc perçu différemment) et à vérifier qu'il n'écrase
  pas la musique d'ambiance qui monte peu après (10 800 ms).

Ne pas se contenter de confirmer que le graphe Web Audio se construit sans erreur : ces
deux effets doivent être **écoutés** avec une vraie sortie audio, comparés l'un à l'autre,
et probablement retravaillés (lissage du bruit, `Q` plus serré, timbres plus distincts,
durée resynchronisée sur le fondu visuel réel) avant d'être validés.

---

## 4. Décisions de conception à challenger

Ces choix sont assumés mais discutables — ce sont les points sur lesquels un avis
extérieur a le plus de valeur.

**a) Deux `AudioContext` distincts.** L'ambiance (`lib/ambient-audio.ts`) et les effets
d'intro (`lib/opening-audio.ts`) ont chacun le leur. Motif : ne pas toucher au graphe
ambiant qui fonctionne. Coût : deux contextes simultanés (Chrome en tolère ~6). Celui de
l'intro est fermé au démontage du composant.

**b) Le contexte audio de l'intro est créé dans le handler de clic, pas au montage.**
Les navigateurs n'autorisent un contexte à démarrer que depuis un geste utilisateur.
De même, la musique est **amorcée à volume 0 au clic** puis montée 10 s plus tard : créer
le contexte au moment de la révélation aurait reposé sur la « sticky activation »
(plus fragile sur Safari) et fait construire tout le graphe ambiant sur la frame la plus
délicate de la séquence.

**c) Les cues sonores ne tombent pas au début des fondus.** Avec des fondus de 2400 ms,
un son placé au début de la rampe s'entend bien avant que quoi que ce soit ne soit
visible. `ONSET = 0.4` place chaque cue là où l'élément devient lisible.
**Le titre est l'exception** (`ONSET` non appliqué) : ses lettres se chevauchent — chaque
rampe dure plus de cinq écarts — donc tout décalage significatif fait tomber le son sur
une lettre postérieure. Ce bug a été constaté à l'oreille puis corrigé.

**d) Le drone n'est pas seulement grave.** 55 Hz seul est inaudible sur des haut-parleurs
d'ordinateur portable. Le drone empile 55 / 110 / 165 Hz avec un passe-bas à 420 Hz :
la profondeur reste au casque, le poids passe sur enceintes.

**e) Les effets de l'intro ignorent le bouton muet.** Ils jouent même si la musique est
coupée. Discutable ; la raison est qu'au moment de l'intro l'utilisateur n'a pas encore
accès aux contrôles (l'UI est masquée). Ce point pèse plus lourd depuis que le skip a été
retiré (voir §5, dernier point) : la séquence de 15,6 s ne peut plus être interrompue, donc
un visiteur qui voudrait du silence est obligé de la subir en entier.
**C'est le point le plus contestable de la session.**

**f) La porte reste montée après le clic.** `{!started && ...}` aurait provoqué une coupe
sèche ; elle est donc conservée dans le DOM avec `data-open` + `inert` pour pouvoir
disparaître en fondu sans piéger le focus.

**g) Libellé du bouton : « Embarquer »** (`Embark` / `Embarcar`). Choisi après avoir
écarté « Entrer » (plat) et « Lever les yeux » (lisible comme une action physique à
accomplir). Réserve assumée : c'est une métaphore de transport, alors que le reste des
textes est contemplatif (« OBSERVATOIRE INTERACTIF », « Le temps peut attendre. »).
Le bouton n'est pas focalisé programmatiquement — c'est le seul élément focusable pendant
l'ouverture (l'en-tête et le dock sont `inert`), donc une tabulation suffit, et cela évite
d'imposer un anneau de focus dès le chargement.

**h) `astra-opening-seen-v1` porte un TTL d'1h, pas un flag permanent.**
`localStorage` stocke `Date.now()` au lieu de `'1'` ; `hasSeenOpening()` compare l'écart à
`OPENING_SEEN_TTL = 3 600 000`. Un visiteur qui revient plus d'une heure après revoit
l'intro. Conséquence directe : depuis que le skip est supprimé (§5), cette valeur n'est
jamais écrite avant la fin réelle de la séquence de 15,6 s — il n'existe plus de chemin qui
la marque « vu » prématurément.

---

## 5. Bugs trouvés et corrigés pendant la session

Utile pour calibrer l'audit — voici la classe de défauts qui vit dans ce code.

1. **Le clic sur la porte déclenchait le « skip ».** Un mécanisme de saut existait
   (`pointerdown`/`wheel`/`keydown` sur la fenêtre), et le clic d'entrée le traversait.
   Corrigé d'abord par un verrou, puis **le skip a été supprimé entièrement** dans un tour
   suivant : la séquence ne peut plus être interrompue, elle va toujours jusqu'à
   `elapsed >= OPENING_DURATION`. Raison du retrait : garantir que `rememberOpening()`
   (le TTL d'1h sur `astra-opening-seen-v1`, voir §4-h) ne marque « vu » que pour un
   visiteur qui a réellement regardé la séquence en entier, jamais pour quelqu'un qui l'a
   juste traversée d'un clic.
2. **`onReveal` était enfermé dans `if (sound)`.** Si la création du contexte audio
   échouait, la musique n'aurait jamais démarré. Sorti du bloc conditionnel.
3. **La musique restait à plein volume au rejeu.** `replayOpening` réaffichait la porte
   sans redescendre le son. Corrigé par un fondu vers 0.
4. **Décalage d'une lettre sur les tics** (voir 4-c).
5. **Un commentaire CSS affirmait « 4.5-second opening »** alors que la durée avait
   quadruplé ; un autre dans `ambient-audio.ts` affirmait que le son continue en
   arrière-plan, ce qui est devenu faux.
6. **`.opening-logo` absent de la règle `prefers-reduced-motion`** qui neutralise le flou.

---

## 6. Ce qui a été vérifié, et comment

Vérification par pilotage d'un Chrome réel via le Chrome DevTools Protocol, avec
instrumentation de `AudioParam.prototype.setTargetAtTime`, `createOscillator` et
`createBufferSource` injectée avant le chargement de la page.

- **Séquence complète** jouée après un vrai clic souris : `elapsed` progresse
  normalement, l'intro se démonte, l'interface reprend la main. **Aucune exception.**
- **Chaque cue sonore** part à ±12 ms de sa cible calculée. Les 6 tics sont espacés de
  ~440 ms constants.
- **Musique** : rampe à `0` au clic, puis à `0.245` avec un tau de 1.5 à t+10 827 ms,
  soit exactement l'ouverture du voile.
- **Onglet en arrière-plan** (simulé en surchargeant `document.hidden`) : rampe à `0`
  avec le même tau que le bouton muet ; retour au volume initial au premier plan.
- **Rejeu** : parcours Options → À propos → Revoir ; une seule rampe `value=0 tau=0.6`,
  puis la porte réapparaît.
- `tsc --noEmit`, `oxlint` et les 34 tests du dépôt passent.

---

## 7. Points ouverts / non vérifiés

- **Le rendu sonore lui-même n'a pas pu être écouté** : le navigateur de test est sans
  sortie audio. Seules la construction du graphe et la planification sont prouvées, pas
  l'esthétique ni l'équilibre des niveaux.
- **Le chemin `prefers-reduced-motion` n'a pas été exécuté.** Il est codé (cascade
  remplacée par une apparition simultanée, un seul tic au lieu de six, caméra à 1) mais
  jamais testé.
- **Si WebGL échoue**, `openingVisible` passe à faux : plus de porte, donc la musique ne
  démarre jamais. Jugé acceptable (l'application est de toute façon inutilisable) mais
  c'est un chemin non couvert.
- **Aucun test automatisé ne couvre l'ouverture.** `tests/` ne contient rien sur
  `opening-*`. `sampleOpening` et `openingCues` sont des fonctions pures, donc
  trivialement testables — c'est le manque le plus évident.
- **Durée totale de 15,6 s**, atteinte par allongements successifs demandés, et **non
  interruptible** depuis le retrait du skip (§5). Elle ne se rejoue pas dans l'heure qui
  suit un visionnage (`localStorage`, TTL — §4-h), sauf via « Revoir l'introduction ».

---

## 8. Ce que j'aimerais que l'audit regarde en priorité

1. **§4bis, avant tout le reste** : réécouter `breath('invitation')` et `breath('credit')`
   avec une vraie sortie audio, et juger s'ils doivent être retravaillés (bruit lissé,
   `Q` plus serré, timbres plus distincts, durée resynchronisée sur le fondu visuel).
2. La boucle `useEffect(..., [])` de `cinematic-intro.tsx` et son motif de ref
   `current.current` : risque de closure obsolète, cohérence du nettoyage.
3. La libération des nœuds Web Audio dans `opening-audio.ts` (`release()` branché sur
   `onended`) : fuite possible si une source ne se termine jamais.
4. La course entre `enableMusic`, le `musicStarted` ref et le `setEnabled` asynchrone de
   `ambient-audio.ts`.
5. Le point 4-e : faut-il que les effets respectent le bouton muet — question renforcée
   maintenant que la séquence n'est plus interruptible ?
