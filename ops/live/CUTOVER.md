# Bascule de la refonte sur la base en ligne — et le retour en arrière

Le cahier de route du passage en ligne de la refonte (2026-11-16 ou plus tard), pièce par pièce, avec le retour en
arrière de chaque pièce. Rien de ce fichier ne se fait sans le **go du propriétaire**, étape par étape.

Les règles de toujours (CLAUDE.md, « The live database ») :

- Jamais `DELETE`, `DROP` ou `TRUNCATE` sur la base en ligne. Jamais de rendez-vous de test (`job_number_seq` ne recule pas).
- Chaque changement est d'abord **essayé** dans un bloc qui finit par `raise exception` (tout est annulé), puis appliqué.
- On s'arrête au **premier écart** entre ce qu'on attend et ce qu'on voit : on comprend avant de continuer.
- L'ordre : **sauvegarde à la main → questions en lecture seule → migrations une à une → fonctions du serveur, toutes au
  même commit → l'app.** Le retour se fait dans l'ordre inverse, et chaque pièce peut revenir seule : les changements du
  serveur restent compatibles avec l'app d'hier (mêmes actions, mêmes réponses).

Dans ce fichier : **C** = le commit de la refonte, poussé sur GitHub (une branche, pas `main` : `main` ne bouge qu'à
l'étape 4) ; **AVANT** = `acf46c3`, la version en ligne aujourd'hui (tag `avant-refonte`).

---

## 0. Avant de commencer (sur le Mac, rien en ligne)

1. C est poussé sur GitHub, et toute la suite passe à C : `bash tests/stack/mac/all.sh <dossier à C>` (62 tests de la
   base, les tests de l'API, les 39 étapes de bout en bout), `npx tsc --noEmit`, `npm test`.
2. La liste des migrations à appliquer, dans l'ordre, avec leur empreinte :
   ```
   git diff --name-only --diff-filter=A acf46c3 C -- supabase/migrations | sort
   shasum -a 256 supabase/migrations/<fichier>.sql      # pour chacune, au commit C
   ```
   Une migration **modifiée** (pas ajoutée) depuis AVANT est une erreur : elle est déjà appliquée en ligne sous son
   ancien texte (`git diff --name-only --diff-filter=M acf46c3 C -- supabase/migrations` doit être vide).
3. La liste des fonctions du serveur à C : `ls supabase/functions` (les 11 d'aujourd'hui, plus les nouvelles).

## 1. Avant de toucher à quoi que ce soit (lecture seule, et une sauvegarde)

### 1.1 Les scripts de sauvegarde, puis une sauvegarde à la main

1. Copier dans le dépôt privé `hostnextline/garage2.0-sauvegardes` les fichiers de `ops/sauvegardes/` au commit C
   (liste exacte : section 7). Les nouveaux scripts marchent avec la fonction `backup` d'aujourd'hui (essayé par
   `ops/tests/sauvegardes.test.mjs`) ; la restauration d'une sauvegarde d'avant un changement de schéma a BESOIN du
   nouveau `restaurer.mjs` (l'ancien s'arrêtait sur la première colonne obligatoire ajoutée depuis).
2. GitHub → dépôt des sauvegardes → **Actions** → « Sauvegarde du garage » → **Run workflow**. Elle doit finir **verte**.
   Deux avertissements jaunes sont normaux tant que le serveur n'est pas à jour (« ne connaît pas encore backup done »,
   « … le rapprochement »).
3. Noter : le commit de cette sauvegarde dans le dépôt privé, et les totaux de `donnees/_resume.json`.
4. Télécharger ce dossier `donnees` (avec `photos/`) sur le Mac, **hors de GitHub** : c'est la copie de secours si
   GitHub ou le dépôt n'était plus là.

### 1.2 Les questions à la base en ligne

Lancer `ops/live/2026-11-16_verifications.sql` sur la base en ligne, une requête à la fois (lecture seule), et garder
chaque réponse (`ops/live/live.avant.json`, ou le dossier de travail). Puis lancer la requête **F** (l'empreinte) sur
une base locale construite à AVANT (`bash tests/stack/mac/up.sh <dossier à acf46c3>`, puis
`bash tests/stack/mac/psql.sh -At -f ops/live/2026-11-16_verifications.sql`) et comparer.

| Question | On continue si… | Sinon |
|---|---|---|
| Q1 migrations enregistrées | `fenetres_20261115000100` = `true` et la dernière version est `20261115000100` | arrêt : la base en ligne n'est pas où les migrations la croient |
| Q2 mode de réservation | (une information : `windows_on` dit si l'équipe réserve par plages demain) | — |
| Q3 version de Postgres | 15, 16 ou 17 | (le texte reconstruit par Postgres peut différer d'une version majeure à l'autre : comparer F à l'œil) |
| Q4 pg_cron | (une information : les tâches `garage-housekeeping`, `garage-lock-windows` existent-elles) | — |
| Q7 poids | la base sous 60 % du forfait (500 Mo en gratuit) | pas de copie `snapshot` (1.4) de `attachments`, `position_log`, `op_log`, `messages` |
| Q8 restauration | `may_set_session_replication_role` = `true` ; `http_get` et `digest` = `true` | sans `http_get`/`digest` : la procédure des migrations (section 2) ne marche pas, arrêt ; sans le droit de `session_replication_role` : la restauration ne peut pas tourner en ligne, à savoir avant de compter sur elle |
| F empreinte | les `md5` de la base en ligne = ceux de la base locale à AVANT, sauf les écarts attendus ci-dessous | arrêt : comprendre chaque écart avant d'appliquer quoi que ce soit |

Écarts attendus entre la base en ligne et la base locale : la table `local_migrations` (locale seulement) ;
`migrations` (versions en ligne, noms en local) ; les droits donnés à des rôles qui n'existent qu'en ligne
(`supabase_admin`, `dashboard_user`…). Trois fonctions ont en ligne un corps qu'aucun fichier ne contient tel quel
(`job_step`, `walk_in`, `coffre_add` : modifiées par `replace()` dans des migrations) : si leur `md5` diffère, comparer
leur texte (`select pg_get_functiondef('public.job_step(uuid,uuid,text,jsonb)'::regprocedure)`, de même `walk_in(uuid,jsonb,jsonb)` et `coffre_add(uuid,uuid[],integer,text,date)`) des deux côtés.

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

### 1.4 Une copie des données dans la base (seulement si la fusion la contient)

Si la migration de la refonte apporte `public.snapshot_take` : `select public.snapshot_take('avant_refonte')` après
Q7 (sous 60 % du forfait, sinon la liste sans les grosses tables). C'est le retour le plus rapide pour des données
abîmées. Sans cette fonction, la sauvegarde de 1.1 est le retour des données.

## 2. Les migrations, une à la fois, dans l'ordre

La première est `20261116000050_refonte_socle.sql` (la base partagée : `op_begin`, `op_save`), puis les autres dans
l'ordre de leur nom. Pour **chaque** fichier :

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
  execute body;
  raise exception 'ESSAI OK : <fichier> (rien n''est gardé)';
end $do$;
```

Toute autre erreur : arrêt, rien n'a changé. (Une migration qui ne peut pas tourner dans un bloc — `create index
concurrently`, `vacuum` — le dit ici ; elle s'applique alors à la main, instruction par instruction.)

**b. Pour vrai** (le bloc de CLAUDE.md, identique à l'essai sauf la fin) :

```sql
do $do$
declare r record; body text; sha text;
begin
  select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C>/supabase/migrations/<fichier>.sql');
  if r.status <> 200 then raise exception 'téléchargement : %', r.status; end if;
  body := r.content;
  sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
  if sha <> '<sha256 du fichier local>' then raise exception 'sha différent : %', sha; end if;
  execute body;
  insert into supabase_migrations.schema_migrations (version, name, statements) values ('<version>', '<nom>', array[body]);
end $do$;
```

**c. Le contrôle** : `select version, name from supabase_migrations.schema_migrations order by version desc limit 3`
montre la nouvelle version ; les lignes des tables principales n'ont pas bougé :

```sql
select json_build_object('customers', (select count(*) from public.customers), 'jobs', (select count(*) from public.jobs),
  'invoices', (select count(*) from public.invoices), 'payments', (select count(*) from public.payments),
  'payments_cents', (select coalesce(sum(amount_cents), 0) from public.payments where deleted_at is null),
  'next_job_number', (select last_value from public.job_number_seq));
```

(à prendre une fois avant la première migration, puis après chacune : les nombres doivent être les mêmes, sauf ce
qu'une migration dit changer.)

Un fichier qui échoue en **b** n'a rien changé (le bloc est une seule transaction). Les fichiers déjà appliqués restent :
on décide alors entre la suite corrigée et le retour (section 6).

**d. À la fin des migrations** : F (1.2) sur la base en ligne = F sur une base locale construite à C
(`bash tests/stack/mac/up.sh <dossier à C>`), mêmes écarts attendus qu'en 1.2.

## 3. Les fonctions du serveur, toutes au même commit C

1. Chaque fonction est déployée depuis les fichiers bruts de GitHub au commit C (`index.ts`, `handler.ts` et chaque
   fichier de `_shared/` qu'elle importe, **au même commit C**), avec `verify_jwt` coupé (`supabase/config.toml`).
   Tous les imports restent relatifs et dans `supabase/functions`.
2. L'ordre : d'abord celles que seule la nuit utilise (`backup`, et `recon` si la fusion l'apporte), puis celles de
   l'équipe (`team`, `hermes`, `vin`, `stripe`), puis celles que voient les clients (`book`, `client`, `notify`,
   `enroute`, `conversation`, `ring`).
3. Après chacune, une requête sans danger doit recevoir un refus **propre** (`{ ok: false, code, error }`, 400 ou 401 —
   jamais 404 ni 500) : `POST /functions/v1/<nom>` avec la clé publique et le corps `{}`.
4. Les 6 fonctions qui tournent aujourd'hui avec un `_shared` d'un autre commit (`enroute`, `team`, `backup`, `hermes`,
   `stripe`, `vin`) changent donc aussi par leur `_shared` : c'est voulu, c'est la combinaison que les tests de l'API
   ont essayée à C.
5. Lancer « Sauvegarde du garage » à la main : verte, et cette fois « Sauvegarde notée au garage » et « Rapprochement :
   … » (plus d'avertissement jaune). Une ligne de plus dans `ops_backup_runs`.

## 4. L'app

1. Fusionner C dans `main` ; la première ligne du message porte `[important]` (les téléphones voient l'avis de mise à
   jour). Pousser `main`, puis `git push origin main:construction-v2`.
2. `deploy.yml` vérifie les types, passe les tests, construit, publie (`vercel` et `gh-pages`). Un échec = rien n'est
   publié, l'app en ligne reste celle d'hier.
3. Contrôle : `https://mecanique-mobile-his.vercel.app/version.json` donne le commit fusionné ; l'app s'ouvre sur un
   téléphone ; « Vérifier les mises à jour » l'installe.

## 5. Après

- Le lendemain matin : la sauvegarde de la nuit est verte ; si elle est rouge avec « RAPPROCHEMENT », lire les écarts
  (dans le résumé du travail GitHub, et dans l'app : Trésorerie → « Rapprochement »).
- Garder dans `ops/live/` les réponses d'avant et d'après (F, les nombres de 2c).

## 6. Le retour en arrière, pièce par pièce

Dans l'ordre inverse de la bascule : l'app d'abord (la plus visible), puis les fonctions, puis la base. Chaque pièce
revient seule : l'app d'hier marche avec le serveur de la refonte.

| Ce qui ne va pas | Le retour | Durée | Ce qui reste après |
|---|---|---|---|
| **l'app** | Vercel → Deployments → le déploiement noté en 1.3 → « Promote to Production » (immédiat). Vercel ne publie plus les poussées suivantes tant que ce retour n'est pas défait (« Undo Rollback ») : à défaire après la correction. Ou bien `git revert -m 1 <fusion>` + push `main` (3 à 5 min, les deux adresses). Les téléphones gardent leurs données : le format du stockage (IndexedDB version 3) ne change pas. | minutes | rien |
| **une fonction du serveur** | la redéployer au commit noté dans `deployed.avant.json`, même procédure (3.1). | minutes | rien |
| **une fonction SQL** changée par une migration | relancer sa définition d'avant depuis `ops/live/rollback/fonctions_avant.sql` (un `create or replace` garde ses droits ; si la migration a changé ses droits, les remettre comme le dit F d'avant : `grant`/`revoke`). D'abord dans un bloc d'essai (`raise exception`), puis pour vrai. | minutes | rien |
| **une règle d'accès (policy) ou un déclencheur** | `alter policy … using (…) with check (…)` / `create or replace trigger …` avec le texte de F d'avant (jamais `drop`). | minutes | rien |
| **une table, une colonne ou une fonction ajoutée** | rien : elle reste, inutilisée (jamais de `DROP` en ligne). Une colonne ajoutée a une valeur par défaut : l'app d'hier l'ignore. | — | l'objet inutilisé |
| **des données abîmées** par la nouvelle logique | `snapshot_restore('avant_refonte', '{…}')` pour les tables concernées si 1.4 a été fait ; sinon `restaurer.mjs` depuis la sauvegarde de 1.1 : `--tables <t> --ids <id>,…` (les téléphones les revoient) ou `--remplacer` sur la seule table concernée (lire le README des sauvegardes : ce que ça fait et ne fait pas). Jamais toute la base. | minutes à 1 h | ce qui a été créé depuis (rien n'est effacé) |
| **le projet lui-même** perdu | nouveau projet, migrations, restauration complète de la sauvegarde de 1.1, comptes recréés avec les mêmes identifiants, clés des services retapées (README des sauvegardes, « Ce que la sauvegarde ne garde pas »). Procédure complète à écrire (`REPRISE.md`). | heures | les mots de passe (chacun fait « Mot de passe oublié ») |

## 7. À copier dans le dépôt privé des sauvegardes (`hostnextline/garage2.0-sauvegardes`)

À la bascule, **avant** la sauvegarde à la main (1.1), depuis `ops/sauvegardes/` au commit C :

| Fichier de ce dépôt | Où dans le dépôt des sauvegardes | Ce qui change |
|---|---|---|
| `ops/sauvegardes/sauvegarde.mjs` | `sauvegarde.mjs` (à la racine) | une photo par fichier (`donnees/photos/`), une table qui bouge est relue, l'avertissement avant 100 Mo, l'option `--fin` (done, puis le rapprochement ; rouge si « bad ») |
| `ops/sauvegardes/restaurer.mjs` | `restaurer.mjs` | les colonnes de la sauvegarde seulement, les numéros qui ne reculent jamais, `--retablir`, `--ids`, aucun fichier sauté en silence, les tables `ops_backup_runs`, `ops_recon_runs`, `ops_recon_findings` |
| `ops/sauvegardes/README.md` | `README.md` | ce que fait et ne fait pas chaque façon de restaurer |
| `ops/sauvegardes/.github/workflows/sauvegarde.yml` | `.github/workflows/sauvegarde.yml` | la dernière étape `node sauvegarde.mjs --fin donnees`, après le push |

Vérifier la copie : `shasum -a 256 ops/sauvegardes/*.mjs` au commit C = les mêmes chiffres dans le dépôt des
sauvegardes ; après la première nuit, `donnees/_resume.json` → `scripts` donne ces mêmes chiffres. Le format change
à partir de cette nuit-là (les photos dans `donnees/photos/`, `attachments.json` sans les images) : l'ancien
`attachments.json` reste dans l'historique, et `restaurer.mjs` lit les deux formats.
