# Nyranthia — Atelier du livre

Un livre virtuel à compléter : chapitres et sections modifiables, texte enrichi, annotations dans la marge, images et sauvegarde automatique. Le modèle de départ contient le sommaire et les éléments d’univers déjà rédigés. Les règles à concevoir restent à compléter.

## Déployer avec Coolify

Créer une **Application depuis un dépôt Git** dans le projet Coolify, avec le dépôt `https://github.com/HalTorns/Nyranthia`. Sélectionner ces valeurs :

| Réglage | Valeur |
| --- | --- |
| Branche | `main` |
| Build Pack | `Docker Compose` |
| Base Directory | `/` |
| Docker Compose Location | `/JDR/docker-compose.yaml` |
| Service à exposer | `jdr` |
| Port interne | `4317` |
| Domains du service | `https://jdr.votre-domaine.fr:4317` |

Dans **Environment Variables**, renseigner les trois variables d’exécution :

```dotenv
NYRANTHIA_PUBLIC_URL=https://jdr.votre-domaine.fr
NYRANTHIA_AUTH_USER=auteur
NYRANTHIA_AUTH_PASSWORD=un-mot-de-passe-long-et-unique
```

Choisir son propre mot de passe d’au moins 16 caractères. Les valeurs réelles restent dans Coolify ; `.env.example` sert uniquement de modèle. L’adresse de `NYRANTHIA_PUBLIC_URL` est celle utilisée dans le navigateur : elle **ne porte pas le suffixe interne `:4317`** du champ Domains.

Faire pointer le DNS du domaine vers le serveur Coolify, enregistrer les réglages puis cliquer sur **Deploy**. Coolify configure le proxy HTTPS et le certificat. Le navigateur demande l’identifiant et le mot de passe à l’ouverture. Tous les accès au manuscrit, aux images et à l’éditeur sont protégés ; seul `/api/health` expose l’état minimal du service.

Utiliser un domaine ou sous-domaine dédié. `JDR` est le dossier du dépôt, pas un préfixe d’URL : l’application s’ouvre à `https://jdr.votre-domaine.fr/`, pas sous `/JDR/`.

Le fichier Compose définit le volume `livre`, monté sur `/app/data`, et le contrôle de santé. Il ne publie aucun port directement sur le serveur : Coolify assure le routage. La construction installe les dépendances et compile l’éditeur ; aucune commande de build supplémentaire n’est nécessaire dans Coolify.

Le contexte de construction `./JDR` est relatif à la racine du dépôt. Le réglage **Base Directory `/`** fait lancer Compose avec `--project-directory` sur cette racine ; le fichier Compose reste bien dans `JDR`. Les commandes locales et les tests reprennent ce réglage. En cas d’ancienne erreur « Dockerfile not found », appliquer les deux chemins du tableau, charger la dernière version de `main` et recharger la définition Compose avant de redéployer.

Référence des champs et du suffixe de port : [documentation officielle Coolify](https://coolify.io/docs/applications/builds/docker-compose).

## Persistance et mises à jour

Le volume contient :

```text
/app/data/
  livre.json       # Texte, structure, mise en forme et annotations
  media/           # Images importées
  sauvegardes/     # Versions précédentes du livre, au plus une par minute d’écriture
```

`seed.json` initialise un volume vide une seule fois. Un redéploiement du code conserve le livre déjà présent. Les versions précédentes et les images retirées du texte sont conservées, pour permettre de retrouver les illustrations des anciens manuscrits. Prévoir de la place disque et une sauvegarde externe du volume entier.

Garder **une seule instance du service par volume**, sans réplication ni déploiement simultané de deux conteneurs sur le même stockage. Les conflits entre onglets sont détectés, mais l’application n’est pas un éditeur collaboratif en temps réel. Dans Coolify, réutiliser la même application et son volume à chaque redéploiement.

Le manuscrit de travail local et ses annotations ne sont pas publiés dans ce dépôt. Sans import, la première ouverture utilise le modèle initial. Pour reprendre une installation existante, transférer son dossier `data` complet, comme décrit ci-dessous. Les éditions locale et hébergée ne se synchronisent pas automatiquement.

## Transférer ou sauvegarder son livre

Une archive doit contenir `livre.json`, `media/` s’il existe, et `sauvegardes/`, directement à sa racine. Sur le PC, depuis le dossier du projet d’origine :

```powershell
tar -czf Nyranthia-manuscrit.tar.gz -C atelier/data .
```

Attendre que l’atelier indique **Enregistré**, puis fermer les onglets d’écriture avant de créer l’archive. Transférer cette archive sur le serveur Coolify, par exemple avec SFTP. Ne pas l’ajouter à Git.

Les commandes suivantes s’exécutent dans un terminal **Bash du serveur Docker**, depuis le dossier contenant l’archive. Copier le nom exact du conteneur `jdr` affiché dans Coolify à la place de `nom-du-conteneur-jdr` :

```bash
CONTAINER='nom-du-conteneur-jdr'
VOLUME=$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}')
test -n "$VOLUME" || { echo 'Volume du livre introuvable'; exit 1; }
docker stop "$CONTAINER"
```

Créer une copie du stockage actuel avant toute restauration :

```bash
docker run --rm -v "$VOLUME:/data:ro" -v "$PWD:/backup" alpine:3 \
  sh -c 'tar -czf /backup/avant-import-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .'
```

Puis importer l’archive et redémarrer :

```bash
docker run --rm -v "$VOLUME:/data" -v "$PWD:/backup:ro" alpine:3 \
  sh -c 'tar -xzf /backup/Nyranthia-manuscrit.tar.gz -C /data && chown -R 1000:1000 /data'
docker start "$CONTAINER"
```

L’import remplace le manuscrit par celui de l’archive. Le processus de l’application utilise l’UID/GID `1000:1000`, d’où le rétablissement des droits après copie. Adapter le nom de l’archive dans la commande si nécessaire. Conserver l’archive `avant-import` jusqu’à vérification du livre et des images.

Pour une sauvegarde ordinaire, exécuter seulement l’arrêt, la commande de création d’archive et le redémarrage. Télécharger ensuite l’archive sur un autre support. Conserver le volume lors des mises à jour ; ne pas utiliser `docker compose down -v` sur cette installation.

## Utilisation

- Cliquer dans un titre ou un texte pour le modifier. **Ajouter un chapitre** crée une page ; **Ajouter une section** se trouve en bas du chapitre.
- Sélectionner du texte puis utiliser la barre pour le gras, l’italique, les listes, les citations et le surlignage. Ctrl+Z annule dans la section ouverte.
- **Annoter** associe une note à la sélection. Cliquer sur l’extrait d’une note ramène au passage. Une note peut être traitée puis rouverte ; supprimer le passage conserve sa note. Couper-coller le texte ne déplace pas son ancrage.
- **Image** accepte PNG, JPEG et WebP jusqu’à 10 Mo, avec légende et largeur réglable. Sélectionner une image puis cliquer à nouveau sur **Image** pour la modifier.
- Attendre **Enregistré** avant de fermer. En cas de coupure, le navigateur conserve un brouillon si son stockage est disponible. Rouvrir le même navigateur pour le retrouver. Un brouillon JSON seul ne contient pas les fichiers images.

## Tester avec Docker sur son PC

Depuis `JDR`, copier `.env.example` vers `.env`, puis définir une adresse locale et son mot de passe :

```dotenv
NYRANTHIA_PUBLIC_URL=http://127.0.0.1:4319
NYRANTHIA_AUTH_USER=auteur
NYRANTHIA_AUTH_PASSWORD=un-mot-de-passe-de-test-personnel
```

```bash
docker compose --env-file .env --project-directory .. -p jdr -f docker-compose.yaml -f compose.local.yaml up --build -d --wait
```

Ouvrir `http://127.0.0.1:4319`. L’exception HTTP est réservée à localhost ; un domaine public doit utiliser HTTPS. `compose.local.yaml` ouvre uniquement un port de boucle locale pour cet essai ; **ne pas l’ajouter au déploiement Coolify**.

Le nom de projet local `jdr` conserve le volume des essais réalisés avant cette correction de chemin. Utiliser les mêmes options (`--env-file .env --project-directory .. -p jdr -f docker-compose.yaml -f compose.local.yaml`) pour les commandes locales suivantes, par exemple `logs` ou `stop`.

## Développement et vérifications

Node.js 24 :

```bash
npm ci
npm run build
npm test
npm start
```

Sans configuration d’hébergement, le serveur de développement écoute uniquement `127.0.0.1:4317`. Le lancement Node direct ne charge pas `.env` automatiquement. Pour une configuration hébergée, renseigner les variables d’environnement ou utiliser Compose.

Les tests utilisent des fichiers séparés dans `JDR/tmp/tests`. Le workflow GitHub `JDR - Tests et Docker` vérifie les tests Node et les chemins Compose (`npm run test:compose`, Docker CLI nécessaire), construit le conteneur Linux avec le répertoire de projet à la racine comme Coolify, puis teste l’authentification, l’écriture du livre enrichi et la conservation des notes/images après recréation du conteneur. Il ne publie pas d’image et ne déclenche pas lui-même Coolify.

Toute l’application est dans `JDR`. Le seul fichier d’automatisation se trouve dans `.github/workflows/jdr.yml`, emplacement imposé par GitHub Actions ; il est filtré sur les changements du projet JDR.
