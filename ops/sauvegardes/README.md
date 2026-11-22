# Sauvegardes du garage

Ce dossier est copié dans un dépôt GitHub **privé** à part (`hostnextline/garage2.0-sauvegardes`).
Chaque nuit, vers 3 h 23 (4 h 23 l'été : GitHub compte en heure UTC), GitHub télécharge toutes les données du garage
et les range dans `donnees/` (un fichier par table). L'historique du dépôt garde chaque nuit : on peut revenir au jour
qu'on veut.

- **Aucun mot de passe n'est gardé** : GitHub donne à la sauvegarde un ticket signé, valable quelques minutes,
  et le serveur du garage vérifie que le ticket vient bien de ce dépôt-là : par son nom, et par ses numéros.
  Au premier bon ticket, le serveur note les numéros du dépôt et de son propriétaire dans la table `secrets`, ligne
  `backup_repo:hostnextline/garage2.0-sauvegardes` (valeur `<numéro du dépôt>:<numéro du propriétaire>`). Ensuite, un
  dépôt qui porte le même nom mais d'autres numéros (le dépôt effacé puis refait, renommé, ou repris par quelqu'un
  d'autre) est refusé : la nuit finit en rouge, « ce n'est plus le même dépôt ». **Pour déplacer les sauvegardes**
  dans un nouveau dépôt fait exprès : effacer cette ligne-là (SQL de Supabase :
  `delete from public.secrets where key = 'backup_repo:hostnextline/garage2.0-sauvegardes';`) ; le prochain bon ticket
  est noté à sa place. Un autre NOM de dépôt demande aussi la variable `BACKUP_REPOS` des fonctions.
- **Les clés des services** (textos, paiements par carte, notifications, Hermes) ne sont jamais dans les sauvegardes.
  Les comptes de connexion (courriels, mots de passe) non plus : voir « Ce que la sauvegarde ne garde pas ».
- Pas de limite de 1000 lignes : tout est pris, page par page, et compté. Une table qui change pendant qu'on la lit
  est relue (jusqu'à 3 fois) : aucune ligne en double, aucune oubliée.
- **Les photos** (reçus, signatures) : une photo = un fichier, `donnees/photos/<id>.jpg` (ou `.png`, `.webp`,
  `.pdf` ; `.svg` dans les vieilles sauvegardes : le serveur refuse ce format maintenant, une restauration le laisse dans
  la sauvegarde et le dit) ; `donnees/attachments.json` garde leurs lignes sans l'image. Une photo déjà gardée n'est pas retéléchargée.
  (GitHub refuse un fichier de plus de 100 Mo : un seul fichier avec toutes les photos aurait un jour arrêté toutes
  les sauvegardes. Le script avertit dès 50 Mo et refuse avant d'envoyer un fichier trop gros.)
- `donnees/_resume.json` : l'heure, le nombre de lignes de chaque table, le nombre de photos, et l'empreinte (sha256)
  des deux scripts qui ont fait la copie.
- Lancer une sauvegarde tout de suite : onglet **Actions**, « Sauvegarde du garage », **Run workflow**.

## La fin de chaque nuit : le garage est prévenu, le rapprochement, puis les routes

Après avoir gardé la copie (commit + push), le travail fait une dernière étape, `node sauvegarde.mjs --fin donnees` :

1. il dit au garage que la nuit est gardée (`backup { action: 'done', tables, rows, commit }`) : l'app connaît
   l'heure de la dernière bonne sauvegarde ;
2. il demande le rapprochement de la journée (`recon { action: 'run' }`) : l'argent, les factures, les paiements
   qui ne balancent pas ;
3. il fait mesurer les trajets des jours qui viennent (« Vraies routes » : `drive { action: 'sweep' }`, avec le même
   billet GitHub que le rapprochement). Le serveur mesure lui-même ce qui manque (TomTom, sinon OSRM ; jamais la
   ligne droite), s'arrête de lui-même après ~40 secondes et répond `more: true` s'il en reste : le travail le
   redemande tant que `more` est vrai, **10 appels au plus** (le reste la nuit suivante ; l'app du propriétaire et du
   bureau mesure aussi). Le résumé dit « Routes : N trajets mesurés en M appels » et ce qui reste. Cette mesure se
   fait même quand les vraies routes sont éteintes (c'est elle qui permet de les allumer) et compte dans le plafond
   TomTom du mois (`booking.roads_month_tx`) ;
4. il finit **en rouge** quand le rapprochement dit « bad » (GitHub envoie alors un courriel au propriétaire) ; la
   copie de la nuit est gardée quoi qu'il arrive (cette étape vient après le push, exprès).

Un serveur qui ne connaît pas encore ces appels (avant la mise à jour du serveur : pas de fonction `drive`, 404, ou
une fonction d'avant : « action » ; ou une fonction déjà publiée dont la migration n'est pas encore appliquée :
réponse `not_ready`) : un avertissement jaune, jamais un échec. TomTom qui refuse la clé du serveur : un
avertissement (OSRM a mesuré les heures habituelles). Un appel refusé ou en panne : rouge, avec la raison en clair.

Une nuit **ratée** (la copie n'est pas entière, ou le push est refusé) finit en rouge, et le garage le note aussi
(`backup { action: 'done', ok: false }`, avec les tables déjà lues) : l'historique des sauvegardes montre la nuit
ratée, pas seulement l'absence d'une bonne. Le rapprochement, lui, dit « bad » quand la dernière BONNE sauvegarde a
plus de 26 heures.

## Remettre des données (après une erreur)

1. Choisir la sauvegarde : dans l'historique du dépôt (« History »), télécharger **tout** le dossier `donnees` du bon
   jour (avec `photos/` : sans lui, les photos ne peuvent pas revenir et le script s'arrête).
2. Écrire le fichier de restauration (une des façons ci-dessous ; `--tables` et `--ids` se combinent avec
   chacune, sauf `--neuve`).
3. Faire tourner `restauration.sql` sur la base du garage (`psql`, ou l'éditeur SQL de Supabase pour un petit
   fichier). Tout se fait d'un bloc : si une étape échoue, **rien n'est changé**.

### Les façons, exactement

| Commande | Ce qu'elle fait | Ce qu'elle ne fait PAS |
|---|---|---|
| `node restaurer.mjs donnees > restauration.sql` | Remet les lignes **qui n'existent plus du tout** dans la base (effacées pour de bon, par SQL), telles qu'elles étaient cette nuit-là. | N'écrase rien : une ligne qui existe encore garde ses valeurs d'aujourd'hui. **Ne ramène pas** ce qui a été « Effacé » dans l'app (l'app ne fait que cacher la ligne : elle existe encore) → `--retablir`. |
| `… --remplacer` | En plus, les lignes qui existent encore **reprennent les valeurs de cette nuit-là** (même clé). | Ne change pas la **réservation en ligne** : ouverte ou fermée, elle reste comme elle est dans la base (seul le propriétaire l'ouvre ou la ferme, dans l'app). Les **vraies routes** non plus : allumées ou éteintes, elles restent comme dans la base (seul `roads_switch`, dans l'app, les change). **N'efface rien** : ce qui a été créé après la sauvegarde (rendez-vous, paiements, factures, numéros) reste. Ce n'est donc **pas** un retour complet à cette nuit-là. Ne recalcule rien : une facture payée après la sauvegarde redevient « non payée » alors que son paiement reste — les totaux ne balancent plus (le rapprochement le dira). À utiliser sur une table ou quelques lignes (`--tables`, `--ids`), pas sur toute la base. |
| `… --tables customers --retablir` (`--ids <id>` pour une seule fiche) | Défait l'« Effacer » de l'app : `deleted_at` redevient vide, **automatismes allumés** (l'heure de modification est neuve : les téléphones la revoient ; l'historique le note). Seulement pour des lignes vivantes cette nuit-là. | N'écrit **aucune autre valeur** de la sauvegarde ; ne touche ni les lignes non nommées ni les autres tables (les voitures, rendez-vous et factures d'un client effacé sont restés intacts : il n'y a rien à leur faire). |
| `node restaurer.mjs donnees --neuve > restauration.sql` | **Toute** la sauvegarde dans un **projet neuf** (après la perte du projet : voir « Après la perte du projet »). Comme `--remplacer`, et les réglages faits par les migrations (l'entreprise, les numéros de TPS/TVQ, le préfixe des factures, les droits, les réservations, la réservation en ligne ouverte ou fermée) prennent **ceux de la sauvegarde**, sauf les **vraies routes**, remises **éteintes** : les temps de route (`drive_times`) ne sont jamais dans une sauvegarde ; on les mesure (« Mesurer maintenant »), puis on rallume dans l'app. Le compteur du mois chez TomTom (`drive_spend`) repart aussi de 0 dans un projet neuf : le plafond du mois peut alors être dépensé une deuxième fois ce mois-là (la facture de TomTom, elle, continue). | Refusé, rien n'est changé, quand la base a déjà des personnes, des clients, des rendez-vous, des factures ou des paiements : jamais sur la base du garage. Ne va ni avec `--tables`, ni avec `--ids`, ni avec un autre mode. |
| `… --tables customers --ids <id>,<id>` | Seulement ces lignes-là (avec le mode choisi). Leur heure de modification est faite neuve : chaque téléphone reprend leurs valeurs. | Un id qui n'est dans aucun des fichiers nommés est une **erreur** (rien n'est écrit). |

Toujours vrai, quelle que soit la façon :

- **Rien n'est jamais effacé** par une restauration.
- Les réglages (`settings`) restaurés **sans** `--neuve` dans une base **vide** (aucune personne, aucun client, aucun
  rendez-vous) : le script s'arrête et dit de prendre `--neuve` (sinon les réglages neufs des migrations resteraient,
  pas ceux du garage).
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

## Après la perte du projet (tout refaire)

1. Un nouveau projet Supabase ; y appliquer **toutes** les migrations de `supabase/migrations`, dans l'ordre des noms
   (procédure du projet : CLAUDE.md, empreinte sha256 de chaque fichier).
2. Télécharger tout le dossier `donnees` de la dernière bonne nuit (avec `photos/`).
3. Les comptes de l'équipe : `restaurer-comptes.mjs` (ci-dessous), `--essai` d'abord.
4. Les données : `node restaurer.mjs donnees --neuve > restauration.sql`, puis
   `psql "<adresse de la base du nouveau projet>" -v ON_ERROR_STOP=1 -f restauration.sql`. Un avertissement dit
   combien de personnes n'ont pas encore de compte (étape 3 à refaire).
5. Vérifier : le nombre de lignes de chaque table est celui de `_resume.json` (`activity` : quelques lignes de plus,
   écrites par les migrations du nouveau projet) ; Réglages montre l'entreprise, les
   numéros de taxes et le préfixe des factures du garage ; « Rapprochement » (Trésorerie → Vérifier maintenant).
6. Les clés des services (ci-dessous) à retaper dans Réglages ; les fonctions publiées sur le nouveau projet ; l'adresse
   du nouveau projet dans l'app et dans `sauvegarde.mjs` (FONCTION, CLE) ; dans ce dépôt, la ligne
   `backup_repo:…` se refait d'elle-même au premier ticket (nouvelle base).

Ce chemin est répété par un test (`ops/tests/sauvegardes.test.mjs`, « a lost project ») : une base neuve faite des
migrations, une nuit entière restaurée avec `--neuve`, chaque table, les réglages et les compteurs comparés, et le
rapprochement lit les mêmes comptes.

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
