# Bascule de la refonte sur la base en ligne — et le retour en arrière

Le cahier de route du passage en ligne de la refonte, pièce par pièce : comment vérifier que chaque étape a marché, et
comment revenir en arrière à chaque étape (et ce qui ne se défait pas). Rien de ce fichier ne se fait sans le **go du
propriétaire**, étape par étape.

Les règles de toujours (CLAUDE.md, « The live database ») :

- Jamais `DELETE`, `DROP` ou `TRUNCATE` sur la base en ligne. Jamais de rendez-vous de test (`job_number_seq` ne recule pas).
- Chaque changement est d'abord **essayé** dans un bloc qui finit par `raise exception` (tout est annulé), puis appliqué.
- On s'arrête au **premier écart** entre ce qu'on attend et ce qu'on voit : on comprend avant de continuer.
- L'ordre : **sauvegarde à la main → questions en lecture seule → les 6 migrations une à une → les 12 fonctions du
  serveur, toutes au même commit → ce que le propriétaire fait à la main → l'app.** Le retour se fait dans l'ordre
  inverse, et chaque pièce peut revenir seule : le serveur de la refonte reste compatible avec l'app d'hier (mêmes
  actions, mêmes réponses), et les nouvelles fonctions répondent en mots (`not_ready`) sur une base où les migrations
  ne sont pas encore appliquées.

Dans ce fichier : **C** = le commit de la refonte, poussé sur GitHub (une branche, pas `main` : `main` ne bouge qu'à
l'étape 5) ; **AVANT** = `acf46c3`, la version en ligne aujourd'hui (tag `avant-refonte`) ; **le projet** = Supabase
`garage2` (`wyxvizxabqgvsiiemvfw`).

Quand : hors des heures de l'équipe (après 20 h, avant 7 h), et **jamais entre 07:30 et 09:00 UTC** (2 h 30 à 4 h
l'hiver, 3 h 30 à 5 h l'été : le rapprochement de pg_cron part à 07:40 UTC, la sauvegarde de la nuit à 08:23 UTC).
Compter 1 h 30 en tout. Chaque migration tient des verrous sur les tables qu'elle change jusqu'à sa fin : le bloc de
la section 2 attend au plus 5 secondes un verrou (`lock_timeout`), sinon il s'arrête sans rien changer (réessayer).

---

## 0. Avant de commencer (sur le Mac, rien en ligne)

1. C est poussé sur GitHub, et toute la suite passe à C : `bash tests/stack/mac/all.sh <dossier à C>` (la base,
   l'API, les 39 étapes de bout en bout), `npx tsc --noEmit`, `TZ=America/Toronto npm test` (l'heure du garage,
   comme « Publier l'app » ; sous `TZ=UTC`, six tests d'horloge sont rouges tant que `vite.config.ts` ne fixe pas
   l'heure des tests : ce n'est pas un écart).
2. Les migrations à appliquer : **exactement ces six**, dans cet ordre (vérifier la liste, puis noter l'empreinte de
   chacune) :

   | # | Fichier | Ce qu'il change |
   |---|---|---|
   | 1 | `20261116000050_refonte_socle.sql` | `op_begin` (une opération ne tourne qu'une fois), `op_save` remplacée |
   | 2 | `20261116000100_refonte_argent.sql` | les règles de l'argent : `payment_add`, `payment_remove`, `invoice_finish`, `invoice_reopen`, le Coffre, les achats de stock ; trois déclencheurs refaits |
   | 3 | `20261116000200_refonte_planification.sql` | le planificateur, les plages d'arrivée, `job_step`, `walk_in` ; la tâche pg_cron `garage-lock-windows` refaite (même horaire) |
   | 4 | `20261116000300_refonte_acces.sql` | les droits : des règles d'accès (policies) refaites, `attachments` écrites une fois et sans SVG, `settings.booking.web.on` par `web_switch` seulement |
   | 5 | `20261116000400_refonte_rapprochement.sql` | **ajout seulement** : 3 tables `ops_recon_*`, les fonctions `recon_*`, la tâche pg_cron `garage-recon` (si pg_cron existe) |
   | 6 | `20261116000500_refonte_sauvegarde.sql` | **ajout seulement** : la table `ops_backup_runs` |

   ```
   git diff --name-only --diff-filter=A acf46c3 C -- supabase/migrations | sort     # les six ci-dessus, rien d'autre
   git diff --name-only --diff-filter=M acf46c3 C -- supabase/migrations            # VIDE (une migration déjà en ligne ne change jamais)
   shasum -a 256 supabase/migrations/20261116*.sql                                   # au commit C : les six empreintes
   ```
   Aucune de ces migrations ne réécrit de lignes de données au moment où elle s'applique (que des fonctions, des
   déclencheurs, des règles, des tables neuves) : les nombres du contrôle 2c ne doivent pas bouger.
3. Les fonctions du serveur à C : `ls supabase/functions` = `backup book client conversation enroute hermes notify recon
   ring stripe team vin` (les 11 d'aujourd'hui, plus `recon`, nouvelle) et `_shared`.

## 1. Avant de toucher à quoi que ce soit (une sauvegarde, puis lecture seule)

### 1.1 Les scripts de sauvegarde, puis une sauvegarde à la main

1. Copier dans le dépôt privé `hostnextline/garage2.0-sauvegardes` les fichiers de `ops/sauvegardes/` au commit C
   (liste exacte : section 8). Les nouveaux scripts marchent avec la fonction `backup` d'aujourd'hui (essayé par
   `ops/tests/sauvegardes.test.mjs`).
2. Dans ce dépôt, Settings → Actions → General → « Workflow permissions » : **Read and write** (le travail pousse la
   copie). Aucun secret à mettre : le travail prend un ticket signé de GitHub (`id-token: write` dans le fichier).
3. GitHub → dépôt des sauvegardes → **Actions** → « Sauvegarde du garage » → **Run workflow**. Elle doit finir **verte**.
   Deux avertissements jaunes sont normaux tant que le serveur n'est pas à jour (« ne connaît pas encore backup done »,
   « … le rapprochement »).
4. Noter : le commit de cette sauvegarde dans le dépôt privé, et les totaux de `donnees/_resume.json`.
5. Télécharger ce dossier `donnees` (avec `photos/`) sur le Mac, **hors de GitHub** : c'est la copie de secours si
   GitHub ou le dépôt n'était plus là.

**Retour** : rien à défaire (rien n'a changé dans la base). Les anciens scripts restent dans l'historique du dépôt privé.

### 1.2 Les questions à la base en ligne (lecture seule)

Lancer `ops/live/2026-11-16_verifications.sql` sur la base en ligne, une requête à la fois, et garder chaque réponse
(`ops/live/live.avant.json`). Puis lancer la requête **F** (l'empreinte) sur une base locale construite à AVANT
(`bash tests/stack/mac/up.sh <dossier à acf46c3>`, puis `bash tests/stack/mac/psql.sh -At -f ops/live/2026-11-16_verifications.sql`) et comparer.

| Question | On continue si… | Sinon |
|---|---|---|
| Q1 migrations enregistrées | `fenetres_20261115000100` = `true` et la dernière version est `20261115000100` ; aucune `20261116…` | arrêt : la base en ligne n'est pas où les migrations la croient |
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
   (son adresse et son id). Créer le tag `avant-refonte` sur `acf46c3` (`git tag avant-refonte acf46c3`, poussé avec le go).
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
concurrently`, `vacuum` — le dit ici ; aucune des six n'en a.)

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

Les nombres doivent être ceux de départ (aucune des six ne change de données ; un rendez-vous ou un paiement fait par
l'équipe pendant ce temps les change, d'où « hors des heures de l'équipe »). Après la migration 5 :
`select public.recon_run(public.local_today() - 1, 'manual')` n'est **pas** à lancer à la main (il écrit) : le
rapprochement part de la sauvegarde de l'étape 3.5.

Un fichier qui échoue en **b** n'a rien changé (le bloc est une seule transaction). Les fichiers déjà appliqués restent :
on décide alors entre la suite corrigée et le retour (section 7).

**d. À la fin des six** : F (1.2) sur la base en ligne = F sur une base locale construite à C
(`bash tests/stack/mac/up.sh <dossier à C>`), mêmes écarts attendus qu'en 1.2. Q1 montre les six versions.

Pendant ce temps l'app et les fonctions d'hier tournent sur la base qui change : c'est voulu (tout reste compatible).

## 3. Les fonctions du serveur, toutes au même commit C

1. Chaque fonction est déployée depuis les fichiers bruts de GitHub au commit C (`index.ts`, `handler.ts` et chaque
   fichier de `_shared/` qu'elle importe, **au même commit C**), avec `verify_jwt` coupé (`supabase/config.toml` : les
   12 y sont). Tous les imports restent relatifs et dans `supabase/functions`.
2. L'ordre : d'abord celles que seule la nuit utilise (`backup`, `recon`), puis celles de l'équipe (`team`, `hermes`,
   `vin`, `stripe`), puis celles que voient les clients (`book`, `client`, `notify`, `enroute`, `conversation`, `ring`).
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
     | `enroute`, `hermes`, `recon`, `ring`, `team`, `vin` | 401 `signin` |
4. Les variables des fonctions (Supabase → Edge Functions → Secrets) : **rien de nouveau à mettre**. `SUPABASE_URL`,
   `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` sont données par Supabase. Facultatives, comme hier :
   `APP_BASE_URLS` (défaut : l'adresse Vercel), `BACKUP_REPOS` (défaut : `hostnextline/garage2.0-sauvegardes`),
   `HERMES_URL` / `HERMES_KEY` (la table `secrets` passe d'abord), `CODE_COMMIT` (nouvelle, facultative : le commit se
   lit dans l'adresse). **Jamais en ligne** : `GHL_API_BASE`, `STRIPE_API_BASE`, `OSRM_BASE`, `VPIC_BASE`,
   `GITHUB_OIDC_JWKS` (elles servent aux tests, elles enverraient les appels ailleurs).
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
… lignes, commit … » et « Rapprochement : … » (plus d'avertissement jaune). Contrôle en lecture seule :
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

## 6. Après

- Le lendemain matin : la sauvegarde de la nuit est verte ; si elle est rouge avec « RAPPROCHEMENT », lire les écarts
  (dans le résumé du travail GitHub, et dans l'app : Trésorerie → « Rapprochement »). Rouge sans « RAPPROCHEMENT » : la
  nuit est ratée, et `ops_backup_runs` a une ligne `ok = false` (la raison est dans le travail GitHub).
- Garder dans `ops/live/` les réponses d'avant et d'après (F, Q1-Q9, les nombres de 2c, `deployed.avant.json`).

## 7. Le retour en arrière, pièce par pièce — et ce qui ne se défait pas

Dans l'ordre inverse de la bascule : l'app d'abord (la plus visible), puis les fonctions, puis la base. Chaque pièce
revient seule : l'app d'hier marche avec le serveur de la refonte, et les fonctions d'hier avec la base de la refonte.

| Ce qui ne va pas | Le retour | Durée | Ce qui reste après |
|---|---|---|---|
| **l'app** | Vercel → Deployments → le déploiement noté en 1.3 → « Promote to Production » (immédiat). Vercel ne publie plus les poussées suivantes tant que ce retour n'est pas défait (« Undo Rollback ») : à défaire après la correction. Ou bien `git revert -m 1 <fusion>` + push `main` (3 à 5 min, les deux adresses ; son message porte `[important]` pour que les téléphones reprennent l'ancienne). Les téléphones gardent leurs données : le format du stockage (IndexedDB version 3) ne change pas. | minutes | rien |
| **une fonction du serveur** | la redéployer au commit noté dans `deployed.avant.json`, même procédure (3.1). `recon` n'existait pas : la laisser (rien ne l'appelle sans le travail de nuit, qui dit « pas encore » quand elle répond `not_ready`). | minutes | rien |
| **la clé Stripe** (4) | rien à refaire : l'adresse neuve reçoit les mêmes notifications. La fonction `team` d'hier, si elle revient, recrée une adresse sans remboursements quand on enregistre de nouveau la clé. | — | l'adresse neuve chez Stripe |
| **une fonction SQL** changée par une migration | relancer sa définition d'avant depuis `ops/live/rollback/fonctions_avant.sql` (un `create or replace` garde ses droits ; si la migration a changé ses droits, les remettre comme le dit F d'avant : `grant`/`revoke`). D'abord dans un bloc d'essai (`raise exception`), puis pour vrai. Une fonction ajoutée par la refonte (`op_begin`, `recon_*`…) reste. | minutes | rien |
| **un déclencheur ajouté par la refonte** (migrations 2 et 4 : il ne reste PAS inutilisé, il tourne à chaque écriture) | `alter table … disable trigger …` (jamais `drop` ; `enable trigger` le remet), les lignes du bloc « Déclencheurs » ci-dessous. **Obligatoire** quand une fonction SQL des migrations 2 ou 4 revient à son texte d'avant (`job_step`, `invoice_void`, `coffre_add`…) : sous `jobs_unbilled_guard` et `invoices_number_keep`, les fonctions d'avant sont refusées (`unbilled`, `numbered`). Ces lignes ramènent aussi les règles d'avant (une facture numérotée effaçable, la réservation en ligne changée par un simple enregistrement des réglages, un numéro de téléphone changé sans fermer les liens) : le rapprochement peut alors signaler des trous de numéros (M3). D'abord dans un bloc d'essai. | minutes | les fonctions des déclencheurs, éteintes |
| **une règle d'accès (policy) ou un déclencheur d'avant** (migrations 2, 4) | `alter policy … using (…) with check (…)` / `create or replace trigger …` avec le texte de F d'avant (jamais `drop`). Une policy que la migration 4 a créée sous un nouveau nom : `alter policy` pour la rendre aussi large que l'ancienne (jamais `drop`). | minutes | rien |
| **la tâche pg_cron `garage-recon`** (migration 5) | `select cron.unschedule('garage-recon')` (avec le go : elle ne fait qu'écrire le rapprochement de la veille) | — | — |
| **une table, une colonne ou une fonction ajoutée** | rien : elle reste, inutilisée (jamais de `DROP` en ligne). Une colonne ajoutée a une valeur par défaut : l'app d'hier l'ignore. Une fonction appelée par un déclencheur, elle, tourne tant que son déclencheur est allumé (ligne « un déclencheur ajouté » ci-dessus). | — | l'objet inutilisé |
| **des données abîmées** par la nouvelle logique | `restaurer.mjs` depuis la sauvegarde de 1.1 : `--tables <t> --ids <id>,…` (les téléphones les revoient) ou `--remplacer` sur la seule table concernée (lire le README des sauvegardes : ce que ça fait et ne fait pas). Jamais toute la base, jamais `--neuve` (refusé sur une base qui a des données). | minutes à 1 h | ce qui a été créé depuis (rien n'est effacé) |
| **le projet lui-même** perdu | README des sauvegardes, « Après la perte du projet » : nouveau projet, toutes les migrations, `restaurer-comptes.mjs`, puis `restaurer.mjs donnees --neuve` (répété par un test de `ops/tests`) ; clés des services retapées. | heures | les mots de passe (chacun fait « Mot de passe oublié ») |

**Déclencheurs** — le retour de la base aux règles d'hier (avec le retour des fonctions SQL de
`fonctions_avant.sql`, jamais seul ; essayé d'abord dans un bloc qui finit par `raise exception`) :

```sql
-- les six déclencheurs faits par la refonte : éteints (enable trigger les rallume)
alter table public.invoices disable trigger invoices_number_keep;
alter table public.jobs disable trigger jobs_unbilled_guard;
alter table public.customers disable trigger customers_delete_guard;
alter table public.customers disable trigger customers_phone_links;
alter table public.push_subs disable trigger push_subs_takeover;
alter table public.settings disable trigger settings_web_guard;
-- job_items_invoice_follow existait (sur update seulement) ; la refonte l'a refait sur insert or update.
-- Son texte d'avant est dans F d'avant (pg_get_triggerdef) : « CREATE TRIGGER » y devient « CREATE OR REPLACE TRIGGER ».
-- À AVANT : create or replace trigger job_items_invoice_follow after update on public.job_items for each row execute function job_items_invoice_follow()
```

La dernière ligne se prend dans F d'avant, pas recopiée d'ici : c'est F qui fait foi. Un test le répète
(`ops/tests/sauvegardes.test.mjs`, « the way back ») : une base à AVANT, les six migrations, puis `fonctions_avant.sql`
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

## 8. À copier dans le dépôt privé des sauvegardes (`hostnextline/garage2.0-sauvegardes`)

À la bascule, **avant** la sauvegarde à la main (1.1), depuis `ops/sauvegardes/` au commit C :

| Fichier de ce dépôt | Où dans le dépôt des sauvegardes | Ce qui change |
|---|---|---|
| `ops/sauvegardes/sauvegarde.mjs` | `sauvegarde.mjs` (à la racine) | une photo par fichier (`donnees/photos/`), une table qui bouge est relue, l'avertissement avant 100 Mo, l'option `--fin` (done, puis le rapprochement ; rouge si « bad » ; `not_ready` = « pas encore »), une nuit ratée notée au garage (`done` avec `ok: false`, et `--echec` quand le push est refusé) |
| `ops/sauvegardes/restaurer.mjs` | `restaurer.mjs` | les colonnes de la sauvegarde seulement, les numéros qui ne reculent jamais, `--retablir`, `--ids`, `--neuve` (projet neuf), la réservation en ligne gardée par `--remplacer`, aucun fichier sauté en silence, les tables `ops_backup_runs`, `ops_recon_runs`, `ops_recon_findings`, `ops_recon_baseline` |
| `ops/sauvegardes/restaurer-comptes.mjs` | `restaurer-comptes.mjs` (nouveau) | recrée les comptes de l'équipe avec les mêmes identifiants après la perte du projet |
| `ops/sauvegardes/README.md` | `README.md` | ce que fait et ne fait pas chaque façon de restaurer ; « Après la perte du projet » ; les comptes ; la ligne `backup_repo` |
| `ops/sauvegardes/.github/workflows/sauvegarde.yml` | `.github/workflows/sauvegarde.yml` | la dernière étape `node sauvegarde.mjs --fin donnees`, après le push ; l'étape « Push refusé » (`--echec`) |

Vérifier la copie : `shasum -a 256 ops/sauvegardes/*.mjs` au commit C = les mêmes chiffres dans le dépôt des
sauvegardes ; après la première nuit, `donnees/_resume.json` → `scripts` donne ces mêmes chiffres. Le format change
à partir de cette nuit-là (les photos dans `donnees/photos/`, `attachments.json` sans les images) : l'ancien
`attachments.json` reste dans l'historique, et `restaurer.mjs` lit les deux formats.
