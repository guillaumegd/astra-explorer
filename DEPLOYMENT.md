# Première mise en ligne

## Version française

Le dépôt de référence est `git@github.com:guillaumegd/astra-explorer.git`.
La branche `main` contient la version française initiale. GitHub Actions vérifie
le lint, les tests, la compilation et les types à chaque push et pull request.
Les dépendances, secrets locaux et fichiers générés sont exclus du dépôt.

## Hébergement

Le build actuel utilise Vinext et Cloudflare Workers : `dist/client` contient
les ressources publiques et `dist/server` le serveur. Envoyer ces dossiers par
FTP ne suffit pas à exécuter l'application sur un hébergement web OVH classique.

Cloudflare Workers est la voie recommandée pour conserver cette architecture.
Après connexion du dépôt GitHub dans Workers Builds :

- branche de production : `main` ;
- installation : `npm ci` ;
- compilation : `npm run build` ;
- déploiement : `npx wrangler deploy --config dist/server/wrangler.json` ;
- version de Node : 22.13 ou supérieure ;
- le nom du Worker doit correspondre au champ `name` de la configuration générée
  (actuellement `sites-project`).

La configuration `.openai/hosting.json` permet également une publication avec
Sites ; aucun projet distant n'y est encore associé.

Pour utiliser OVH FTP, prévoir d'abord une adaptation et une validation du build
en site statique. Ne pas transférer `node_modules`, les sources ni les secrets.

Documentation : https://developers.cloudflare.com/workers/ci-cd/builds/

## Internationalisation — après la première publication

Créer un commit distinct après validation de l'URL de la version française :
`feat: add English and European Portuguese interface translations`.

- Conserver le français et ajouter `en` et `pt-PT`.
- Parcourir `navigator.languages` dans l'ordre ; utiliser la première langue
  prise en charge, avec français par défaut. Les variantes anglaises utilisent
  `en` et les variantes portugaises la traduction européenne `pt-PT`.
- Proposer Automatique, Français, English et Português (Portugal).
- Mémoriser le choix manuel dans `localStorage` ; Automatique réactive la
  préférence du navigateur. Gérer l'indisponibilité du stockage.
- Traduire les contrôles, aides, états, fiches d'astres et libellés accessibles ;
  conserver les identifiants et la génération procédurale.
- Adapter `html.lang` et les formats numériques à la langue active.
- Vérifier la détection, le forçage persistant, le retour à Automatique et
  l'absence de réinitialisation de la scène lors d'un changement de langue.

Les traductions ne font pas partie de la première version.
