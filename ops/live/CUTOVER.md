# Bascule de la refonte sur la base en ligne — et le retour en arrière

> **La refonte est EN LIGNE depuis le 2026-11-21** (les six migrations et les douze fonctions à `837c89d8` à 20 h 06, l'app
> `d7b6c0d2` vers 23 h 10). Les sections 1 à 5 racontent cette nuit-là : elle est faite, ne pas la refaire. La Partie 27
> seule, en partant d'aujourd'hui : **`ops/live/PARTIE27.md`**. Ce fichier reste la référence pour les clés de TomTom, la
> mesure et l'interrupteur (5 bis) et pour le retour en arrière pièce par pièce (7). La Partie 28, après la 27 :
> **`ops/live/PARTIE28.md`**. La Partie 29, après la 28 : **`ops/live/PARTIE29.md`**. La Partie 30, après la 29 :
> **`ops/live/PARTIE30.md`**.

Le cahier de route du passage en ligne de la refonte, pièce par pièce : comment vérifier que chaque étape a marché, et
comment revenir en arrière à chaque étape (et ce qui ne se défait pas). Rien de ce fichier ne se fait sans le **go du
propriétaire**, étape par étape.

Les règles de toujours (CLAUDE.md, « The live database ») :

- Jamais `DELETE`, `DROP` ou `TRUNCATE` sur la base en ligne. Jamais de rendez-vous de test (`job_number_seq` ne recule pas).
- Chaque changement est d'abord **essayé** dans un bloc qui finit par `raise exception` (tout est annulé), puis appliqué.
- On s'arrête au **premier écart** entre ce qu'on attend et ce qu'on voit : on comprend avant de continuer.
- L'ordre : **sauvegarde à la main → questions en lecture seule → les 7 migrations une à une → les 13 fonctions du
  serveur, toutes au même commit → ce que le propriétaire fait à la main → l'app → (un autre soir) les vraies routes :
  les clés de TomTom, la mesure, puis l'interrupteur (section 5 bis).** Le retour se fait dans l'ordre inverse, et chaque
  pièce peut revenir seule : le serveur de la refonte reste compatible avec l'app d'hier (mêmes actions, mêmes
  réponses), et `recon`, nouvelle, répond en mots (`not_ready`) sur une base où les migrations ne sont pas encore
  appliquées. `drive`, nouvelle aussi, ne le fait pas : elle se déploie après sa migration (la 7), jamais avant.
- Les vraies routes (Partie 27) arrivent **éteintes** : la migration 7 et la fonction `drive` ne changent aucun plan
  tant que `settings.booking.roads_on` n'est pas vrai, et cet interrupteur ne s'allume que par le propriétaire, dans
  l'app, à la section 5 bis. Éteint, le planificateur répond exactement comme avant, et les écrans montrent les mêmes
  chiffres qu'aujourd'hui : l'estimation du serveur (« 48 min de route (27,8 km) », « vers 10 h »), comme l'app en ligne.
  C'est voulu (décision du 2026-11-21) : éteint, c'est le chemin du retour ; la règle « un temps ou des km affichés sont
  mesurés » vaut une fois l'interrupteur allumé.

Dans ce fichier : **C** = le commit de la refonte, poussé sur GitHub (une branche, pas `main` : `main` ne bouge qu'à
l'étape 5) ; **AVANT** = `aa1b4e6`, la version en ligne depuis le 2026-11-19 (tag `avant-refonte`) : `acf46c3`, où la refonte a
été coupée, plus « Heures travaillées » (Part 26), que la refonte porte aussi ; **le projet** = Supabase
`garage2` (`wyxvizxabqgvsiiemvfw`).

Quand : hors des heures de l'équipe (après 20 h, avant 7 h), et **jamais entre 07:30 et 09:00 UTC** (2 h 30 à 4 h
l'hiver, 3 h 30 à 5 h l'été : le rapprochement de pg_cron part à 07:40 UTC, la sauvegarde de la nuit à 08:23 UTC).
Compter 1 h 30 en tout. Chaque migration tient des verrous sur les tables qu'elle change jusqu'à sa fin : le bloc de
la section 2 attend au plus 5 secondes un verrou (`lock_timeout`), sinon il s'arrête sans rien changer (réessayer).

---

## 0. Avant de commencer (sur le Mac, rien en ligne)

1. C est poussé sur GitHub, et toute la suite passe à C : `bash tests/stack/mac/all.sh <dossier à C>` (la base,
   l'API, les 39 étapes de bout en bout), puis les autres fichiers du navigateur, qu'`all.sh` ne lance pas : les 9
   étapes des vraies routes (`SRC=<dossier à C> bash tests/stack/mac/e2e-file.sh routes`), puis de la même façon
   `plages` (les plages d'arrivée, interrupteur éteint), `argent` et `mise-a-jour` (l'app d'hier, avec ses données et
   ses changements en attente, mise à jour vers C), les tests de `ops`
   (`SRC=<dossier à C> bash tests/stack/mac/api-tests.sh ops/tests/sauvegardes.test.mjs` et
   `node --test ops/tests/fichiers.test.mjs`), et la base encore une fois sur une base neuve
   (`FRESH=1 bash tests/stack/mac/db-tests.sh` : après un passage dans le navigateur, des lignes restent et les tests du
   rapprochement les voient) ; `npx tsc --noEmit`, `TZ=America/Toronto npm test` (l'heure du garage,
   comme « Publier l'app » ; sous `TZ=UTC`, six tests d'horloge sont rouges tant que `vite.config.ts` ne fixe pas
   l'heure des tests : ce n'est pas un écart).
2. Les migrations à appliquer : **exactement ces sept**, dans cet ordre (vérifier la liste, puis noter l'empreinte de
   chacune) :

   | # | Fichier | Ce qu'il change |
   |---|---|---|
   | 1 | `20261116000050_refonte_socle.sql` | `op_begin` (une opération ne tourne qu'une fois), `op_save` remplacée |
   | 2 | `20261116000100_refonte_argent.sql` | les règles de l'argent : `payment_add`, `payment_remove`, `invoice_finish`, `invoice_reopen`, le Coffre, les achats de stock ; trois déclencheurs refaits |
   | 3 | `20261116000200_refonte_planification.sql` | le planificateur, les plages d'arrivée, `job_step`, `walk_in` ; la tâche pg_cron `garage-lock-windows` refaite (même horaire) |
   | 4 | `20261116000300_refonte_acces.sql` | les droits : des règles d'accès (policies) refaites, `attachments` écrites une fois et sans SVG, `settings.booking.web.on` par `web_switch` seulement |
   | 5 | `20261116000400_refonte_rapprochement.sql` | **ajout seulement** : 3 tables `ops_recon_*`, les fonctions `recon_*`, la tâche pg_cron `garage-recon` (si pg_cron existe) |
   | 6 | `20261116000500_refonte_sauvegarde.sql` | **ajout seulement** : la table `ops_backup_runs` (et le déclencheur `ops_recon_runs_backup_age` sur la table du rapprochement) |
   | — | `20261119000100_heures.sql` | **déjà en ligne, à NE PAS appliquer** (« Heures travaillées », ci-dessous) ; par son nom elle vient entre la 6 et la 7, et c'est là qu'elle passe sur une base neuve |
   | 7 | `20261119000200_vraies_routes.sql` | Partie 27, « Vraies routes », **INERTE** tant que `settings.booking.roads_on` n'est pas vrai : 2 tables neuves (`drive_times` les temps de route mesurés, `drive_spend` ce que TomTom a compté ce mois-ci ; ni l'une ni l'autre n'est sauvegardée), 3 colonnes neuves, vides (`jobs.eta_measured` : l'heure d'arrivée compte-t-elle seulement des trajets mesurés ? ; `drive_times.tt_none_at` ; `jobs.arrive_at` : la minute pointée par un « Déplacer à l'heure choisie », écrite par le serveur seulement), le planificateur refait (une seule horloge quand l'interrupteur est allumé ; éteint, les mêmes réponses et les mêmes lignes qu'avant ; un rendez-vous qui a un `arrive_at` est tenu à cette minute par chaque plan, tant qu'aucun n'en a, rien ne change), `book_job`, `move_job`, `lock_windows_core` et `log_activity` refaites (un seul changement chacune, qui ne joue qu'allumé), `roads_switch`, les deux aperçus `move_preview` et `stop_order_preview` ; « Déplacer à l'heure choisie » (fragment `exact.sql` du générateur) : une forme NEUVE de `move_job` à 8 arguments (`p_exact`, sans valeur par défaut : l'app d'hier appelle les formes à 5 et 7, inchangées) et une forme neuve de `move_preview(p_job, p_day, p_truck, p_at)`, leurs pièces internes (`exact_works`, `exact_try`, `exact_view`, `exact_run`, `exact_hm`, `exact_place`, `exact_move`, `route_hold`, `plan_late_new`, fermées à l'app) ; la nouvelle app appelle `move_job` à 8 arguments : la migration avant l'app, toujours (sans elle, un déplacement à une heure est refusé, rien n'est gardé sur le téléphone) ; un déclencheur neuf `settings_roads_guard` (l'interrupteur et les quatre nombres qui décident de ce que TomTom coûte ne changent que par le propriétaire). Pas de tâche pg_cron, rien qui ne tourne pas dans un bloc |

   ```
   git diff --name-only --diff-filter=A aa1b4e6 C -- supabase/migrations | sort     # les sept ci-dessus, rien d'autre
   git diff --name-only --diff-filter=M aa1b4e6 C -- supabase/migrations            # VIDE (une migration déjà en ligne ne change jamais)
   shasum -a 256 supabase/migrations/20261116*.sql supabase/migrations/20261119000200_vraies_routes.sql  # au commit C : les sept empreintes
   ```
   **Déjà en ligne, à NE PAS appliquer** : `20261119000100_heures.sql` (« Heures travaillées », Part 26, appliquée le
   2026-11-19 depuis le commit `5e77db6`). Elle est dans l'arbre de C parce que la refonte porte la page ; son fichier y
   est le même, octet pour octet (`shasum -a 256` = `92f228bd5ba8fa2a369d219724f72133ed0283a32cdbd15d66169e890befaa8c`),
   et sa ligne existe déjà dans `schema_migrations` (contrôle 1.2). Sur la base en ligne elle est donc passée AVANT les
   six, sur une base neuve elle passe après : les deux ordres finissent au même état (aucune des six ne nomme
   `shifts.fixed_by`, `fixed_at`, `hours_all`, `shifts_read`, `shift_save` ni `shift_remove` ; la boucle des droits de la
   migration 4 ne visite pas ces fonctions). Vérifié par la lecture des fichiers le 2026-11-20, et par
   `tests/db/heures.test.mjs` sur une base neuve ; PAS encore essayé dans l'ordre de la base en ligne (la répétition sur
   une copie de la base en ligne le fera).
   Aucune de ces migrations ne réécrit de lignes de données au moment où elle s'applique (que des fonctions, des
   déclencheurs, des règles, des tables neuves, des colonnes neuves sans valeur) : les nombres du contrôle 2c ne doivent
   pas bouger.
3. Les fonctions du serveur à C : `ls supabase/functions` = `backup book client conversation drive enroute hermes notify recon ring stripe team vin`
   (les 11 d'aujourd'hui, plus `recon` et `drive`, nouvelles) et `_shared`.

## 1. Avant de toucher à quoi que ce soit (une sauvegarde, puis lecture seule)

### 1.1 Les scripts de sauvegarde, puis une sauvegarde à la main

0. **Ce dépôt n'existait pas le 2026-11-20** (vérifié : `gh repo view hostnextline/garage2.0-sauvegardes` → introuvable ; aucun
   appel à la fonction `backup` dans les journaux en ligne des dernières 24 h ; le dépôt `hostnextline/garage-sauvegardes`, lui,
   tourne chaque nuit mais lit le projet Supabase de l'ANCIENNE app). La base en ligne n'avait donc aucune sauvegarde. Le créer
   d'abord, **privé**, avec le go du propriétaire (toutes les données des clients y seront copiées chaque nuit) ; sans lui, la
   bascule ne commence pas.
1. Copier dans le dépôt privé `hostnextline/garage2.0-sauvegardes` les fichiers de `ops/sauvegardes/` au commit C
   (liste exacte : section 8). Les nouveaux scripts marchent avec la fonction `backup` d'aujourd'hui (essayé par
   `ops/tests/sauvegardes.test.mjs`).
2. Dans ce dépôt, Settings → Actions → General → « Workflow permissions » : **Read and write** (le travail pousse la
   copie). Aucun secret à mettre : le travail prend un ticket signé de GitHub (`id-token: write` dans le fichier).
3. GitHub → dépôt des sauvegardes → **Actions** → « Sauvegarde du garage » → **Run workflow**. Elle doit finir **verte**.
   Trois avertissements jaunes sont normaux tant que le serveur n'est pas à jour (« ne connaît pas encore backup done »,
   « … le rapprochement », « … la mesure des routes (fonction « drive ») »).
4. Noter : le commit de cette sauvegarde dans le dépôt privé, et les totaux de `donnees/_resume.json`.
5. Télécharger ce dossier `donnees` (avec `photos/`) sur le Mac, **hors de GitHub** : c'est la copie de secours si
   GitHub ou le dépôt n'était plus là.

**Retour** : rien à défaire (rien n'a changé dans la base). Les anciens scripts restent dans l'historique du dépôt privé.

### 1.2 Les questions à la base en ligne (lecture seule)

Lancer `ops/live/2026-11-16_verifications.sql` sur la base en ligne, une requête à la fois, et garder chaque réponse
(`ops/live/live.avant.json`). Puis lancer la requête **F** (l'empreinte) sur une base locale construite à AVANT
(`bash tests/stack/mac/up.sh <dossier à aa1b4e6>`, puis `bash tests/stack/mac/psql.sh -At -f ops/live/2026-11-16_verifications.sql`) et comparer.

| Question | On continue si… | Sinon |
|---|---|---|
| Q1 migrations enregistrées | `fenetres_20261115000100` = `true` et la dernière version est `20261119000100` (« Heures travaillées », en ligne depuis le 2026-11-19 ; 44 versions en tout) ; aucune `20261116…` ni `20261119000200` | arrêt : la base en ligne n'est pas où les migrations la croient |
| Q2 mode de réservation | (une information : `windows_on` dit si l'équipe réserve par plages ; `web_on` doit être `false`, la réservation en ligne fermée depuis le 2026-11-09) | `web_on` = `true` : le dire au propriétaire avant de continuer |
| Q3 version de Postgres | 15, 16 ou 17 | (le texte reconstruit par Postgres peut différer d'une version majeure à l'autre : comparer F à l'œil) |
| Q4 pg_cron | (une information : `garage-housekeeping`, `garage-lock-windows` existent-elles ; la migration 5 ajoute `garage-recon` seulement si pg_cron est là) | — |
| Q7 poids | la base sous 60 % du forfait (500 Mo en gratuit) | le dire au propriétaire (les photos sont dans la base : décision de forfait) |
| Q8 outils | `http_get` et `digest` = `true` ; `may_set_session_replication_role` = `true` | sans `http_get`/`digest` : la procédure des migrations (section 2) ne marche pas, arrêt ; sans le droit de `session_replication_role` : une restauration ne peut pas tourner en ligne, à savoir avant de compter sur elle |
| Q9 avant la refonte | (des informations : photos SVG, noms des clés de `secrets`, personnes sans courriel, les nombres de départ du contrôle 2c) | — |
| Q10 propriétaires et droits par colonne | le même propriétaire des fonctions de chaque côté ; le `prosrc_md5` de `job_step`, `walk_in`, `coffre_add` égal à celui de la base locale à AVANT | un propriétaire différent : arrêt (une fonction d'un autre rôle perdrait ses droits) ; un `prosrc` différent : comparer les textes avant d'appliquer |
| F empreinte | les `md5` de la base en ligne = ceux de la base locale à AVANT, sauf les écarts attendus ci-dessous | arrêt : comprendre chaque écart avant d'appliquer quoi que ce soit |

Écarts attendus entre la base en ligne et la base locale : la table `local_migrations` (locale seulement) ;
`migrations` (versions en ligne, noms en local) ; les droits donnés à des rôles qui n'existent qu'en ligne
(`supabase_admin`, `dashboard_user`…). Trois fonctions ont en ligne un corps qu'aucun fichier ne contient tel quel
(`job_step`, `walk_in`, `coffre_add` : modifiées par `replace()` dans des migrations) : si leur `md5` diffère, comparer
leur texte (`select pg_get_functiondef('public.job_step(uuid,uuid,text,jsonb)'::regprocedure)`, de même `walk_in(uuid,jsonb,jsonb)` et `coffre_add(uuid,uuid[],integer,text,date)`) des deux côtés.

Q9 dit aussi : une photo SVG déjà en ligne reste (la règle « sans SVG » ne vise que les nouvelles), mais une
restauration la laisse dans la sauvegarde (le script le dit) ; une personne sans courriel ne pourrait pas retrouver son
compte après la perte du projet (l'ajouter dans Réglages → Équipe).

### 1.3 Noter ce qui tourne (la base du retour en arrière)

1. **L'app** : Vercel → projet « mecanique-mobile-his » → Deployments : noter le déploiement de production en service
   (son adresse et son id). Créer le tag `avant-refonte` sur `aa1b4e6` (`git tag avant-refonte aa1b4e6`, poussé avec le go).
2. **Les fonctions du serveur** : la liste en lecture seule des fonctions (version, date, adresse d'origine : elle
   contient le commit) → `ops/live/deployed.avant.json`. (CLAUDE.md en donne une liste écrite à la main ; la liste réelle
   fait foi.)
3. **Le texte de toutes les fonctions SQL** de la base en ligne → `ops/live/rollback/fonctions_avant.sql` (lecture seule) :
   ```sql
   select string_agg(pg_get_functiondef(p.oid) || ';', E'\n\n' order by p.proname, pg_get_function_identity_arguments(p.oid))
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
   ```
   Les règles d'accès (policies), les déclencheurs (triggers), les contraintes et les index d'avant sont en entier dans
   la réponse de F (1.2) : garder ce fichier.
4. **Les données** : la sauvegarde de 1.1 est le retour des données. (`snapshot_take` / `snapshot_restore` ne sont dans
   aucune migration de C : ne pas compter sur elles.)

## 2. Les migrations, une à la fois, dans l'ordre de la table 0.2

Avant la première, prendre les nombres du contrôle **c** (ci-dessous) : ce sont ceux de départ. Pour **chaque** fichier :

**a. L'essai** (tout est annulé ; la réponse attendue est l'erreur `ESSAI OK`) :

```sql
do $do$
declare r record; body text; sha text;
begin
  select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C>/supabase/migrations/<fichier>.sql');
  if r.status <> 200 then raise exception 'téléchargement : %', r.status; end if;
  body := r.content;
  sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
  if sha <> '<sha256 du fichier local>' then raise exception 'sha différent : %', sha; end if;
  perform set_config('lock_timeout', '5s', true);   -- un verrou pris par l'app plus de 5 s : arrêt, rien de changé
  execute body;
  raise exception 'ESSAI OK : <fichier> (rien n''est gardé)';
end $do$;
```

Toute autre erreur : arrêt, rien n'a changé. (`canceling statement due to lock timeout` : l'app tenait une table ;
attendre une minute et refaire l'essai.) (Une migration qui ne peut pas tourner dans un bloc — `create index
concurrently`, `vacuum` — le dit ici ; aucune des sept n'en a.)

**b. Pour vrai** (le bloc de CLAUDE.md, avec le même `lock_timeout` ; identique à l'essai sauf la fin) :

```sql
do $do$
declare r record; body text; sha text;
begin
  select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C>/supabase/migrations/<fichier>.sql');
  if r.status <> 200 then raise exception 'téléchargement : %', r.status; end if;
  body := r.content;
  sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
  if sha <> '<sha256 du fichier local>' then raise exception 'sha différent : %', sha; end if;
  perform set_config('lock_timeout', '5s', true);
  execute body;
  insert into supabase_migrations.schema_migrations (version, name, statements) values ('<version>', '<nom>', array[body]);
end $do$;
```

`<version>` = les 14 chiffres du nom (`20261116000050`), `<nom>` = le reste sans `.sql` (`refonte_socle`).

**c. Le contrôle** : `select version, name from supabase_migrations.schema_migrations order by version desc limit 3`
montre la nouvelle version ; les lignes des tables principales n'ont pas bougé :

```sql
select json_build_object('customers', (select count(*) from public.customers), 'jobs', (select count(*) from public.jobs),
  'invoices', (select count(*) from public.invoices), 'payments', (select count(*) from public.payments),
  'payments_cents', (select coalesce(sum(amount_cents), 0) from public.payments where deleted_at is null),
  'next_job_number', (select last_value from public.job_number_seq));
```

Les nombres doivent être ceux de départ (aucune des sept ne change de données ; un rendez-vous ou un paiement fait par
l'équipe pendant ce temps les change, d'où « hors des heures de l'équipe »). Après la migration 5 :
`select public.recon_run(public.local_today() - 1, 'manual')` n'est **pas** à lancer à la main (il écrit) : le
rapprochement part de la sauvegarde de l'étape 3.5.

Un fichier qui échoue en **b** n'a rien changé (le bloc est une seule transaction). Les fichiers déjà appliqués restent :
on décide alors entre la suite corrigée et le retour (section 7).

**Entre la 6 et la 7** (après le contrôle c de la 6, avant l'essai de la 7) : relancer la requête de 1.3.3 sur la base
en ligne (lecture seule) et garder la réponse dans `ops/live/rollback/fonctions_avant_7.sql`. C'est le texte d'avant de la
migration 7 : elle refait onze fonctions que la migration 3 venait de refaire (`apply_plan`, `book_job`,
`lock_windows_core`, `move_job`, `plan_route`, `replan_block_safe`, `route_cost`, `route_retime`, `route_walk_in`,
`suggest_core`, `suggest_windows_core`) ; leur texte de `fonctions_avant.sql` (AVANT) reprendrait aussi le planificateur
de la refonte (section 7).

**d. À la fin des sept** : F (1.2) sur la base en ligne = F sur une base locale construite à C
(`bash tests/stack/mac/up.sh <dossier à C>`), mêmes écarts attendus qu'en 1.2. Q1 montre les sept versions. Après la migration 7 :
`select public.roads_on()` répond `false` (lecture seule) : les vraies routes sont là, éteintes.

Pendant ce temps l'app et les fonctions d'hier tournent sur la base qui change : c'est voulu (tout reste compatible).

## 3. Les fonctions du serveur, toutes au même commit C

1. Chaque fonction est déployée depuis les fichiers bruts de GitHub au commit C (`index.ts`, `handler.ts` et chaque
   fichier de `_shared/` qu'elle importe, **au même commit C**), avec `verify_jwt` coupé (`supabase/config.toml` : les
   13 y sont). Tous les imports restent relatifs et dans `supabase/functions`.
2. L'ordre : d'abord celles que seule la nuit utilise (`backup`, `recon`), puis `drive` (les vraies routes : la tâche de
   nuit et l'app ; elle lit les tables de la migration 7), puis celles de l'équipe (`team`, `hermes`, `vin`, `stripe`),
   puis celles que voient les clients (`book`, `client`, `notify`, `enroute`, `conversation`, `ring`).
   Ce que la Partie 27 change dans ce lot (toutes partent quand même au même commit C) : `drive` est nouvelle
   (`drive/index.ts`, `drive/handler.ts`, avec `_shared/roads.ts`, `_shared/tomtom.ts`, `_shared/texts.ts`,
   `_shared/http.ts`, `_shared/db.ts`, `_shared/github.ts`) ; `enroute` (« Je pars » : la route de TomTom avec la
   circulation du moment quand le serveur a sa clé, sinon OSRM, sinon pas d'heure, jamais une ligne droite ; au plus 30
   routes à l'heure par personne pour « Je pars », ensuite le trajet et le texto partent sans heure ; un `refresh` d'un
   trajet terminé est refusé sans rien refaire ni texter) ; `book` (« slots » refuse `web_off` avant de mesurer quoi que
   ce soit, comme ce soir où la réservation en ligne est fermée ; allumée, la page mesure l'adresse avant d'offrir des
   moments) ; `backup` (`drive_times` et `drive_spend` ne sont pas sauvegardées).
   `enroute` part AVANT l'app (section 5) : l'app de C redemande l'heure d'arrivée pendant un trajet (`refresh`), et
   l'`enroute` d'hier en ferait un nouveau trajet.
3. **Le contrôle de chacune** :
   - `curl -s "https://wyxvizxabqgvsiiemvfw.supabase.co/functions/v1/<nom>?version"` répond `{"ok":true,"commit":"<C>"}`
     (le commit est lu dans l'adresse des fichiers déployés : un autre commit = une fonction déployée depuis le mauvais
     commit, à refaire). Les fonctions d'hier ne savent pas répondre à `?version`.
   - `POST /functions/v1/<nom>` avec la clé publique et le corps `{}` reçoit la réponse de cette table (jamais 404 ni
     500 ; essayé sur la copie locale du serveur à C) :

     | Fonction | Réponse attendue à `{}` |
     |---|---|
     | `backup` | 401 `signin` (« Ticket GitHub manquant. ») |
     | `book` | **200** `{ ok: true, garage: {…}, on: false }` (les renseignements de la page de réservation, fermée) |
     | `client` | 400 `bad_link` |
     | `conversation` | 400 `action` |
     | `notify` | 400 `kind` |
     | `stripe` | 400 `signature` (Stripe branché) ; 503 `no_stripe` si Stripe n'est pas branché |
     | `drive`, `enroute`, `hermes`, `recon`, `ring`, `team`, `vin` | 401 `signin` |
4. Les variables des fonctions (Supabase → Edge Functions → Secrets) : **rien de nouveau à mettre ce soir-là**
   (`TOMTOM_KEY`, la clé SERVEUR de TomTom, est la seule nouvelle : elle se met à la section 5 bis, un autre soir ;
   sans elle, « Je pars » prend OSRM, gratuit, comme hier, et la mesure des routes aussi ; OSRM, c'est le serveur de
   démonstration public `router.project-osrm.org` (ses règles, lues sur son wiki le 2026-11-20 : un usage raisonnable et
   non commercial, une demande par seconde au plus), et dès cette nuit la mesure de la nuit lui envoie les positions des
   arrêts des jours à venir, interrupteur éteint aussi ; voir 5 bis, « Ce que Hassan doit faire »). `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sont données par Supabase. Facultatives, comme hier :
   `APP_BASE_URLS` (défaut : l'adresse Vercel), `BACKUP_REPOS` (défaut : `hostnextline/garage2.0-sauvegardes`),
   `HERMES_URL` / `HERMES_KEY` (la table `secrets` passe d'abord), `CODE_COMMIT` (nouvelle, facultative : le commit se
   lit dans l'adresse). **Jamais en ligne** : `GHL_API_BASE`, `STRIPE_API_BASE`, `OSRM_BASE`, `OSRM_BACKUP_BASE`, `TOMTOM_BASE`,
   `VPIC_BASE`, `GITHUB_OIDC_JWKS` (elles servent aux tests, elles enverraient les appels ailleurs ; seule exception
   possible : `OSRM_BASE` vers un serveur OSRM du garage lui-même, si le propriétaire en décide ainsi, 5 bis), ni les
   lignes `drive_limits` et `stripe_test_ok` de la table `secrets` (copies de test seulement).
5. Les 6 fonctions qui tournent aujourd'hui avec un `_shared` d'un autre commit (`enroute`, `team`, `backup`, `hermes`,
   `stripe`, `vin`) changent donc aussi par leur `_shared` : c'est voulu, c'est la combinaison que les tests de l'API
   ont essayée à C.

## 4. Ce que le propriétaire fait à la main (après les fonctions, avant l'app)

| Quoi | Où | Comment vérifier |
|---|---|---|
| **La clé Stripe, enregistrée de nouveau** (la même `sk_live_…`) : la fonction `team` crée une nouvelle adresse de notification chez Stripe (avec les remboursements) et efface l'ancienne | l'app : Réglages → Branchements → Stripe → coller la clé → Enregistrer | Stripe → Developers → Webhooks : **une seule** adresse « Mécanique Mobile H.I.S (app V2) » vers `…/functions/v1/stripe`, avec `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.refund.updated`. Seulement les deux premiers : le code à C ne demande pas encore les remboursements (demande R06) ; les paiements marchent, un remboursement fait chez Stripe ne se voit pas dans l'app (le noter à la main) |
| La variable `APP_MIN_BUILT_AT` | GitHub → dépôt garage2.0 → Settings → Secrets and variables → Actions → Variables | **la laisser vide** (ou absente) : elle force la mise à jour des versions plus vieilles qu'une date, seulement après une version nuisible |
| Le dépôt des sauvegardes | section 8, puis 1.1 | `donnees/_resume.json` → `scripts` donne les empreintes des scripts copiés |
| Le travail de nuit | rien de plus (pas de secret : le ticket GitHub). Au premier bon ticket, le serveur note les numéros du dépôt (ligne `backup_repo:hostnextline/garage2.0-sauvegardes` de `secrets`) | 3.5 ci-dessous |

5\. **Lancer « Sauvegarde du garage » à la main** : verte, et cette fois « Sauvegarde notée au garage : … tables,
… lignes, commit … », « Rapprochement : … » et « Routes : N trajets mesurés en M appels. … » (plus d'avertissement
jaune). Sans la clé de TomTom (elle vient à la section 5 bis), c'est OSRM, gratuit (le serveur de démonstration
public : 3.4), qui mesure les heures habituelles ; les vraies routes restent éteintes, rien ne bouge dans les plans. La
mesure de la nuit commence par effacer les trajets que plus personne ne fait (plus de 30 jours, un bout qui n'est plus un
arrêt des jours à venir). Contrôle en lecture seule :
`select ok, tables, rows, commit, at from public.ops_backup_runs order by at desc limit 1` (une ligne `ok = true`) et
`select day, status from public.ops_recon_runs order by day desc limit 1`. Un « RAPPROCHEMENT : des écarts » rouge ici
n'est pas une panne de la bascule : ce sont les écarts que les comptes d'avant contenaient déjà (les lire dans le résumé
du travail ; l'app les montrera à l'étape 5, Trésorerie → « Rapprochement »).

## 5. L'app

1. Fusionner C dans `main` ; la première ligne du message porte `[important]` (les téléphones voient l'avis de mise à
   jour). Pousser `main`, puis `git push origin main:construction-v2`.
2. `deploy.yml` vérifie les types, passe les tests (à l'heure de Montréal), construit, publie (`vercel` et `gh-pages`).
   Un échec = rien n'est publié, l'app en ligne reste celle d'hier. (Un changement de `main` qui ne touche que
   `docs/`, `tests/`, `supabase/`, `ops/live/`, `ops/sauvegardes/`, `ops/tests/`, `CLAUDE.md` ou `README.md` ne publie
   rien ; la fusion de la refonte touche `src/` : elle publie. « Run workflow » publie à la main.)
3. Contrôle : `https://mecanique-mobile-his.vercel.app/version.json` donne le commit fusionné et `"min_built_at": null` ;
   l'app s'ouvre sur un téléphone ; « Vérifier les mises à jour » l'installe (l'app d'hier propose la nouvelle version
   par un avis de 20 secondes ou par « Vérifier » : un téléphone qui ne l'accepte pas garde l'app d'hier, qui marche
   avec le serveur de la refonte ; avant le prochain jour de travail, chaque téléphone de l'équipe devrait montrer le
   nouveau commit dans Réglages → L'app — décision du propriétaire, O-17) ; les données du téléphone sont là (même
   stockage, IndexedDB version 3) ; un téléphone resté hors ligne envoie ses changements en attente au retour du réseau.

## 5 bis. Les vraies routes (Partie 27) : les clés de TomTom, la mesure, puis l'interrupteur

Un **autre soir** que la bascule, une fois la refonte vue un jour de travail. Avant, rien de la Partie 27 ne change un
plan : la migration 7 et la fonction `drive` sont là, l'interrupteur est éteint. Chaque étape ci-dessous se défait seule
(section 7). Ce qui change dès qu'une clé est mise, interrupteur éteint ou pas, est dit à chaque étape.

### Ce que Hassan doit faire

1. **Ouvrir un compte TomTom** pour développeurs (developer.tomtom.com), au nom du garage. Dans le compte : mettre les
   alertes d'usage (et un arrêt au plafond si TomTom en offre un), et savoir si le compte a une carte de crédit. Pas
   vérifié : si TomTom demande une carte à l'ouverture, et s'il refuse ou facture une fois le gratuit passé (sans carte,
   s'il refuse : les cartes passent à OpenStreetMap, les routes et les adresses à OSRM et Photon, comme sans clé).
2. **Créer deux clés** dans ce compte, chacune avec ses produits seulement :
   - la **clé du navigateur** (les cartes, les routes dessinées, les adresses qu'on tape) : elle est publique, elle est
     dans l'app ; ses produits : **Map Display** (les tuiles de carte), **Routing** (les routes dessinées) et **Search**
     (la recherche d'adresse) — l'app ne lui demande rien d'autre —, **jamais Matrix** ; sur le site de TomTom, la
     restreindre aux deux adresses de l'app : `mecanique-mobile-his.vercel.app` **et** `hostnextline.github.io`
     (l'ancienne adresse marche encore). La liste des sites n'arrête que les navigateurs : quelqu'un qui lit l'app peut
     se servir de la clé ailleurs, pour chaque produit qu'elle a, et aucun plafond de l'app ne la compte (d'où les
     produits limités et les alertes du compte) ;
   - la **clé du serveur** (les temps de route que le planificateur compte, et « Je pars ») : ses produits : **Matrix
     Routing** (les temps de route) et **Routing** (« Je pars ») ; elle reste secrète, sans liste de sites (le serveur
     n'est pas un site web).
   Pas vérifié : les écrans du site de TomTom où l'on choisit les produits et la liste des sites d'une clé.
3. **Où coller chacune** (jamais l'une à la place de l'autre — les deux s'appellent `TOMTOM_KEY` : une erreur met la
   clé du serveur, sans liste de sites, dans l'app publique ; vérifier deux fois) :
   - la clé du serveur : Supabase → projet `garage2` → Edge Functions → **Secrets** → nouveau secret `TOMTOM_KEY` ;
   - la clé du navigateur : GitHub → dépôt garage2.0 → Settings → Secrets and variables → Actions → **Variables** →
     nouvelle variable `TOMTOM_KEY` (une variable, pas un secret : elle finit dans l'app publiée de toute façon).
4. **Le plafond du mois**, dans l'app : Réglages → Réservations → « Vraies routes » → « Plafond du mois chez TomTom »
   (le propriétaire seulement ; 10 000 au départ, que Hassan change pour le sien ; 0 = jamais TomTom), et « Enveloppe du
   mois pour la réservation en ligne » (1 000 au départ, comptée dans le plafond). Le choisir AVANT de coller la clé du
   serveur : dès qu'elle est là, la mesure de la nuit demande TomTom chaque nuit, interrupteur éteint aussi.
5. **Ce que ça peut coûter** :
   - gratuit chaque mois, par service (vérifié sur le site de TomTom le 2026-11-19) : 2 500 transactions Matrix (les
     temps de route du planificateur), 20 000 calculs de route (« Je pars », les routes dessinées sur les cartes),
     20 000 recherches d'adresse, 200 000 tuiles de carte ;
   - l'ordre de grandeur des temps de route (compté par la dernière revue sur la copie de test, avec 2 camions et la
     règle de facturation de TomTom notée le 2026-11-19) : **environ 90 transactions pour chaque adresse demandée**
     (nouvelle ou déjà au dossier : elle se mesure contre chaque arrêt des 14 jours à venir), **environ 125 une fois le
     rendez-vous réservé**, autant de nouveau pour un « Déplacer » ou un « Voir d'autres dates » ; **environ 20 000 par
     mois à 8 rendez-vous par jour de travail** : les 2 500 gratuites partent vers le 3e jour de travail du mois, le
     plafond de 10 000 vers le 14e jour. La première mesure de tous les rendez-vous à venir compte en plus (environ 260
     pour 50 rendez-vous à venir, environ 6 400 pour 400), et 120 jours plus tard ses trajets, devenus trop vieux, sont
     redemandés presque tous ensemble ;
   - au-delà du plafond, le reste du mois : les heures habituelles se mesurent avec OSRM, sans la circulation, et les
     heures de pointe attendent le mois suivant ;
   - **le prix au-delà du gratuit n'a PAS été confirmé** : la page de TomTom ne le montrait pas ; un résultat de
     recherche disait environ 0,75 $ les 1 000 routes et 2,50 $ les 1 000 transactions Matrix, sans preuve. Si ce prix
     était le vrai : le plafond de 10 000 = environ 19 $ par mois au plus (7 500 payées), 20 000 = environ 44 $ ;
   - pour ne jamais dépasser le gratuit des temps de route : un plafond de 2 500 ou moins (les plans passent alors à
     OSRM tôt dans le mois). Les cartes, les routes dessinées et les adresses n'ont pas de plafond dans l'app : une tuile
     refusée par TomTom fait passer les cartes à OpenStreetMap ;
   - les freins : chaque personne a 30 appels à l'heure qui demandent TomTom pour une adresse (ensuite OSRM) ; à environ
     90 chacun, c'est encore jusqu'à environ 2 700 transactions à l'heure : un téléphone (ou un script avec sa session)
     qui boucle sur des adresses peut passer le plafond de 10 000 en moins de 4 heures, et le reste du mois se mesure
     alors avec OSRM ; la page de réservation en ligne : 30 adresses à l'heure et son enveloppe du mois (1 000 au départ) ;
   - « Ce mois-ci chez TomTom : … sur … » dans le panneau donne le compte de l'app ; le tableau de bord de TomTom fait
     foi : les comparer après la première semaine (pas vérifié sans le vrai TomTom : s'il compte un carré de trajets
     case par case plutôt que 5 × le plus grand côté, l'app compte trop bas les jours chargés).
6. **Le secours gratuit, OSRM** (une décision du propriétaire) : sans la clé du serveur, quand TomTom refuse ou est
   occupé, et au-delà d'un plafond, le planificateur, « Je pars » et la page de réservation en ligne prennent le serveur
   de démonstration public d'OSRM (`router.project-osrm.org`), fait pour un usage raisonnable et non commercial, une
   demande par seconde au plus : il peut nous bloquer. La mesure de la nuit lui envoie déjà les positions des arrêts à
   venir chaque nuit depuis la bascule, tant que la clé du serveur n'est pas là. Choisir : (a) la clé du serveur
   obligatoire avant d'allumer les vraies routes (OSRM ne sert plus que de secours), (b) un serveur OSRM du garage
   (`OSRM_BASE`, pas essayé), ou (c) le serveur de démonstration tel quel.
7. **Avant d'allumer** : chaque téléphone de l'équipe sur la nouvelle app (5 bis.4, étape 1).
8. **À savoir** (décision du 2026-11-21) : interrupteur éteint, les écrans gardent les chiffres d'aujourd'hui,
   l'estimation du serveur (« 48 min de route (27,8 km) », « +9 min de route », « vers 10 h ») : éteint, c'est l'app
   comme elle est en ligne, le chemin du retour. « Jamais un chiffre deviné » vaut une fois les vraies routes allumées.

### 5 bis.1 La clé du serveur

1. Coller `TOMTOM_KEY` dans les secrets des fonctions (ci-dessus). Le contrôle dit si les fonctions la voient (sinon :
   redéployer `drive`, `enroute` et `book` au même commit C, comme à la section 3).
2. **Contrôle** : l'app, Réglages → Branchements → « Cartes et vraies routes (TomTom) » dit « Le serveur a la clé de
   TomTom. » (c'est `drive { action: 'status' }` → `key: true`).
3. Dès ce moment, interrupteur éteint ou pas : « Je pars » prend la route de TomTom avec la circulation du moment (un
   calcul de route chacun, au plus 30 à l'heure par personne, et au plus 8 `refresh` d'un trajet, un aux 4 minutes au
   plus), et la mesure de la nuit (« Routes : … » de la sauvegarde) demande TomTom, dans le plafond du mois.

### 5 bis.2 La clé du navigateur

1. Mettre la variable `TOMTOM_KEY` du dépôt (ci-dessus), puis GitHub → Actions → « Publier l'app » → **Run workflow**
   (la clé entre dans l'app à sa construction : sans nouvelle publication, rien ne change).
2. **Contrôle** : `version.json` donne la nouvelle version ; sur un téléphone, après « Vérifier les mises à jour », la
   carte montre les tuiles de TomTom (« © TomTom » en bas) et Réglages → Branchements dit « Cette version de l'app a la
   clé des cartes ». Ouvrir aussi l'ancienne adresse (https://hostnextline.github.io/garage2.0/) : sa carte doit
   montrer les tuiles de TomTom aussi (sinon la liste des sites de la clé ne la contient pas : elle passe alors aux
   tuiles d'OpenStreetMap, et les adresses et les routes demandent d'abord TomTom, qui refuse, avant OSRM et Photon).
3. Dès ce moment : les cartes, les routes dessinées et la recherche d'adresse demandent TomTom d'abord (OSRM et Photon
   derrière, comme avant). Les plans ne changent pas.

### 5 bis.3 Mesurer

1. Réglages → Réservations → « Vraies routes » → **« Mesurer maintenant »** (le propriétaire ou le bureau), et rester
   sur l'écran : la barre dit « N trajets mesurés, M à mesurer » ; la fin dit « Tous les trajets à venir sont mesurés. »,
   ou que des trajets se mesureront plus tard (heures de pointe, plafond). Le relancer tant qu'il en reste aux heures
   habituelles (« Trajets à mesurer : … (dont M aux heures habituelles) » : M doit être 0 pour allumer).
2. **Contrôle** (lecture seule) : `select public.roads_state()` → `on: false`, `left0: 0`, `month.tx` sous `month.cap`,
   `rows` compte les trajets gardés (`tomtom`, `osrm`, `none` = pas de route). Les heures d'arrivée de l'agenda n'ont
   pas bougé (interrupteur éteint, mesurer ne change aucun plan).

### 5 bis.4 L'interrupteur

1. Quand : hors des heures de l'équipe (il replanifie tous les jours à venir), jamais entre 07:30 et 09:00 UTC.
   **Avant** : chaque téléphone de l'équipe montre le commit C (ou plus récent) dans Réglages → L'app. L'app d'hier
   (AVANT) ne connaît pas les vraies routes : elle garde ses propres estimations en ligne droite (« Voir sur la carte »,
   « Arrêt n sur N », les km ajoutés), dessine des lignes droites pendant qu'une route se charge, et montre le temps de
   route ajouté du serveur, qui compte 20 minutes pour un trajet pas encore mesuré, comme une vraie route. Un téléphone
   encore sur AVANT : « Vérifier les mises à jour » sur ce téléphone. `APP_MIN_BUILT_AT` n'y aide pas : l'app d'hier ne
   la lit pas (seules les versions à partir de C la lisent).
2. Réglages → Réservations → « Vraies routes » → **« Compter les vraies routes »** (le propriétaire seulement) → la
   question → « Allumer les vraies routes ». L'app mesure d'abord ce qui manque aux heures habituelles, puis le serveur
   allume (`roads_switch`) ; il refuse (`roads_cold`) tant qu'un trajet des jours à venir n'a aucun temps : l'app mesure
   encore une fois et redemande. Rester sur l'écran jusqu'à la fin.
3. La fin dit « Vraies routes allumées : N moments replanifiés. », et deux listes : les moments restés comme avant
   (sinon un rendez-vous tombait dans « À placer » ; leurs heures suivent quand même les vraies routes) et **les
   clients à rappeler** (ils arrivent maintenant plus tard que le moment qu'on leur a dit : appeler ou texter de la
   liste, le texto est prêt).
4. **Contrôle** (lecture seule) : `select public.roads_on()` → `true` ; la ligne d'activité
   `select data from public.activity where action = 'roads_switch' order by at desc limit 1` (`on: true`, `planned`,
   `kept`, `late`).

### 5 bis.5 Ce qu'on regarde ensuite

- Les premiers jours : les heures d'arrivée de l'agenda contre celles que les mécanos vivent. Un rendez-vous réservé
  pendant qu'un trajet n'était pas mesuré compte le « Trajet inconnu » (20 min) jusqu'à sa mesure : l'app le dit
  (« heure : trajets pas encore mesurés », jamais « Vers … » ni « Hors plage ») ; par plages d'arrivée, il reste
  « flexible » (le client a lu « nous vous confirmons la veille une plage de 4 heures ») et a sa plage au verrou du soir
  (18 h la veille) une fois mesuré.
- Chaque matin : la sauvegarde de la nuit dit « Routes : N trajets mesurés en M appels. … » et ce qui reste ; un
  avertissement « TomTom a refusé la clé du serveur » = la clé à vérifier (OSRM a mesuré les heures habituelles) ; un
  avertissement « N rendez-vous arrivent maintenant après l’heure dite au client (les vraies routes de cette nuit) : à
  rappeler. n° … » = les appeler (les numéros, le jour et le bloc ; jamais un nom, le résumé est chez GitHub).
- Le compte du mois : « Ce mois-ci chez TomTom » (Réglages) et le tableau de bord de TomTom (les comparer après la
  première semaine : 5 bis, « Ce que ça peut coûter »).
- Tous les rendez-vous rendus en retard par une replanification automatique (la nuit ne nomme que les siens) :
  `select entity_id, data from public.activity where action = 'window_late' order by at desc` (pas encore d'écran pour
  cette liste).
- Le poids des temps de route : `select pg_size_pretty(pg_total_relation_size('public.drive_times'))` (lecture seule ;
  la mesure de la nuit efface les trajets de plus de 30 jours que plus personne ne fait, Q7 pour la limite du forfait).

## 6. Après

- Le lendemain matin : la sauvegarde de la nuit est verte ; si elle est rouge avec « RAPPROCHEMENT », lire les écarts
  (dans le résumé du travail GitHub, et dans l'app : Trésorerie → « Rapprochement »). Rouge sans « RAPPROCHEMENT » : la
  nuit est ratée, et `ops_backup_runs` a une ligne `ok = false` (la raison est dans le travail GitHub).
- Garder dans `ops/live/` les réponses d'avant et d'après (F, Q1-Q9, les nombres de 2c, `deployed.avant.json`).

## 7. Le retour en arrière, pièce par pièce — et ce qui ne se défait pas

Dans l'ordre inverse de la bascule : les vraies routes d'abord (la section 5 bis, la dernière faite : l'interrupteur,
puis les clés), puis l'app (la plus visible), puis les fonctions, puis la base. Chaque pièce revient seule : l'app d'hier
marche avec le serveur de la refonte, et les fonctions d'hier avec la base de la refonte. Pour les vraies routes,
**éteindre l'interrupteur suffit presque toujours** : éteint, le planificateur répond comme avant la Partie 27.

| Ce qui ne va pas | Le retour | Durée | Ce qui reste après |
|---|---|---|---|
| **les vraies routes** (l'interrupteur, 5 bis.4) — toujours en premier | Réglages → Réservations → « Vraies routes » → « Compter les vraies routes » éteint → « Revenir à l'estimation » (le propriétaire ; `roads_switch(op, false)`). Si l'app de C est ce qui est en panne (l'app d'hier n'a pas ce panneau), ou si le téléphone du propriétaire n'est pas là : le bloc « Éteindre les vraies routes depuis l'éditeur SQL » sous ce tableau — jamais un simple `update` des réglages, que `settings_roads_guard` garde allumé sans rien dire. Les jours à venir sont replanifiés avec l'estimation de « Le calcul de la route » ; la liste des clients à rappeler revient (ceux qui arrivent maintenant plus tard que le moment dit). Contrôle : `select public.roads_on()` → `false`. Les trajets mesurés restent : rallumer plus tard ne remesure pas tout. | minutes | les plans de l'estimation : les heures sont celles de l'estimation, mais pas forcément le même ordre des arrêts qu'avant l'allumage ; les trajets mesurés |
| **la clé du navigateur** (5 bis.2) | effacer (ou vider) la variable `TOMTOM_KEY` du dépôt, puis GitHub → Actions → « Publier l'app » → Run workflow : les cartes, les routes dessinées et les adresses reviennent à OpenStreetMap, OSRM et Photon. Plus vite, sans publier : retirer les deux adresses de la liste de la clé chez TomTom (les cartes passent seules aux tuiles d'OpenStreetMap ; les routes et les adresses demandent d'abord TomTom, qui refuse, puis OSRM et Photon). | minutes | rien |
| **la clé du serveur** (5 bis.1) | effacer le secret `TOMTOM_KEY` des fonctions : « Je pars » et la mesure des routes reviennent à OSRM (gratuit, sans la circulation, le serveur de démonstration public : 5 bis, « Ce que Hassan doit faire », point 6 ; un trajet sans réponse d'OSRM n'a pas d'heure, jamais une ligne droite). Pour garder « Je pars » sur TomTom mais ne plus payer de temps de route : « Plafond du mois chez TomTom » à 0. | minutes | ce que TomTom a déjà compté ce mois-ci |
| **la fonction `drive`** | elle n'existait pas : la laisser. Éteinte, elle ne change aucun plan ; seule la tâche de nuit l'appelle (elle mesure, c'est tout). Si elle fait rougir la nuit (« ERREUR : les routes n'ont pas pu être mesurées ») : la sauvegarde de la nuit est gardée quand même ; corriger, puis la redéployer au commit corrigé. | — | les trajets mesurés |
| **l'app** | Vercel → Deployments → le déploiement noté en 1.3 → « Promote to Production » (immédiat). Vercel ne publie plus les poussées suivantes tant que ce retour n'est pas défait (« Undo Rollback ») : à défaire après la correction. Ou bien `git revert -m 1 <fusion>` + push `main` (3 à 5 min, les deux adresses ; son message porte `[important]` pour que les téléphones reprennent l'ancienne). Les téléphones gardent leurs données : le format du stockage (IndexedDB version 3) ne change pas. | minutes | rien |
| **une fonction du serveur** | la redéployer au commit noté dans `deployed.avant.json`, même procédure (3.1). `recon` n'existait pas : la laisser (rien ne l'appelle sans le travail de nuit, qui dit « pas encore » quand elle répond `not_ready`). Deux à savoir : `enroute` à son commit d'avant la Partie 27 (`837c89d8` depuis le 2026-11-21 ; `a4f2da6` avant la refonte) ramène l'heure d'arrivée en ligne droite dans le texto du client quand aucun planificateur OSRM ne répond (`source: 'line'`) : la ramener à C, pas avant ; `book` d'hier ne mesure jamais une adresse : avec les vraies routes allumées, la page de réservation en ligne n'offrirait alors aucun moment pour une adresse pas encore mesurée (éteindre l'interrupteur d'abord). | minutes | rien |
| **la clé Stripe** (4) | rien à refaire : l'adresse neuve reçoit les mêmes notifications. La fonction `team` d'hier, si elle revient, recrée une adresse sans remboursements quand on enregistre de nouveau la clé. | — | l'adresse neuve chez Stripe |
| **une fonction SQL** changée par une migration | relancer sa définition d'avant depuis `ops/live/rollback/fonctions_avant.sql` (un `create or replace` garde ses droits ; si la migration a changé ses droits, les remettre comme le dit F d'avant : `grant`/`revoke`). D'abord dans un bloc d'essai (`raise exception`), puis pour vrai. Une fonction ajoutée par la refonte ou la Partie 27 (`op_begin`, `recon_*`, `drive_*`, `roads_*`, `route_clock`, `route_mark`, `eta_walk`, `eta_known`, `web_unmeasured`, `move_preview`, `move_job` à 8 arguments, `exact_*`, `route_hold`, `plan_late_new`…) reste ; la colonne `jobs.arrive_at` aussi (l'app d'hier ne la lit pas ; le planificateur d'avant l'ignore : un rendez-vous déplacé à une minute garde sa plage dite au client, le plan suivant le replace dedans). Pour une fonction refaite par la migration 7 (le planificateur de la Partie 27, `book_job`, `move_job`, `lock_windows_core`, `log_activity`…), son texte d'avant est dans `ops/live/rollback/fonctions_avant_7.sql` (pris entre la 6 et la 7, section 2), **pas** dans `fonctions_avant.sql` (qui reprendrait aussi le planificateur de la refonte) ; et seulement si l'interrupteur éteint ne répond pas comme avant : il est fait pour (les tests de la base le comparent aux définitions d'avant, réponses, lignes et activité). | minutes | rien |
| **un déclencheur ajouté par la refonte** (migrations 2, 4, 6 et 7 : il ne reste PAS inutilisé, il tourne à chaque écriture) | `alter table … disable trigger …` (jamais `drop` ; `enable trigger` le remet), les lignes du bloc « Déclencheurs » ci-dessous. `settings_roads_guard` (migration 7) seulement APRÈS l'interrupteur éteint et avec les fonctions d'avant : sans lui, un simple enregistrement des réglages pourrait rallumer les vraies routes. **Obligatoire** quand une fonction SQL des migrations 2 ou 4 revient à son texte d'avant (`job_step`, `invoice_void`, `coffre_add`…) : sous `jobs_unbilled_guard` et `invoices_number_keep`, les fonctions d'avant sont refusées (`unbilled`, `numbered`). Ces lignes ramènent aussi les règles d'avant (une facture numérotée effaçable, la réservation en ligne changée par un simple enregistrement des réglages, un numéro de téléphone changé sans fermer les liens) : le rapprochement peut alors signaler des trous de numéros (M3). D'abord dans un bloc d'essai. | minutes | les fonctions des déclencheurs, éteintes |
| **une règle d'accès (policy) ou un déclencheur d'avant** (migrations 2, 4) | `alter policy … using (…) with check (…)` / `create or replace trigger …` avec le texte de F d'avant (jamais `drop`). Une policy que la migration 4 a créée sous un nouveau nom : `alter policy` pour la rendre aussi large que l'ancienne (jamais `drop`). | minutes | rien |
| **la tâche pg_cron `garage-recon`** (migration 5) | `select cron.unschedule('garage-recon')` (avec le go : elle ne fait qu'écrire le rapprochement de la veille) | — | — |
| **une table, une colonne ou une fonction ajoutée** | rien : elle reste, inutilisée (jamais de `DROP` en ligne ; ainsi `drive_times` et `drive_spend` de la migration 7 restent, rien ne les lit une fois l'interrupteur éteint et les fonctions d'avant revenues). Une colonne ajoutée a une valeur par défaut : l'app d'hier l'ignore. Une fonction appelée par un déclencheur, elle, tourne tant que son déclencheur est allumé (ligne « un déclencheur ajouté » ci-dessus). | — | l'objet inutilisé |
| **des données abîmées** par la nouvelle logique | `restaurer.mjs` depuis la sauvegarde de 1.1 : `--tables <t> --ids <id>,…` (les téléphones les revoient) ou `--remplacer` sur la seule table concernée (lire le README des sauvegardes : ce que ça fait et ne fait pas ; `--remplacer` des réglages garde la réservation en ligne et l'interrupteur des vraies routes comme la base les a : une restauration ne rallume jamais les vraies routes). Jamais toute la base, jamais `--neuve` (refusé sur une base qui a des données). | minutes à 1 h | ce qui a été créé depuis (rien n'est effacé) |
| **le projet lui-même** perdu | README des sauvegardes, « Après la perte du projet » : nouveau projet, toutes les migrations, `restaurer-comptes.mjs`, puis `restaurer.mjs donnees --neuve` (répété par un test de `ops/tests`) ; clés des services retapées (les deux `TOMTOM_KEY` aussi). `--neuve` remet les vraies routes **éteintes** : `drive_times` n'est jamais dans une sauvegarde ; « Mesurer maintenant », puis rallumer dans l'app (5 bis.3, 5 bis.4). `drive_spend` repart de 0 dans le projet neuf : le plafond du mois peut y être dépensé une deuxième fois ce mois-là (la facture de TomTom, elle, continue). | heures | les mots de passe (chacun fait « Mot de passe oublié ») ; les temps de route mesurés (à remesurer) |

**Éteindre les vraies routes depuis l'éditeur SQL** — quand l'app de C ne peut pas le faire. `roads_switch` ne répond
qu'au propriétaire : depuis l'éditeur SQL (personne) il refuse « Seul le propriétaire change la façon de compter la
route. », et un simple `update` de `settings.booking.roads_on` est gardé allumé par `settings_roads_guard`. Le bloc
l'appelle donc au nom du propriétaire, le temps de ce bloc seulement (`set_config(…, true)`). D'abord l'identifiant du
propriétaire (lecture seule), puis l'essai :

```sql
select id, full_name from public.staff where 'owner' = any(roles) and active and deleted_at is null;

do $do$
declare r jsonb;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('request.jwt.claims', '{"sub":"<id du propriétaire>","role":"authenticated"}', true);
  perform set_config('request.jwt.claim.sub', '<id du propriétaire>', true);
  r := public.roads_switch(gen_random_uuid(), false);
  raise exception 'ESSAI OK (rien n''est gardé) : %', r;
end $do$;
```

La réponse attendue est l'erreur `ESSAI OK (rien n'est gardé) : {"ok": true, "on": false, …}` (avec `planned`, `kept`,
`late`). Pour vrai : le même bloc, la ligne `raise exception …` remplacée par `raise notice 'FAIT : %', r;`. Contrôle :
`select public.roads_on()` → `false`, et la ligne d'activité `roads_switch` (`on: false` ; `late` = les clients à
rappeler). Les jours à venir sont replanifiés : hors des heures de l'équipe si possible. Jamais ce bloc pour rallumer :
rallumer se fait dans l'app, qui mesure d'abord (5 bis.4). (Essayé sur la copie de test le 2026-11-21, dans une
transaction annulée.)

**Déclencheurs** — le retour de la base aux règles d'hier (avec le retour des fonctions SQL de
`fonctions_avant.sql`, jamais seul ; essayé d'abord dans un bloc qui finit par `raise exception`) :

```sql
-- les huit déclencheurs faits par la refonte et la Partie 27 : éteints (enable trigger les rallume)
alter table public.invoices disable trigger invoices_number_keep;
alter table public.jobs disable trigger jobs_unbilled_guard;
alter table public.customers disable trigger customers_delete_guard;
alter table public.customers disable trigger customers_phone_links;
alter table public.push_subs disable trigger push_subs_takeover;
alter table public.settings disable trigger settings_web_guard;
-- le septième, ajouté au tour 2 par la migration 6 (sauvegarde) sur une table neuve : il manquait ici, et le test
-- « the way back » était rouge sur GitHub le 2026-11-20 (un déclencheur de plus qu'AVANT restait allumé)
alter table public.ops_recon_runs disable trigger ops_recon_runs_backup_age;
-- les vraies routes (migration 7) : seulement l'interrupteur déjà éteint (roads_switch, section 7, première ligne)
alter table public.settings disable trigger settings_roads_guard;
-- job_items_invoice_follow existait (sur update seulement) ; la refonte l'a refait sur insert or update.
-- Son texte d'avant est dans F d'avant (pg_get_triggerdef) : « CREATE TRIGGER » y devient « CREATE OR REPLACE TRIGGER ».
-- À AVANT : create or replace trigger job_items_invoice_follow after update on public.job_items for each row execute function job_items_invoice_follow()
```

La dernière ligne se prend dans F d'avant, pas recopiée d'ici : c'est F qui fait foi. Un test le répète
(`ops/tests/sauvegardes.test.mjs`, « the way back ») : une base à AVANT, les sept migrations, puis `fonctions_avant.sql`
et ce bloc : les fonctions et les déclencheurs allumés sont ceux d'AVANT.

**Ce qui ne se défait pas** (le savoir avant le go) :

- Les numéros donnés pendant et après la bascule (rendez-vous, factures, soumissions) : ils ne reculent jamais.
- Ce que l'équipe et les clients ont fait sous les nouvelles règles (paiements, remboursements, rendez-vous déplacés,
  « Effacer ») reste tel quel : revenir à une fonction d'avant ne le refait pas à l'ancienne.
- Les lignes écrites par la refonte : `op_log` (une par opération, comme avant), `ops_backup_runs`, `ops_recon_*`,
  `activity` ; elles restent, inutiles pour l'app d'hier.
- L'adresse de notification Stripe recréée en 4 (l'ancienne est effacée chez Stripe).
- Le format des sauvegardes dans le dépôt privé à partir de la première nuit des nouveaux scripts (les photos dans
  `donnees/photos/`) : l'ancien `restaurer.mjs` ne lit pas ce format ; garder le nouveau (il lit les deux).
- La ligne `backup_repo:…` de `secrets` (les numéros du dépôt des sauvegardes) : un dépôt refait sous le même nom est
  refusé tant qu'elle reste (README des sauvegardes : l'effacer pour déplacer les sauvegardes, avec le go).
- Les vraies routes : ce que TomTom a compté (sa facture, s'il y en a une) ; les rendez-vous replanifiés en allumant
  puis en éteignant (éteindre redonne les heures de l'estimation, pas forcément l'ordre des arrêts d'avant ; ce qui a
  été dit aux clients rappelés reste dit) ; un rendez-vous laissé « flexible » parce que son heure n'était pas mesurée
  (le client a lu « nous vous confirmons la veille une plage de 4 heures ») le reste jusqu'au verrou du soir, qui lui
  donne sa plage (de l'estimation, une fois éteint) ; les lignes `activity` `roads_switch` et `window_late`,
  `drive_times`, `drive_spend`, et les freins et les baux de `drive` et d'`enroute` dans `rate_limits` (`drive:…`,
  `enroute:road:…`, ils s'effacent seuls ; `jobs.eta_measured` revient à vide quand l'interrupteur s'éteint).

## 8. À copier dans le dépôt privé des sauvegardes (`hostnextline/garage2.0-sauvegardes`)

À la bascule, **avant** la sauvegarde à la main (1.1), depuis `ops/sauvegardes/` au commit C :

| Fichier de ce dépôt | Où dans le dépôt des sauvegardes | Ce qui change |
|---|---|---|
| `ops/sauvegardes/sauvegarde.mjs` | `sauvegarde.mjs` (à la racine) | une photo par fichier (`donnees/photos/`), une table qui bouge est relue, l'avertissement avant 100 Mo, l'option `--fin` (done, puis le rapprochement ; rouge si « bad » ; `not_ready` = « pas encore » ; puis la mesure des routes : `drive { action: 'sweep' }` avec le même ticket GitHub, redemandée tant que `more`, 10 appels au plus ; pas de `drive` = un avertissement ; les rendez-vous que cette mesure a mis en retard nommés dans le résumé et en avertissement : numéros, jour, bloc, jamais un nom), une nuit ratée notée au garage (`done` avec `ok: false`, et `--echec` quand le push est refusé) |
| `ops/sauvegardes/restaurer.mjs` | `restaurer.mjs` | les colonnes de la sauvegarde seulement, les numéros qui ne reculent jamais, `--retablir`, `--ids`, `--neuve` (projet neuf), la réservation en ligne et l'interrupteur des vraies routes gardés comme la base les a par `--remplacer` (`--neuve` remet les vraies routes éteintes), aucun fichier sauté en silence, les tables `ops_backup_runs`, `ops_recon_runs`, `ops_recon_findings`, `ops_recon_baseline` |
| `ops/sauvegardes/restaurer-comptes.mjs` | `restaurer-comptes.mjs` (nouveau) | recrée les comptes de l'équipe avec les mêmes identifiants après la perte du projet |
| `ops/sauvegardes/README.md` | `README.md` | ce que fait et ne fait pas chaque façon de restaurer ; « Après la perte du projet » ; les comptes ; la ligne `backup_repo` ; la fin de chaque nuit (le garage prévenu, le rapprochement, puis les routes) |
| `ops/sauvegardes/.github/workflows/sauvegarde.yml` | `.github/workflows/sauvegarde.yml` | la dernière étape `node sauvegarde.mjs --fin donnees`, après le push (son nom dit aussi « puis les routes ») ; l'étape « Push refusé » (`--echec`) |

Vérifier la copie : `shasum -a 256 ops/sauvegardes/*.mjs` au commit C = les mêmes chiffres dans le dépôt des
sauvegardes ; après la première nuit, `donnees/_resume.json` → `scripts` donne ces mêmes chiffres. Le format change
à partir de cette nuit-là (les photos dans `donnees/photos/`, `attachments.json` sans les images) : l'ancien
`attachments.json` reste dans l'historique, et `restaurer.mjs` lit les deux formats.
