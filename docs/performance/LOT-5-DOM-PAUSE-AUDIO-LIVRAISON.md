# Performance — lot 5, DOM, pause, audio et livraison HTTP

Issue [#7](https://github.com/guillaumegd/astra-explorer/issues/7), au-dessus des
lots 0 à 4. Cette livraison traite les mécanismes applicatifs ; elle ne prétend
pas remplacer la recette sur les appareils de référence ou l'inspection des
en-têtes de l'hébergement réel.

## Interface et rendu

Les coordonnées RA/DEC sont isolées dans `PointingReadout`. Le moteur les
publie à 2 Hz au plus hors diagnostic (5 Hz avec capture), et seulement après
un changement à la seconde d'arc affichée : une mise à jour ne reconstruit plus
la coque React complète.

Les attributs de diagnostic du canvas et les styles d'overlay passent par des
écritures conditionnelles. Les marqueurs d'astres, de systèmes et de régions
se déplacent avec des variables CSS et `translate3d`, plutôt que par `left` et
`top`. Les dimensions ne sont relues que dans le gestionnaire de resize. Ces
changements évitent les mutations inutiles ; une trace DevTools reste nécessaire
pour attribuer un layout forcé à un goulot.

Quand la pause est active, le moteur laisse la caméra et les fondus se stabiliser
puis arrête sa boucle. Une sélection, un geste, le zoom, un resize, un changement
de qualité, de langue, de scène ou d'inset réveille une fenêtre de rendu. Le
retour d'un onglet caché et une restauration WebGL l'invalident également, sans
rattraper le temps de simulation.

En Économie, les panneaux ne demandent plus de flou de compositing. Le graphe
audio, toujours construit uniquement à partir d'un geste utilisateur, emploie
une impulsion de convolution plus courte et deux voix soutenues au lieu de cinq.
Une bascule de qualité ne force jamais l'activation du son. La première mise en
route audio est inscrite dans la capture locale comme `audio-first-gesture` et
sa latence.

## Livraison et recette restante

`.htaccess` fixe le cache long et `immutable` des assets Vite hachés, et la
revalidation courte de HTML. Le script SFTP publie les assets avant `index.html`
et ne les supprime pas ; les anciennes références restent donc accessibles durant
la transition. La compression, le type MIME réel et les en-têtes définitifs sont
à confirmer avec les commandes de [DEPLOYMENT.md](../../DEPLOYMENT.md) sur la
production OVH.

La matrice de clôture reste à exécuter : trois parcours chauds et une endurance
de 15 minutes sur chaque appareil de référence, une approche à froid notée à
part, puis comparaison aux budgets de l'issue parente (cadence, p75 interaction,
qualité stabilisée et pics). Aucun résultat de cette matrice ni certification
« petits PC et mobiles » n'est déclaré par ce document.
