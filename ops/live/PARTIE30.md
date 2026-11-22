# La Partie 30 (« Réserver à l'heure choisie » : le rendez-vous va à la minute choisie, un avertissement s'il n'y a pas de place, puis la nouvelle carte), après la 29, sur la version en ligne d'aujourd'hui

> **Rien de ce cahier ne se fait sans le go de Hassan à ce moment-là** (STATE.md, 2026-11-22 13:00, règle K5 : « live only
> with Hassan's yes at that time »). On s'arrête au premier écart.

Hassan, 2026-11-22 : « hours can change, but i want to be able to decide so if i forcefully book someone at a specific
time, i want the system to show a warning if there is no place but still let me book it, then show me the new map ».

**Ce qui tourne en ligne aujourd'hui** (2026-11-22) : les migrations jusqu'à `20261122000200` (la Partie 29, appliquée à
12:39, en ligne depuis 12:47 : `ops/live/PARTIE29.md`) ; les fonctions notify, book et client à `0b15944d`, drive, enroute et
backup à `5e23639e`, les six autres à `837c89d8` (la Partie 29 n'en a déployé aucune) ; l'app = `main` `532b47c9` (arbre
`6e3c00ce`, publiée à 12:46 ; le déploiement Vercel d'avant elle : `7fef8258`). Ce cahier part de là. `CUTOVER.md` reste la
référence pour la sauvegarde à la main (1.1.3) et les nombres de contrôle (2c).

Dans ce fichier : **C30** = le commit de la branche `reorganiser` poussé sur GitHub qui contient la Partie 30, jamais `main`
avant l'étape 3.

Les règles de toujours (CLAUDE.md, « The live database ») : jamais `DELETE`, `DROP` ou `TRUNCATE` ; chaque changement d'abord
essayé dans un bloc qui finit par `raise exception` ; une sauvegarde d'abord ; jamais entre 07:30 et 09:00 UTC (2 h 30 à
4 h à Montréal l'hiver) ; quelqu'un qui regarde ; on s'arrête au premier écart.

**Ce que ça change** (à dire à Hassan, en ses mots) :
- Dans le calendrier des heures de la réservation (« Plages d'arrivée »), l'heure qu'il touche est l'heure où le camion
  arrive : le rendez-vous est **fixé à cette minute** (comme un « Déplacer à l'heure choisie »), sa plage est celle de
  cette heure (13 h 30 → 13 h à 17 h). Les autres arrêts gardent leur ordre et leur heure ; repoussés seulement quand le
  nouveau prend vraiment leur temps (c'est dit).
- Pas de place à cette heure (un client mis en retard, le camion après ses heures, une heure que l'app n'offre pas) :
  **un avertissement d'abord** (qui, de combien, la fin du camion), puis « Réserver quand même à 14 h » (le propriétaire
  et le bureau seulement, comme « Réserver quand même » aujourd'hui ; un mécano voit pourquoi non) ou « Choisir une autre
  heure ». Le camion ne peut pas être là à cette minute : « Mettre à 14 h 20 ». Une journée serrée (Partie 29) aussi :
  le rendez-vous va À sa minute, pas à la fin.
- Après : **la nouvelle carte** de la journée (chaque véhicule dans son nouvel ordre, le nouvel arrêt marqué, ceux
  repoussés ou en retard marqués, les routes par les rues seulement).
- Le texto de réservation part tout de suite, comme aujourd'hui ; les clients repoussés ne reçoivent rien tout seuls
  (l'app les nomme : à appeler, ou leur nouvelle heure part avec « Envoyer les heures aux clients »).
- Rien ne change en mode blocs, ni pour « Dans la journée » (flexible), ni pour une réservation de plusieurs autos.

## 0. Avant (rien ne change)

1. Toute la suite au commit C30 sur le Mac (la porte du chef : `npx tsc --noEmit`, `npm test`, chaque fichier de la base
   avec `FRESH=1` — dont `tests/db/reserver-heure.test.mjs` et `tests/db/reserver-heure-essai.test.mjs`, qui essaie aussi
   `essai-partie30.sql` et `retour-partie30.sql` sur la copie —, l'API, `ops/tests`, les navigateurs `reserver-heure`,
   `deplacer`, `plages`). C30 poussé (branche `reorganiser`), pour que GitHub serve le fichier. Contrôle :
   `git diff --stat 532b47c9 C30 -- supabase/functions` est **vide** (aucune fonction du serveur ne change).
2. « Sauvegarde du garage » à la main (CUTOVER 1.1.3) : verte ; noter son commit.
3. Lecture seule : `ops/live/partie30/avant.sql` (UNE réponse JSON) → `migrations` commence par `20261122000200`,
   `partie29_la` vrai, `partie30_la` faux, `book_job_partie30` faux, `book_preview_la` faux, `windows_on` vrai, `roads_on`
   faux. Noter `nombres` et `numero_suivant` (le contrôle 1 c et l'essai les comparent) ; lire à Hassan `minutes_pointees`
   (les arrêts déjà fixés à une minute : une réservation à l'heure les garde où ils sont) et `en_retard` (les journées déjà
   serrées).
4. Noter l'id du déploiement Vercel qui sert l'app aujourd'hui (`main` `532b47c9`) : c'est le retour de l'app.

## 1. La migration (hors des heures de l'équipe si possible ; elle ne touche aucune ligne)

a. **L'ESSAI** : `ops/live/partie30/essai-partie30.sql` (remplacer `<C>` par C30 et `<SHA256>` par
   `shasum -a 256 supabase/migrations/20261122000300_reserver_heure.sql` au commit C30). Il vérifie que la Partie 29 est là et
   pas la 30, télécharge le fichier au commit C30, vérifie son empreinte, met `lock_timeout` à 5 s, calcule le plan de
   chaque bloc des 14 prochains jours, applique la migration, recalcule et compare : la Partie 30 ne change aucune
   fonction du planificateur, donc **toutes** les réponses doivent être les MÊMES (aucune exception) ; compte les clients,
   rendez-vous, factures et paiements avant / après et regarde que `job_number_seq` n'a pas bougé ; vérifie que
   `book_job` dit « Part 30 », que `book_preview` et `book_job` sont ouvertes à l'app et les trois aides (`book_at`,
   `book_at_row`, `book_at_try`) au serveur seul, que `roads_on` reste faux ; puis demande UN aperçu
   (`book_preview`) d'une réservation à 17 h, au nom du premier propriétaire, pour le client du premier rendez-vous à venir
   ce jour-là (sa réponse, ou le code de son refus), et revérifie les nombres et le numéro — dans UNE transaction toujours
   défaite. Attendu : l'erreur « ESSAI OK : reserver_heure (rien n'est gardé) ; N réponses du planificateur comparées,
   toutes les mêmes ; numéro de rendez-vous inchangé (…) ; aperçu d'une réservation à 17 h : … ». Noter N et l'aperçu, les
   dire à Hassan. « ARRÊT : … » ou toute autre erreur : on s'arrête, rien n'a changé. Essayé sur le Mac (la copie locale,
   la Partie 30 défaite par `retour-partie30.sql` dans une transaction défaite) : « ESSAI OK : reserver_heure (rien n'est
   gardé) ; 14 réponses du planificateur comparées, toutes les mêmes ; numéro de rendez-vous inchangé (…) ; aperçu d'une
   réservation à 17 h : … {"exact": true, "force": false, …} ». Pas mesuré : sa durée sur les vraies données.
b. **POUR VRAI** : le bloc de CLAUDE.md, avec le fichier `20261122000300_reserver_heure.sql` au commit C30, son empreinte
   vérifiée, et `lock_timeout` à 5 s avant `execute body` :
   ```sql
   do $do$
   declare r record; body text; sha text;
   begin
     select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C30>/supabase/migrations/20261122000300_reserver_heure.sql');
     if r.status <> 200 then raise exception 'téléchargement : %', r.status; end if;
     body := r.content;
     sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
     if sha <> '<SHA256>' then raise exception 'sha mismatch: %', sha; end if;
     perform set_config('lock_timeout', '5s', true);
     execute body;
     insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261122000300', 'reserver_heure', array[body]);
   end $do$;
   ```
   Dès ce moment, l'app d'aujourd'hui marche comme avant : elle n'envoie jamais `arrive_at`, donc `book_job` fait la
   réservation d'avant (le texte de la Partie 27), et elle n'appelle pas `book_preview`.
c. **CONTRÔLE** (lecture seule) : `schema_migrations` montre `20261122000300` ; les nombres de CUTOVER 2c et `numero_suivant`
   inchangés ; `select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('book_job',
   'book_preview', 'book_at', 'book_at_row', 'book_at_try')` → les cinq, `book_job` avec « Part 30 » dans son texte ;
   `select public.roads_on()` → faux. La migration n'envoie aucun `DROP`, `DELETE` ni `TRUNCATE`, n'écrit aucune ligne, ne
   refait que `book_job` (le texte de la Partie 27, changé seulement aux lignes « Part 30 ») et n'ajoute que les quatre
   autres, avec « create or replace », et peut être appliquée deux fois (test « the migration » de
   `tests/db/reserver-heure.test.mjs`).

## 2. Les fonctions du serveur

Aucune fonction du serveur ne change dans la Partie 30 (le contrôle 0.1). Elles restent où la Partie 29 les a laissées :
notify, book et client à `0b15944d`, drive, enroute et backup à `5e23639e`, les six autres à `837c89d8`. Le texto de
réservation est celui de `notify` à `0b15944d` (il lit la plage du rendez-vous : celle de la minute choisie).

## 3. L'app (main)

- APRÈS la migration seulement (l'app nouvelle demande `book_preview` ; sans la migration, elle dirait « pas pu vérifier »
  à chaque heure touchée). Fusionner C30 dans `main` (avec `[important]` dans la première ligne : les téléphones voient la
  mise à jour), pousser `main` puis `main:construction-v2`. L'id du déploiement d'avant est noté (0.4).
- Dès qu'elle est publiée : une heure touchée dans le calendrier de la réservation est vérifiée par le serveur ; pas de
  place → l'avertissement ; après une réservation qui a changé l'heure de quelqu'un, la nouvelle carte.
- Contrôle : un vrai chargement de l'app (Chromium) propre ; le calendrier des heures de « Réserver » s'ouvre.

## 4. Après, avec Hassan (lecture seule pour nous)

- Rien à refaire pour lui : la migration n'écrit aucune ligne, les rendez-vous déjà pris gardent leur heure.
- Lui dire : chaque heure qu'il touche dans le calendrier fixe le rendez-vous à cette minute ; « Dans la journée » et le
  jour seul ne fixent rien (comme avant). Les clients mis en retard par un « Réserver quand même » sont gardés dans
  l'historique (`activity` « booked_at ») et nommés à l'écran : à appeler.

## 5. Le retour, dans l'ordre (chaque pièce seule ; jamais de DROP)

1. L'app : Vercel → promouvoir le déploiement noté en 0.4, ou `git revert -m 1 <fusion>` sur `main` avec `[important]`.
   Le serveur de la Partie 30 marche avec l'app d'avant (1 b) : ce retour seul suffit si c'est l'écran qui gêne.
2. La migration : `ops/live/partie30/retour-partie30.sql` remet `book_job` tel qu'avant, octet pour octet (le texte de la
   Partie 27 ; `ops/tests` le vérifie), avec ses droits, et **ferme `book_preview` à l'app** (le `book_job` de la Partie 27
   ne connaît pas l'aperçu : un téléphone encore sur l'app nouvelle réserverait pour de vrai dans le bloc défait et
   prendrait un numéro ; ainsi il entend « pas pu vérifier » et réserve comme avant). D'abord essayé avec `rollback;` à la
   place de son `commit;`, puis pour de vrai. Il finit par un contrôle : `book_job` ne dit plus « Part 30 », l'app ne peut
   plus demander l'aperçu. `book_at`, `book_at_row`, `book_at_try` et `book_preview` restent (jamais de DROP ; plus rien
   ne les appelle depuis l'app).
3. Ce qui reste (sans danger) : la ligne `20261122000300` de `schema_migrations` (jamais effacée) ; les rendez-vous pris à
   une minute (`arrive_at`, `truck_pinned`) : le planificateur les lit comme ceux d'un « Déplacer à l'heure choisie » ;
   les lignes d'`activity` « booked_at ».
4. **Pour réinstaller ensuite** : exécuter de nouveau le corps de `20261122000300_reserver_heure.sql` au commit C30 (le bloc
   de 1 b SANS sa ligne `insert into supabase_migrations.schema_migrations` : la ligne y est déjà) ; il rouvre
   `book_preview` à l'app.
