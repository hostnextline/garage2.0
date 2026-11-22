# La Partie 27 seule (« Vraies routes », « Déplacer » depuis les arrêts, le déplacement à l'heure choisie), sur la version en ligne d'aujourd'hui

> **FAIT le 2026-11-22** (le go de Hassan, « go live », 01:27), C = `5e23639e` : 0.2 sauvegarde à la main verte à 01:44
> (37 tables, 3191 lignes) ; 0.3 / 0.4 lecture seule (les 22 lignes de l'empreinte égales ; `windows_on()` vrai) ; 0.5 le
> texte d'avant gardé hors du dépôt ; 1a l'essai : « ESSAI OK … 87 réponses du planificateur comparées, toutes les mêmes » ;
> 1b la migration à 01:46 ; 1c les contrôles (roads_on faux, 0 ligne de arrive_at / eta_measured / drive_times, 60 clients,
> 72 rendez-vous, 39 factures, 9 paiements) ; 2 drive, book, enroute, backup à C (01:47, `?version` et les réponses
> attendues) ; 4 l'app : `main` = `9eb996e9` (01:53), puis `55b15877` (03:13, « Texter … ? »). PAS fait : le script de nuit
> (section 4, son second point : le choix de Hassan) ni les clés TomTom. Le retour pour l'app : la branche `vercel` d'avant
> était `685f2a24` (l'app `d7b6c0d2`).

La refonte est **en ligne depuis le 2026-11-21** : ses six migrations et les douze fonctions à `837c89d8` depuis 20 h 06,
l'app `d7b6c0d2` publiée vers 23 h 10. `CUTOVER.md` (sections 1 à 5) raconte cette nuit-là : elle est faite, ne pas la
refaire (sa question Q1 s'arrêterait tout de suite). Ce cahier-ci est celui de la **Partie 27 seule**, en partant de ce
qui tourne aujourd'hui ; `CUTOVER.md` reste la référence pour les clés de TomTom, la mesure et l'interrupteur (section
5 bis) et pour le retour en arrière pièce par pièce (section 7).

Rien sans le **go de Hassan**, donné au moment où c'est prêt, avec une sauvegarde d'abord ; jamais entre 07:30 et 09:00
UTC ; pas quand personne ne regarde. Les règles de toujours (CLAUDE.md, « The live database ») : jamais `DELETE`, `DROP`
ou `TRUNCATE` ; chaque changement d'abord essayé dans un bloc qui finit par `raise exception` ; on s'arrête au premier écart.

Dans ce fichier : **C** = le commit de la branche `tomtom` poussé sur GitHub (jamais `main` avant l'étape 4) ;
**EN LIGNE** = `d7b6c0d2` (l'app) et `837c89d8` (les fonctions et les migrations : les migrations de `d7b6c0d2` sont celles
de `837c89d8`, octet pour octet).

## 0. Avant (rien ne change)

1. Toute la suite au commit C sur le Mac (la base FRESH, l'API, `tests/stack/mac/all.sh`, les fichiers du navigateur
   `routes`, `deplacer`, `plages`, `argent`, `mise-a-jour` — celui-ci part maintenant de `d7b6c0d2`, l'app des téléphones —,
   les tests de `ops/tests`). C poussé (branche `tomtom`), pour que GitHub serve le fichier.
2. « Sauvegarde du garage » à la main (CUTOVER 1.1.3) : verte ; noter son commit ; télécharger `donnees`.
3. Lecture seule sur la base en ligne : `select version, name from supabase_migrations.schema_migrations order by version desc limit 8`
   → `20261119000100` (heures) et les six `20261116…` sont là ; `20261119000200` n'y est **pas**. Et `select public.windows_on()` :
   il dit si le déplacement à l'heure choisie sert à l'équipe dès que l'app est publiée (étape 4).
4. Lecture seule : `ops/live/partie27/empreinte-21.sql` (l'empreinte des 21 fonctions du planificateur que la Partie 27
   refait). Comparer avec `ops/live/partie27/empreinte-21.local-main.txt` (faite sur une base locale construite avec les
   migrations de `main`) : 22 lignes, toutes égales → la base en ligne tourne le texte d'où la migration a été générée.
   Une seule différente → ARRÊT (une fonction a été changée en ligne hors des fichiers : régénérer depuis ce texte d'abord).
5. Lecture seule, gardé pour le retour : le texte de ces fonctions avant la Partie 27 → `ops/live/rollback/fonctions_avant_27.sql` :
   ```sql
   select string_agg(pg_get_functiondef(p.oid) || ';', E'\n\n' order by p.proname, pg_get_function_identity_arguments(p.oid))
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname = any (array['drive_min','route_walk_in','route_cost','route_retime','plan_route','day_drive','suggest_core',
        'suggest_windows_core','web_suggest','web_windows','plan_inputs','apply_plan','replan_block_safe','customers_replan_on_position',
        'book_job','move_job','lock_windows_core','log_activity','stop_order_one','windows_switch','plan_late_new']);
   ```
   (Il remplace, pour ce soir, le « fonctions_avant_7.sql » de CUTOVER : les six autres sont déjà en ligne.)

## 1. La migration (hors des heures de l'équipe)

a. **L'ESSAI** : `ops/live/partie27/essai-partie27.sql` (remplacer `<C>` et `<SHA256>`). Il télécharge le fichier au
   commit C, vérifie son empreinte, met `lock_timeout` à 5 s, calcule les réponses du planificateur sur les données de la
   base en ligne (le plan de chaque bloc des 14 prochains jours, la route de chaque camion, les moments offerts aux adresses
   des 3 clients les plus récents, et avec les plages leurs plages pour tout véhicule et pour les pneus, 7 jours), applique
   la migration, les recalcule et compare, dans UNE transaction toujours défaite. Attendu : l'erreur
   « ESSAI OK : vraies_routes (rien n'est gardé) ; N réponses du planificateur comparées, toutes les mêmes ».
   « ARRÊT : … » ou toute autre erreur : on s'arrête, rien n'a changé. Essayé sur le Mac (`ops/live/partie27/essai-local.mjs` :
   le même bloc, le téléchargement remplacé par le fichier) : mode blocs 73 réponses égales, mode plages 87 ; avec
   l'ANCIENNE Partie 27 (texte de rc1) il s'arrête : « change 3 réponses du planificateur sur 87 ». Pas mesuré : sa durée
   sur les vraies données.
b. **POUR VRAI** : le bloc de CLAUDE.md (téléchargement au commit C, empreinte vérifiée) avec
   `perform set_config('lock_timeout', '5s', true);` avant `execute body`, puis
   `insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261119000200', 'vraies_routes', array[body])`.
c. **CONTRÔLE** (lecture seule) : `schema_migrations` montre `20261119000200` ; les nombres de CUTOVER 2c inchangés (clients,
   rendez-vous, factures, paiements ; la migration n'écrit aucune ligne de données) ; `select public.roads_on()` → faux ;
   `select count(*) from public.jobs where arrive_at is not null or eta_measured is not null` → 0 ;
   `select count(*) from public.drive_times` → 0. La migration n'envoie aucun `DROP`, `DELETE` ni `TRUNCATE` (test « S120 »
   de `tests/db/vraies-routes.test.mjs`) et peut être appliquée deux fois.

## 2. Les fonctions du serveur (après la migration, avant l'app), depuis les fichiers bruts au commit C, `verify_jwt` éteint

Seules quatre changent par rapport à `837c89d8` : `drive` (nouvelle), `book`, `enroute`, `backup` (avec les fichiers
partagés `_shared/roads.ts` et `_shared/tomtom.ts`, nouveaux). Les neuf autres (`client`, `conversation`, `hermes`,
`notify`, `recon`, `ring`, `stripe`, `team`, `vin`) ne bougent pas. Dans cet ordre : `drive` (elle a besoin des tables et
des fonctions de la migration), `book`, `enroute`, `backup`. Chacune : `?version` → C ; `POST {}` → 401 (drive, enroute,
backup), 200 `{ ok, garage, on: false }` (book).

À savoir, interrupteur éteint aussi :
- `enroute` : TomTom d'abord seulement avec la clé du serveur (aucune ce soir → OSRM, puis sa copie FOSSGIS, comme
  aujourd'hui), puis **AUCUNE heure** au lieu de l'heure en ligne droite d'aujourd'hui : quand aucun planificateur ne
  répond, le texto « en route » part sans heure et la carte du client n'a pas de ligne (aujourd'hui : une heure estimée et
  une ligne pointillée). C'est la règle de Hassan du 2026-11-19 (« une vraie heure de route, ou aucune ») ; il n'a pas été
  redemandé depuis que la version en ligne a gardé la ligne droite : **le lui dire avant** (voir la note de version).
  Au plus 30 routes à l'heure par personne ; `refresh` freiné (l'app `d7b6c0d2` ne l'appelle jamais).
- `backup` : sa liste « pas sauvegardé » nomme `drive_times` et `drive_spend` (les mêmes tables qu'avant).

## 3. Les réglages
Rien n'est nécessaire. `settings.booking.roads_on` reste faux jusqu'à ce que le propriétaire l'allume dans l'app (CUTOVER
5 bis.4, une fois tous les téléphones sur la nouvelle app et tout mesuré). Les clés et le plafond : CUTOVER 5 bis. Jamais
en ligne : `OSRM_BASE`, `OSRM_BACKUP_BASE`, `TOMTOM_BASE`, les lignes `drive_limits` et `stripe_test_ok` de `secrets`.

## 4. L'app (main), puis le script de nuit
- L'app : fusionner C dans `main` (avec `[important]` dans la première ligne), pousser `main` puis `main:construction-v2`.
  Noter avant l'id du déploiement Vercel de `d7b6c0d2` (le retour).
- **Pas inerte dès que l'app est publiée**, en mode plages (`windows_on()` vrai) : le déplacement à l'heure choisie. Chaque
  déplacement à une heure montrée (les grilles de l'agenda, le calendrier et la liste de « Déplacer », la liste des plages
  de l'agenda, « Changer de camion » sauf un rendez-vous encore « flexible ») demande `move_preview(p_job, p_day, p_truck, p_at)`
  et envoie `move_job` à 8 arguments ; le serveur écrit `jobs.arrive_at` et tout plan suivant (interrupteur éteint aussi)
  garde cet arrêt à cette minute. Sans la migration, un tel déplacement est refusé (rien gardé sur le téléphone) : la
  migration AVANT l'app, toujours. Les téléphones encore sur `d7b6c0d2` continuent de marcher (les formes à 5 et 7 arguments
  de `move_job` ne changent pas) ; leur mise à jour vers C est prouvée par `tests/e2e/mise-a-jour.test.cjs` (l'app d'hier =
  `d7b6c0d2` : elle se met à jour seule à l'ouverture quand rien ne peut se perdre).
- Le script de nuit (dépôt `hostnextline/garage2.0-sauvegardes`) : 4 fichiers changent (`sauvegarde.mjs`, `restaurer.mjs`,
  `README.md`, `.github/workflows/sauvegarde.yml`, copiés de `ops/sauvegardes` au commit C), après `drive`. Pas inerte : chaque
  nuit il mesure les positions des arrêts à venir (sans la clé du serveur, par le serveur de démonstration public d'OSRM :
  CUTOVER 5 bis, point 6) et `drive_prune(30)` efface les vieux trajets inutilisés de `drive_times`.

## 5. Le retour, dans l'ordre (chaque pièce seule ; jamais de DROP)
1. L'interrupteur, s'il a été allumé : le panneau du propriétaire, ou le bloc SQL de CUTOVER 7. Contrôle : `roads_on()` faux.
2. L'app : Vercel → promouvoir le déploiement de `d7b6c0d2`, ou `git revert -m 1 <fusion>` sur `main` avec `[important]`.
   Dès lors personne n'appelle `move_job` à 8 arguments ; les minutes déjà écrites restent, effacées au prochain
   déplacement de ce rendez-vous.
3. Les clés, si elles ont été mises : la variable GitHub (puis publier), le secret des fonctions.
4. Le script de nuit : reprendre les fichiers d'avant dans l'historique de ce dépôt.
5. Les fonctions : `enroute`, `book`, `backup` redéployées à `837c89d8` (`enroute` renvoie alors l'heure en ligne droite quand
   aucun planificateur ne répond, comme aujourd'hui). `drive` : la laisser.
6. Seulement si l'interrupteur éteint ne répond pas comme avant : les 21 fonctions de `ops/live/rollback/fonctions_avant_27.sql`
   (étape 0.5), dans un bloc d'essai d'abord, puis pour vrai ; puis `alter table public.settings disable trigger settings_roads_guard;`.
7. Reste, inutilisé (jamais de DROP) : `drive_times`, `drive_spend`, `jobs.eta_measured`, `jobs.arrive_at`, les nouvelles fonctions,
   la ligne de `schema_migrations`.
