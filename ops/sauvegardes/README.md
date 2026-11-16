# Sauvegardes du garage

Ce dossier est copié dans un dépôt GitHub **privé** à part (`hostnextline/garage2.0-sauvegardes`).
Chaque nuit, vers 3 h 23 (4 h 23 l'été : GitHub compte en heure UTC), GitHub télécharge toutes les données du garage
et les range dans `donnees/` (un fichier par table). L'historique du dépôt garde chaque nuit : on peut revenir au jour
qu'on veut.

- **Aucun mot de passe n'est gardé** : GitHub donne à la sauvegarde un ticket signé, valable quelques minutes,
  et le serveur du garage vérifie que le ticket vient bien de ce dépôt-là.
- **Les clés des services** (textos, paiements par carte, notifications, Hermes) ne sont jamais dans les sauvegardes.
  Les comptes de connexion (courriels, mots de passe) non plus : voir « Ce que la sauvegarde ne garde pas ».
- Pas de limite de 1000 lignes : tout est pris, page par page, et compté. Une table qui change pendant qu'on la lit
  est relue (jusqu'à 3 fois) : aucune ligne en double, aucune oubliée.
- **Les photos** (reçus, signatures) : une photo = un fichier, `donnees/photos/<id>.jpg` (ou `.png`, `.webp`, `.svg`,
  `.pdf`) ; `donnees/attachments.json` garde leurs lignes sans l'image. Une photo déjà gardée n'est pas retéléchargée.
  (GitHub refuse un fichier de plus de 100 Mo : un seul fichier avec toutes les photos aurait un jour arrêté toutes
  les sauvegardes. Le script avertit dès 50 Mo et refuse avant d'envoyer un fichier trop gros.)
- `donnees/_resume.json` : l'heure, le nombre de lignes de chaque table, le nombre de photos, et l'empreinte (sha256)
  des deux scripts qui ont fait la copie.
- Lancer une sauvegarde tout de suite : onglet **Actions**, « Sauvegarde du garage », **Run workflow**.

## La fin de chaque nuit : le garage est prévenu, puis le rapprochement

Après avoir gardé la copie (commit + push), le travail fait une dernière étape, `node sauvegarde.mjs --fin donnees` :

1. il dit au garage que la nuit est gardée (`backup { action: 'done', tables, rows, commit }`) : l'app connaît
   l'heure de la dernière bonne sauvegarde ;
2. il demande le rapprochement de la journée (`recon { action: 'run' }`) : l'argent, les factures, les paiements
   qui ne balancent pas ;
3. il finit **en rouge** quand le rapprochement dit « bad » (GitHub envoie alors un courriel au propriétaire) ; la
   copie de la nuit est gardée quoi qu'il arrive (cette étape vient après le push, exprès).

Un serveur qui ne connaît pas encore ces deux appels (avant la mise à jour du serveur) : un avertissement jaune,
jamais un échec. Un appel refusé ou en panne : rouge, avec la raison en clair.

## Remettre des données (après une erreur)

1. Choisir la sauvegarde : dans l'historique du dépôt (« History »), télécharger **tout** le dossier `donnees` du bon
   jour (avec `photos/` : sans lui, les photos ne peuvent pas revenir et le script s'arrête).
2. Écrire le fichier de restauration (une des quatre façons ci-dessous ; `--tables` et `--ids` se combinent avec
   chacune).
3. Faire tourner `restauration.sql` sur la base du garage (`psql`, ou l'éditeur SQL de Supabase pour un petit
   fichier). Tout se fait d'un bloc : si une étape échoue, **rien n'est changé**.

### Les quatre façons, exactement

| Commande | Ce qu'elle fait | Ce qu'elle ne fait PAS |
|---|---|---|
| `node restaurer.mjs donnees > restauration.sql` | Remet les lignes **qui n'existent plus du tout** dans la base (effacées pour de bon, par SQL), telles qu'elles étaient cette nuit-là. | N'écrase rien : une ligne qui existe encore garde ses valeurs d'aujourd'hui. **Ne ramène pas** ce qui a été « Effacé » dans l'app (l'app ne fait que cacher la ligne : elle existe encore) → `--retablir`. |
| `… --remplacer` | En plus, les lignes qui existent encore **reprennent les valeurs de cette nuit-là** (même clé). | **N'efface rien** : ce qui a été créé après la sauvegarde (rendez-vous, paiements, factures, numéros) reste. Ce n'est donc **pas** un retour complet à cette nuit-là. Ne recalcule rien : une facture payée après la sauvegarde redevient « non payée » alors que son paiement reste — les totaux ne balancent plus (le rapprochement le dira). À utiliser sur une table ou quelques lignes (`--tables`, `--ids`), pas sur toute la base. |
| `… --tables customers --retablir` (`--ids <id>` pour une seule fiche) | Défait l'« Effacer » de l'app : `deleted_at` redevient vide, **automatismes allumés** (l'heure de modification est neuve : les téléphones la revoient ; l'historique le note). Seulement pour des lignes vivantes cette nuit-là. | N'écrit **aucune autre valeur** de la sauvegarde ; ne touche ni les lignes non nommées ni les autres tables (les voitures, rendez-vous et factures d'un client effacé sont restés intacts : il n'y a rien à leur faire). |
| `… --tables customers --ids <id>,<id>` | Seulement ces lignes-là (avec le mode choisi). Leur heure de modification est faite neuve : chaque téléphone reprend leurs valeurs. | Un id qui n'est dans aucun des fichiers nommés est une **erreur** (rien n'est écrit). |

Toujours vrai, quelle que soit la façon :

- **Rien n'est jamais effacé** par une restauration.
- Une sauvegarde faite **avant** qu'une colonne soit ajoutée au serveur se restaure : seules les colonnes de la
  sauvegarde sont écrites. Une ligne remise prend la valeur par défaut des nouvelles colonnes ; une ligne remplacée
  garde la sienne. Si une colonne ajoutée depuis est obligatoire et n'a pas de valeur par défaut, le script s'arrête
  en la nommant (`la colonne <table>.<colonne> est obligatoire…`) : il faut choisir sa valeur à la main.
- Les numéros (factures, rendez-vous, soumissions, journaux) **ne reculent jamais** : chaque compteur est monté au plus
  haut numéro remis, jamais descendu. Une base neuve repart donc après le dernier numéro de la sauvegarde.
- Un fichier de la sauvegarde que le script ne connaît pas est une **erreur** (ses données ne reviendraient pas) :
  ajouter la table à `ORDRE` dans `restaurer.mjs`, ou restaurer seulement ce qu'on veut avec `--tables`. Une table
  annoncée par `_resume.json` mais absente, ou plus courte qu'annoncé : erreur aussi (la copie n'est pas entière).
- Sans `--retablir`, la restauration se fait sans les automatismes (pas de réorganisation des routes, pas de
  mouvements d'inventaire, pas d'heure de modification) : les données reviennent telles quelles.
- **Les téléphones** : une ligne remise par une restauration de **toute une table** garde son heure de modification de
  cette nuit-là ; un téléphone qui a déjà une copie plus récente garde la sienne. Pour une fiche ou quelques lignes,
  utiliser `--ids` (ou `--retablir`) : les téléphones les revoient tout de suite. Après une restauration de toute une
  table, chaque téléphone doit recharger ses données (à prévoir dans l'app : c'est demandé).

## Ce que la sauvegarde ne garde pas

- Les **comptes de connexion** (Supabase Auth : courriels, mots de passe). Après la perte du projet, les fiches de
  l'équipe reviennent mais personne ne peut se connecter tant que les comptes ne sont pas recréés. `restaurer-comptes.mjs`
  les recrée **avec les mêmes identifiants** que les fiches (tout ce qui pointe vers une personne reste juste), bloqués
  pour les personnes désactivées, sans mot de passe et sans courriel envoyé ; puis chacun fait « Mot de passe oublié » :
  `SUPABASE_URL=https://<projet>.supabase.co SERVICE_ROLE_KEY=<clé> node restaurer-comptes.mjs donnees --essai`, puis sans
  `--essai`. À faire AVANT de restaurer les données. Une personne sans courriel ne peut pas être recréée : la sauvegarde
  le dit chaque nuit (avertissement).
- Les **clés des services** (table `secrets`) : GoHighLevel, Stripe (clé, webhook), notifications (VAPID : chaque
  téléphone devra réaccepter les notifications), Hermes, la clé des appels entrants. À retaper dans Réglages.
- `rate_limits`, `incoming_calls`, `incoming_texts`, `push_subs` : des données de passage, exprès.

## Combien de temps c'est gardé, et qui peut le lire

- **Pour toujours** : l'historique du dépôt n'est jamais élagué. Cela vaut aussi pour les positions GPS (`position_log`),
  que la base efface d'elle-même après 30 jours, et pour un client effacé à sa demande. Une règle de durée (et le
  chiffrement des copies) est une décision du propriétaire : rien n'est changé tant qu'elle n'est pas prise.
- Les fichiers sont lisibles en clair par toute personne ou tout jeton qui a accès au dépôt : le garder **privé**, avec
  le propriétaire seul comme lecteur.
