# Validation locale du diagnostic — 13 septembre 2026

Chrome 150, macOS, build statique local ; viewport initial 1 728 × 1 084,
puis 1 728 × 1 028 CSS, DPR écran 2, DPR moteur initial 1,75. Les dimensions
exactes sont dans chaque capture. Le navigateur est piloté et ce poste n'est
pas représentatif d'un appareil modeste. Aucun résultat ne certifie un GPU mobile.

## Vérifications réalisées

| Contrôle | Résultat |
|---|---|
| Démarrage diagnostic | Première image à 207,5 ms après entrée moteur dans la capture initiale ; ne comprend pas tout le chargement de page |
| Export réel | JSON téléchargé puis relu sur disque, 1 772 événements au premier export ; structure et valeurs numériques vérifiées |
| Tampon borné | 3 600 événements maximum ; dépassements déclarés dans `dropped` |
| Vue galaxie | 15 appels de rendu par image observée |
| Trou noir `v2:system:000000:body:000` | 84 appels en régime observé, jusqu'à 98 pendant la capture comprenant la transition ; cumul scène/cube/profondeur/composite |
| Temps GPU | Source GPU réelle pour la capture du ciel ; GPU complet explicitement indisponible |
| Perte/restauration WebGL | Perte à 81 858,1 ms, restauration à 82 872,5 ms ; rendu repris, même sélection et aucune erreur console capturée |
| Pause | Simulation stable à 91,6808 s ; 6 appels de rendu continu par image. Comportement actuel confirmé, rendu à la demande à traiter au lot 5 |
| Picking canvas | Sélection réelle, événement à 27 903,8 ms ; CPU 9,5 ms, un draw call de 64 995 points ; fiche/navigation fonctionnelles |
| Densité | 10 000 → 9 991 actifs ; 120 000 → 119 999 actifs ; retour aux réglages initiaux réussi |
| Menus et zoom | Options, fiche, astre suivant, retour galaxie et commande de zoom exécutés sans erreur console capturée |
| Portrait/paysage | Iframe locale 390 × 844 puis 844 × 390 ; panneau accessible, défilement et accès à « À propos » validés ; dimensions réelles confirmées par capture |
| Diagnostic désactivé | Sans query param, aucun panneau diagnostic et aucune erreur console capturée |
| Barrière CI | Test avec sortie absente, vide, petit bundle et chunk imbriqué trop gros : refus/acceptation attendus |

Le responsive a été testé avec une page de contrôle temporaire dans `out/`,
retirée au build final. Ce n'est ni une émulation de GPU ni un test tactile.

## Mesures conservées, pics inclus

Les JSON complets sont compressés sans modification dans `browser-*.json.gz`.
`browser-summary.json` contient percentiles, maxima, nombre d'événements et
empreinte SHA-256 du JSON décompressé. Les captures couvrent des transitions et
ne doivent pas être interprétées comme des moyennes de scène stabilisée.

Vue galaxie : intervalles p95 25,8 ms, maximum 58,3 ms ; CPU p95 2,2 ms,
maximum 62,4 ms. Capture incluant la lentille : intervalles p95 25,8 ms,
maximum 58,3 ms ; appels jusqu'à 98. La capture WebGL comprend un intervalle
maximum 116,7 ms ; la capture comprenant la transition en pause atteint
149,9 ms. Ces pics sont conservés, pas exclus du rapport.

## Corrections effectuées pendant la vérification

- Affichage compact à la demande, export complet conservé : ne plus insérer
  des milliers d'événements JSON dans l'arbre visible du navigateur.
- Conservation bornée des événements importants et compteur total d'images.
- Réinitialisation des horloges sur `visibilitychange` : certains navigateurs
  n'exécutent aucun rAF caché. Cette correction est issue de l'inspection du code ;
  son comportement en arrière-plan réel a été confirmé par le test manuel ci-dessous.
- Intervalles réinitialisés lors d'une perte WebGL ; nettoyage du panneau,
  des écouteurs et des temporisations au démontage.

## Arrière-plan et contrôles restant à effectuer

- **Arrière-plan réel : validé après intervention manuelle.** La capture
  `browser-background.json.gz` conserve une période de 35 473,7 ms, avec
  compteur strictement inchangé (2 114 images) et simulation strictement
  inchangée (52,8394 s). Une autre période de 197 609 ms conserve aussi les deux
  valeurs. Le rendu reprend ensuite ; les dernières images capturées sont
  espacées de 25 ms, sans erreur console. Voir `browser-background-summary.json`.
  Les premières tentatives pilotées étaient non concluantes ; le test manuel
  apporte la preuve de visibilité réelle qui manquait.
- Sommeil audio : non mesuré via AudioContext ; aucune conclusion par la seule UI.
- Pinch tactile, véritable rotation mobile, Android/iPhone/iGPU Windows.
- Trace DevTools CPU complète et requêtes GPU par passe (instrumentation manquante).
- Trois passages déterministes par scène, 20 destinations, endurance active 15 min,
  plateau mémoire et premier chargement sous réseau contraint.

Validation finale : 122 tests Node et 2 tests Python (SFTP simulé) réussis, lint
et TypeScript réussis, builds statique et serveur réussis. Bundle JS : 303 405
octets gzip sur un plafond provisoire de 315 000. Aucun déploiement effectué.

Le lot 0 est donc avancé et partiellement vérifié ; il n'est pas déclaré terminé.
