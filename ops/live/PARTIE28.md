# La Partie 28 (« Réorganiser la journée », « Envoyer les heures aux clients »), après la 27, sur la version en ligne d'aujourd'hui

> **PAS FAIT.** Rien de ce fichier ne se fait sans le **go de Hassan**, donné au moment où c'est prêt (le contrat :
> `REARRANGE.md` §7.3 b). Par défaut un autre soir que la Partie 27.

**Ce qui tourne en ligne aujourd'hui** (2026-11-22) : les migrations jusqu'à `20261119000200` (la Partie 27, appliquée à
01:46 depuis `5e23639e`, son interrupteur éteint : `ops/live/PARTIE27.md`) ; les fonctions drive, book, enroute et backup à
`5e23639e` (« C27 »), les neuf autres à `837c89d8` ; l'app = `main` `6f91d6f9` (son dernier changement de l'app :
`55b15877`, « Texter … ? », publié à 03:13 : la version « on demande d'abord » est donc DÉJÀ en ligne, l'étape a. du contrat
est faite). Ce cahier part de là. `CUTOVER.md` reste la référence pour la sauvegarde à la main (1.1.3), les nombres de
contrôle (2c) et les réponses des fonctions (sa table de la section 2).

Dans ce fichier : **C28** = le commit de la branche `reorganiser` poussé sur GitHub (il contient la Partie 27 et
« Texter … ? »), jamais `main` avant l'étape 4.

Les règles de toujours (CLAUDE.md, « The live database ») : jamais `DELETE`, `DROP` ou `TRUNCATE` ; chaque changement d'abord
essayé dans un bloc qui finit par `raise exception` ; une sauvegarde d'abord ; jamais entre 07:30 et 09:00 UTC (2 h 30 à
4 h à Montréal l'hiver) ; hors des heures de l'équipe ; quelqu'un qui regarde ; on s'arrête au premier écart.

Ce que ça change pour l'équipe et les clients, une fois l'app publiée (à dire à Hassan avant) :
- La réservation texte toujours tout de suite (sa confirmation). Un déplacement et une journée réorganisée ne textent
  personne d'eux-mêmes : après un déplacement l'app demande « Texter … ? » (« Envoyer le texto » / « Pas maintenant ») ;
  la journée réorganisée ne demande rien, son bouton « Envoyer les heures aux clients (N) » texte d'un coup les clients
  qui n'ont pas encore leur heure (nouvelle ou changée), jamais deux fois le même.
- La page du client montre l'heure qu'on lui a DITE jusqu'au bouton (un client déplacé à un autre jour voit l'ancien
  jour tant que personne n'a appuyé : la ligne « N clients n'ont pas leur nouvelle heure » sur Aujourd'hui est là pour
  ça).
- La migration marque comme « averti » tout client déjà texté (`told_install`) : seuls ceux qui n'ont jamais reçu leur
  confirmation (réservés sans texto, sans cellulaire, textos coupés) comptent dans le premier N.

## 0. Avant (rien ne change)

1. Toute la suite au commit C28 sur le Mac (la porte du chef : `npx tsc --noEmit`, `npm test`, chaque fichier de la base
   avec `FRESH=1`, l'API, `ops/tests`, les fichiers du navigateur app, deplacer, routes, plages, argent, mise-a-jour,
   reorganiser ; le générateur de la Partie 27 refait le même fichier, `tests/db/vraies-routes-off.test.mjs` vert sans
   changement). C28 poussé (branche `reorganiser`), pour que GitHub serve le fichier.
2. « Sauvegarde du garage » à la main (CUTOVER 1.1.3) : verte ; noter son commit ; télécharger `donnees`.
3. Lecture seule : `select version, name from supabase_migrations.schema_migrations order by version desc limit 4`
   → `20261119000200` (vraies_routes) en haut, `20261122000100` **pas** là. Et `GET /functions/v1/drive?version` → `5e23639e`.
4. Lecture seule : `ops/live/partie28/avant.sql` (UNE réponse JSON). La lire à Hassan, **avec les nombres, avant
   d'installer** :
   - `windows_on`, `roads_on` (en ligne : éteint) ; `cron_plages` (le verrou du soir tourne tout seul) ;
   - `textos_branches` : vrai = les textos partent tout seuls ; faux = le bouton rend chaque texto « à envoyer toi-même » ;
   - `messages_on.moved` : **faux** = chaque client changé tombe dans « À avertir toi-même » et aucune question ne suit
     un déplacement. Hassan l'a peut-être coupé à 01:55 (le temps que « Texter … ? » soit en ligne) : le lui demander
     AVANT, le bouton en a besoin (rallumer : Réglages → Textos → « Rendez-vous changé ») ;
   - `plages` : `win_before_min` sous la moitié de `win_round_min` = des plages qui ne contiennent pas l'arrivée
     (l'écran le dit « arriverait avant sa plage ») ; en ligne on attend les valeurs par défaut (60 / 60) ;
   - `jamais_confirmes` (et par jour, et en clients) : le N du premier bouton, ces clients reçoivent leur confirmation
     complète (l'estimation et le lien pour signer) ; `hors_plage` : les arrêts déjà en dehors de leur plage (ils
     compteront avec la plage de leur arrivée) ; `flexibles`.
5. Noter l'id du déploiement Vercel qui sert l'app aujourd'hui (`main` `6f91d6f9`) : c'est le retour de l'app.

## 1. La migration (hors des heures de l'équipe)

a. **L'ESSAI** : `ops/live/partie28/essai-partie28.sql` (remplacer `<C>` par C28 et `<SHA256>` par
   `shasum -a 256 supabase/migrations/20261122000100_reorganiser.sql` au commit C28). Il vérifie que la Partie 27 est là et
   pas la 28, télécharge le fichier au commit C28, vérifie son empreinte, met `lock_timeout` à 5 s, calcule le plan de
   chaque bloc des 14 prochains jours, applique la migration (elle finit par `told_install()`), recalcule et compare,
   compte les clients, rendez-vous, factures et paiements avant / après, puis dit ce que `told_install()` a marqué et qui
   reste à avertir, jour par jour — dans UNE transaction toujours défaite. Attendu : l'erreur
   « ESSAI OK : reorganiser (rien n'est gardé) ; N rendez-vous marqués avertis, M clients à avertir sur K jours (… ;
   par jour : … ; P réponses du planificateur comparées, toutes les mêmes) ». Noter N, M, K et les dire à Hassan.
   « ARRÊT : … » ou toute autre erreur : on s'arrête, rien n'a changé. Essayé sur le Mac (la copie locale, la Partie 28
   enlevée dans une transaction défaite, 5 rendez-vous à venir) : « ESSAI OK : reorganiser (rien n'est gardé) ; 3
   rendez-vous marqués avertis, 2 clients à avertir sur 2 jours (… ; 14 réponses du planificateur comparées, toutes les
   mêmes) ». Pas mesuré : sa durée sur les vraies données.
b. **POUR VRAI** : le bloc de CLAUDE.md, avec le fichier `20261122000100_reorganiser.sql` au commit C28, son empreinte
   vérifiée, et `lock_timeout` à 5 s avant `execute body` :
   ```sql
   do $do$
   declare r record; body text; sha text;
   begin
     select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C28>/supabase/migrations/20261122000100_reorganiser.sql');
     if r.status <> 200 then raise exception 'téléchargement : %', r.status; end if;
     body := r.content;
     sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
     if sha <> '<SHA256>' then raise exception 'sha mismatch: %', sha; end if;
     perform set_config('lock_timeout', '5s', true);
     execute body;
     insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261122000100', 'reorganiser', array[body]);
   end $do$;
   ```
c. **CONTRÔLE** (lecture seule) : `schema_migrations` montre `20261122000100` ; les nombres de CUTOVER 2c inchangés
   (clients, rendez-vous, factures, paiements : la migration n'ajoute aucune ligne, elle remplit seulement ses colonnes) ;
   `select count(*) from public.jobs where told_how = 'install'` → le N de l'essai (un peu plus si un texto est parti
   entre les deux) ; `select public.roads_on()` → faux ; les 7 colonnes `told_*` et `hand_at` sont là. La migration
   n'envoie aucun `DROP`, `DELETE` ni `TRUNCATE` (même dans ses fonctions), fait ses deux déclencheurs avec
   « create or replace » et peut être appliquée deux fois (test « D18 » de `tests/db/reorganiser.test.mjs`).

## 2. Les fonctions du serveur (après la migration, avant l'app), depuis les fichiers bruts au commit C28, `verify_jwt` éteint

Seules trois changent, dans cet ordre : `notify` (elle appelle les fonctions de la migration : jamais avant elle), `book`,
`client` — chacune avec chaque fichier de `_shared` qu'elle importe, au commit C28. Chacune : `?version` → C28 ;
`POST {}` → 400 `kind` (notify), 200 `{ ok: true, garage, on: false }` (book, la réservation en ligne fermée), 400
`bad_link` (client) — la table de CUTOVER.md, section 2. Les autres restent où la Partie 27 les a laissées (drive,
enroute, backup à `5e23639e` ; le reste à `837c89d8`).

Dès le déploiement de notify : les textos seuls (la confirmation de réservation, « Fixer les plages » des vieux
téléphones, l'« Envoyer le texto » de « Texter … ? ») prennent le bail (`tell_take`) et écrivent ce qui a été dit au
client ; un client texté depuis la question ne sera pas re-texté par le bouton.

## 3. `told_install()` encore une fois

`select public.told_install();` → un nombre (souvent 0) : il marque ce que l'ANCIEN notify a texté entre l'étape 1 et
l'étape 2 (il écrivait `confirm_sent_at`, pas « averti »). Sans lui, ces clients-là seraient textés une 2e fois au premier
bouton.

## 4. L'app (main)

- Fusionner C28 dans `main` (avec `[important]` dans la première ligne), pousser `main` puis `main:construction-v2`. L'id
  du déploiement d'avant est noté (0.5).
- Dès qu'elle est publiée : l'écran « Réorganiser la journée », la ligne « N clients n'ont pas leur nouvelle heure »
  (Aujourd'hui, l'agenda, « Demain »), le bouton « Envoyer les heures aux clients (N) ». Un téléphone encore sur
  l'app d'aujourd'hui marche comme avant (il n'appelle rien de nouveau) ; un téléphone sur une app plus vieille que
  « Texter … ? » texte un déplacement tout seul, sous le bail (ce qui a été dit est écrit).
- Contrôle (lecture seule) : `ops/live/partie28/a-avertir.sql` → les clients à avertir ; leur nombre = celui de la ligne
  d'Aujourd'hui sur le téléphone du propriétaire.

## 5. Le retour, dans l'ordre (chaque pièce seule ; jamais de DROP)

0. **D'ABORD, lecture seule** : `ops/live/partie28/a-avertir.sql` = chaque rendez-vous à venir dont le client n'a pas
   encore son heure (le jour, le numéro, le nom, le téléphone, ce qu'il a eu, l'heure à lui dire). Le donner à Hassan ;
   appuyer sur le bouton pour chaque jour listé (ou appeler chaque client et toucher « Je l'ai averti ») AVANT que quoi
   que ce soit revienne : l'ancienne app et l'ancien notify ne savent rien de qui attend encore son heure.
1. L'app : Vercel → promouvoir le déploiement noté en 0.5, ou `git revert -m 1 <fusion>` sur `main` avec `[important]`.
2. Les fonctions : notify et client revenues à `837c89d8`, book à `5e23639e` (C27). Dès lors l'« Envoyer le texto » de
   « Texter … ? » texte sans écrire ce qui a été dit (l'ancienne app n'a pas de bouton qui en aurait besoin).
3. La migration reste (jamais de DROP) : ses 7 colonnes (ignorées), ses fonctions inutilisées, ses deux
   déclencheurs (ils ne font qu'effacer « averti » quand le client d'un rendez-vous ou son numéro change), sa ligne de
   `schema_migrations`.
