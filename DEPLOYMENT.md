# Première mise en ligne

## Version française

Le dépôt de référence est `git@github.com:guillaumegd/astra-explorer.git`.
La branche `main` contient la version française initiale. GitHub Actions vérifie
le lint, les tests, la compilation et les types à chaque push et pull request.
Les dépendances, secrets locaux et fichiers générés sont exclus du dépôt.

## Hébergement retenu : OVH statique + FTP

Compiler avec Node 22.13 ou supérieur :

```sh
npm ci
npm run build:static
npm run preview:static
```

Le dossier `out/` est le site complet : `index.html`, `favicon.svg` et `assets/`.
Aucun serveur Node, Worker, base de données ou compte Cloudflare n'est nécessaire
chez l'hébergeur. JavaScript et WebGL doivent être disponibles dans le navigateur.
Prévisualiser avec le serveur HTTP ci-dessus, pas en ouvrant le HTML en `file://`.
Les chemins relatifs permettent aussi une installation dans un sous-dossier.

### Première publication

1. Dans l'hébergement OVH existant, ajouter `astra.guillaumegirard.fr` en multisite
   avec le dossier racine dédié `astra-explorer` (distinct du dossier du site
   principal). Utiliser les valeurs DNS indiquées par OVH pour cet hébergement.
2. Activer le certificat SSL pour ce sous-domaine.
3. Configurer la pipeline GitHub ci-dessous, puis pousser sur `main`.
4. Ouvrir `https://astra.guillaumegirard.fr` et vérifier la galaxie et les commandes.

### Pipeline GitHub → OVH

Dans le dépôt GitHub, ouvrir **Settings → Secrets and variables → Actions**.
Dans l'onglet **Secrets**, ajouter les trois secrets du dépôt :

| Secret | Valeur |
| --- | --- |
| `FTP_HOST` | Nom du serveur FTP fourni par OVH, sans `ftp://` ni chemin |
| `FTP_USERNAME` | Identifiant FTP OVH |
| `FTP_PASSWORD` | Mot de passe FTP OVH |

Dans l'onglet **Variables**, ajouter :

| Variable | Valeur |
| --- | --- |
| `FTP_DIRECTORY` | `astra-explorer`, dossier ASTRA existant vu par ce compte FTP |

Vérifier ce chemin dans le client FTP : il dépend de la racine du compte FTP,
qui peut différer du chemin absolu affiché dans OVH. Le script refuse une valeur
vide, la racine, `www` seul et les chemins contenant `..`. Ne jamais désigner le
dossier du site principal. Le dossier cible doit déjà exister.

`public/.htaccess` est versionné, copié dans `out/` par Vite, inclus parmi les
fichiers cachés de l'artefact GitHub et envoyé dans `astra-explorer/.htaccess`.
Il force HTTPS : le certificat SSL du sous-domaine doit être actif avant la
publication. Le fichier `www/.htaccess` du site principal reste indépendant.

À chaque push sur `main`, `.github/workflows/ci.yml` :

1. installe les dépendances, vérifie le lint et les tests ;
2. compile les versions historique et statique et vérifie les types ;
3. conserve `out/` comme artefact téléchargeable pendant 14 jours ;
4. envoie cet artefact sur OVH par **FTPS explicite sur le port 21**, avec
   vérification du certificat et chiffrement des données ;
5. transfère les assets avant de remplacer `index.html` par renommage du fichier
   temporaire. Les anciens assets restent disponibles ; aucun nettoyage distant
   automatique n'est effectué.

Les pull requests sont vérifiées sans déploiement. Les publications sont
sérialisées pour éviter deux transferts simultanés. Une configuration manquante
fait échouer clairement le job de publication ; aucun transfert n'est effectué.
La pipeline peut aussi être relancée via **Actions → Validate and deploy OVH →
Run workflow**, en sélectionnant `main`. Les secrets ne doivent jamais être
inscrits dans les sources ni envoyés dans une conversation.

Le déploiement initial nécessite ces secrets et le dossier OVH. Pour revenir à
une version précédente, annuler le commit concerné avec `git revert`, puis
pousser sur `main` : cette version sera reconstruite et publiée.

Le transfert FTP n'est pas une transaction complète : les assets déjà envoyés
restent en place en cas d'échec. L'ancien HTML reste actif jusqu'au renommage
final, et les erreurs de connexion font échouer la pipeline. Le nettoyage des
anciens assets est manuel, après vérification qu'ils ne sont plus utilisés.

Ne pas modifier la racine du site principal ni remplacer sa zone DNS.
Le build historique `npm run build` et la configuration Sites restent disponibles
séparément ; ils ne sont pas utilisés pour le transfert FTP.

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
