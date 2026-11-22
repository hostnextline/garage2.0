# La Partie 29 (« Réorganiser » : l'arrêt glissé garde l'heure de sa place, les autres gardent la leur), après la 28, sur la version en ligne d'aujourd'hui

> **Le go de Hassan est donné** (STATE.md, 2026-11-22 10:45 : « yes ») : la Partie 29 passe en ligne dès que tout est vert
> ET que la porte du chef est verte, une sauvegarde d'abord, sans redemander ; on s'arrête au premier écart.

Hassan, 2026-11-22, sur la Partie 28 en ligne : « when re-arranging the day, if i move an appointement down, i need it to
change its hour, and accept the appointement where i put it without moving all the others arround ».

**Ce qui tourne en ligne aujourd'hui** (2026-11-22) : les migrations jusqu'à `20261122000100` (la Partie 28, appliquée à
10:10 : `ops/live/PARTIE28.md`) ; les fonctions notify, book et client à `0b15944d`, drive, enroute et backup à `5e23639e`,
les six autres à `837c89d8` ; l'app = `main` `a34413e9` (la fusion de la Partie 28, publiée à 10:17). Ce cahier part de là.
`CUTOVER.md` reste la référence pour la sauvegarde à la main (1.1.3) et les nombres de contrôle (2c).

Dans ce fichier : **C29** = le commit de la branche `reorganiser` poussé sur GitHub qui contient la Partie 29, jamais `main`
avant l'étape 3.

Les règles de toujours (CLAUDE.md, « The live database ») : jamais `DELETE`, `DROP` ou `TRUNCATE` ; chaque changement d'abord
essayé dans un bloc qui finit par `raise exception` ; une sauvegarde d'abord ; jamais entre 07:30 et 09:00 UTC (2 h 30 à
4 h à Montréal l'hiver) ; quelqu'un qui regarde ; on s'arrête au premier écart.

**Ce que ça change** (à dire à Hassan, en ses mots) :
- Dans « Réorganiser la journée », l'arrêt qu'il glisse (plus haut, plus bas, sur l'autre camion) prend l'heure de sa
  nouvelle place (juste après l'arrêt d'avant, son trajet compris) et **la garde** : son heure est fixée (« Heure fixée »),
  comme un « Déplacer à l'heure choisie », et il reste sur le véhicule où il l'a mis.
- Les arrêts qu'il ne touche pas **gardent leur heure** : jamais avancés ; repoussés seulement quand l'arrêt glissé prend
  vraiment leur temps (dit avant d'enregistrer, comme aujourd'hui : « Enregistrer quand même »).
- Jamais refusé pour un retard : l'ordre après « Enregistrer » est le sien.
- La plage de l'arrêt glissé : la sienne si elle contient la nouvelle heure, sinon celle de la nouvelle heure (montrée
  avant, partira avec « Envoyer les heures aux clients » ; aucun texto tout seul). Un arrêt « dans la journée » qu'il
  glisse reçoit sa plage tout de suite (il a choisi son heure). Une « nouvelle plage » égale à celle qu'il a n'est plus
  dite (le cas « 16 h à 20 h devient 16 h à 20 h »).
- Une heure fixée déjà dépassée de quelques minutes (un « Déplacer quand même ») n'est plus perdue à chaque
  « Enregistrer » : elle est refixée à l'arrivée quand l'enregistrement ne la retarde pas.
- Plus tard, une réservation, une annulation, un « Client absent » ou le verrou du soir peuvent encore déplacer les AUTRES
  arrêts dans leur plage, **jamais un arrêt à heure fixée**. Sur une journée serrée (un camion après ses heures, un arrêt
  en retard), où le planificateur cassait les heures fixées (un arrêt fixé à 14 h 20 envoyé à 22 h 27 dans l'essai), ces
  re-planifications gardent maintenant la journée telle quelle (le garde-fou).
- « Laisser l'app choisir » oublie les heures fixées de la journée, comme aujourd'hui.
- **À faire par Hassan après** (rien n'est changé pour lui tout seul) : les journées déjà enregistrées depuis 10 h 18
  (`avant.sql`, `jours_reorganises`) ont des arrêts glissés SANS heure fixée : rouvrir « Réorganiser la journée » sur
  chacune, glisser de nouveau les arrêts dont la place compte, « Enregistrer ».

## 0. Avant (rien ne change)

1. Toute la suite au commit C29 sur le Mac (la porte du chef : `npx tsc --noEmit`, `npm test`, chaque fichier de la base
   avec `FRESH=1` — dont `tests/db/reorganiser-garde.test.mjs`, qui essaie aussi `essai-partie29.sql` et
   `retour-partie29.sql` sur la copie —, l'API, `ops/tests`, le navigateur `reorganiser`). C29 poussé (branche
   `reorganiser`), pour que GitHub serve le fichier. Contrôle : `git diff --stat a34413e9 C29 -- supabase/functions` est
   **vide** (aucune fonction du serveur ne change).
2. « Sauvegarde du garage » à la main (CUTOVER 1.1.3) : verte ; noter son commit.
3. Lecture seule : `ops/live/partie29/avant.sql` (UNE réponse JSON) → `migrations` commence par `20261122000100`,
   `partie29_la` faux, `roads_on` faux. La lire à Hassan avec les nombres : `jours_reorganises` (les journées à
   rouvrir après), `minutes_depassees` (les heures fixées déjà dépassées : aujourd'hui, un « Enregistrer » les perdrait),
   `au_dela_heures` (les journées serrées).
4. Noter l'id du déploiement Vercel qui sert l'app aujourd'hui (`main` `a34413e9`) : c'est le retour de l'app.

## 1. La migration (hors des heures de l'équipe si possible ; elle ne touche aucune ligne)

a. **L'ESSAI** : `ops/live/partie29/essai-partie29.sql` (remplacer `<C>` par C29 et `<SHA256>` par
   `shasum -a 256 supabase/migrations/20261122000200_garder_ordre.sql` au commit C29). Il vérifie que la Partie 28 est là et
   pas la 29, télécharge le fichier au commit C29, vérifie son empreinte, met `lock_timeout` à 5 s, calcule le plan de
   chaque bloc des 14 prochains jours, applique la migration, recalcule et compare (la Partie 29 change l'enregistrement et
   le garde-fou des re-planifications, jamais le planificateur : toutes les réponses doivent être les mêmes), compte les
   clients, rendez-vous, factures et paiements avant / après, vérifie que les trois fonctions sont là et restent au serveur
   seul, puis dit les blocs serrés que les re-planifications garderont tels quels et les heures fixées déjà dépassées —
   dans UNE transaction toujours défaite. Attendu : l'erreur « ESSAI OK : garder_ordre (rien n'est gardé) ; N réponses du
   planificateur comparées, toutes les mêmes ; S blocs serrés que les re-plans garderont tels quels (…) ; M minutes
   pointées déjà dépassées (…) ». Noter N, S, M et les dire à Hassan. « ARRÊT : … » ou toute autre erreur : on s'arrête,
   rien n'a changé. Essayé sur le Mac (la copie locale, la Partie 29 défaite par `retour-partie29.sql` dans une transaction
   défaite, une journée serrée dans 3 jours) : « ESSAI OK : garder_ordre (rien n'est gardé) ; 14 réponses du planificateur
   comparées, toutes les mêmes ; 1 blocs serrés que les re-plans garderont tels quels (["2026-11-25 day"]) ; 0 minutes
   pointées déjà dépassées (…) ». Pas mesuré : sa durée sur les vraies données.
b. **POUR VRAI** : le bloc de CLAUDE.md, avec le fichier `20261122000200_garder_ordre.sql` au commit C29, son empreinte
   vérifiée, et `lock_timeout` à 5 s avant `execute body` :
   ```sql
   do $do$
   declare r record; body text; sha text;
   begin
     select * into r from extensions.http_get('https://raw.githubusercontent.com/hostnextline/garage2.0/<C29>/supabase/migrations/20261122000200_garder_ordre.sql');
     if r.status <> 200 then raise exception 'téléchargement : %', r.status; end if;
     body := r.content;
     sha := encode(extensions.digest(convert_to(body, 'UTF8'), 'sha256'), 'hex');
     if sha <> '<SHA256>' then raise exception 'sha mismatch: %', sha; end if;
     perform set_config('lock_timeout', '5s', true);
     execute body;
     insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261122000200', 'garder_ordre', array[body]);
   end $do$;
   ```
   Dès ce moment, l'app d'aujourd'hui marche avec : elle renvoie au serveur l'`accept` qu'il lui a donné tel quel (avec
   ses heures fixées), et la ligne de l'arrêt glissé dit déjà « vers {heure} » et « Heure fixée {heure} ».
c. **CONTRÔLE** (lecture seule) : `schema_migrations` montre `20261122000200` ; les nombres de CUTOVER 2c inchangés ;
   `select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('day_order_core',
   'replan_block_safe', 'roads_replan') and prosrc like '%Part 29%'` → les trois ; `select public.roads_on()` → faux. La
   migration n'envoie aucun `DROP`, `DELETE` ni `TRUNCATE`, n'écrit aucune ligne, ne refait que ces trois fonctions avec
   « create or replace » et peut être appliquée deux fois (test « the migration » de `tests/db/reorganiser-garde.test.mjs`).

## 2. Les fonctions du serveur

Aucune fonction du serveur ne change dans la Partie 29 (le contrôle 0.1). Elles restent où la Partie 28 les a laissées :
notify, book et client à `0b15944d`, drive, enroute et backup à `5e23639e`, les six autres à `837c89d8`.

## 3. L'app (main)

- Fusionner C29 dans `main` (avec `[important]` dans la première ligne), pousser `main` puis `main:construction-v2`. L'id
  du déploiement d'avant est noté (0.4).
- Dès qu'elle est publiée : la ligne de l'arrêt glissé dit « Heure fixée {heure} : là où tu l'as mis », un arrêt repoussé
  dit son heure d'avant, l'aide de l'écran dit la nouvelle règle (les mots : `src/i18n/fr/reorg.ts`, `src/i18n/en/reorg.ts`).
- Contrôle : un vrai chargement de l'app (Chromium) propre ; « Réorganiser la journée » s'ouvre sur un jour à venir.

## 4. Après, avec Hassan (lecture seule pour nous, ses gestes pour lui)

- Les journées de `jours_reorganises` (0.3) : il les rouvre une à une, glisse de nouveau les arrêts dont la place compte,
  « Enregistrer ». Rien n'est fixé pour lui par la migration (elle n'écrit aucune ligne : fixer ces arrêts maintenant
  écrirait des heures que personne n'a vues).
- Les `minutes_depassees` (0.3) de la journée d'aujourd'hui : au prochain « Enregistrer » qui ne les retarde pas, elles
  sont refixées à leur arrivée (plus perdues).

## 5. Le retour, dans l'ordre (chaque pièce seule ; jamais de DROP)

1. L'app : Vercel → promouvoir le déploiement noté en 0.4, ou `git revert -m 1 <fusion>` sur `main` avec `[important]`.
   Le serveur de la Partie 29 marche avec l'app d'avant (1 b) : ce retour seul suffit si c'est l'écran qui gêne.
2. La migration : `ops/live/partie29/retour-partie29.sql` remet les trois fonctions telles qu'avant, octet pour octet
   (`day_order_core` de la Partie 28, `replan_block_safe` et `roads_replan` de la Partie 27 ; `ops/tests` le vérifie), avec
   leurs droits ; d'abord essayé avec `rollback;` à la place de son `commit;`, puis pour de vrai. Il finit par un contrôle :
   plus aucune des trois ne dit « Part 29 ».
3. Ce qui reste (sans danger) : la ligne `20261122000200` de `schema_migrations` (jamais effacée) ; les heures fixées que
   les enregistrements de la Partie 29 ont écrites (`arrive_at`, `truck_pinned` des arrêts glissés) : le planificateur de
   la Partie 27 les lit comme celles d'un « Déplacer à l'heure choisie », l'enregistrement de la Partie 28 les garde tant
   qu'elles tiennent et dit « perdue » celle qu'un enregistrement repousse.
4. **Pour réinstaller ensuite** : exécuter de nouveau le corps de `20261122000200_garder_ordre.sql` au commit C29 (le bloc
   de 1 b SANS sa ligne `insert into supabase_migrations.schema_migrations` : la ligne y est déjà).
