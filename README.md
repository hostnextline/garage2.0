# Mécanique Mobile H.I.S — l'app du garage (version 2)

L'app de l'équipe : réserver par bloc (matin, après-midi, soir), la journée des mécanos (je pars, je suis arrivé,
signature, facture, paiement), les clients et leurs autos, les estimations, l'équipe et ses droits, la carte,
la trésorerie, l'inventaire et les chiffres du garage. Elle marche sans réseau et s'installe sur le téléphone.

**Les vraies routes** (pas encore en ligne) : quand le propriétaire les allume (Réglages → Réservations → « Vraies
routes »), l'app compte le temps de route sur les vraies rues, avec la circulation habituelle de l'heure, mesurée par
TomTom, au lieu d'une estimation ; un trajet pas encore mesuré est dit « pas encore mesuré », jamais deviné (une heure
d'arrivée qui en dépend dit « heure : trajets pas encore mesurés » ; par plages d'arrivée, le client n'a sa plage
qu'une fois la route mesurée). Les cartes ne tracent jamais de ligne droite entre deux arrêts : une vraie route, ou rien en attendant.
Éteintes, l'app planifie et affiche comme avant (l'estimation).

- L'app : **https://mecanique-mobile-his.vercel.app/** (hébergée sur Vercel, équipe NextLine — voir `ops/vercel/README.md`)
- L'ancienne adresse https://hostnextline.github.io/garage2.0/ marche encore (liens déjà envoyés) et dit à l'équipe
  d'aller à la nouvelle
- La page des clients (lien envoyé par texto) : `client.html`

## Comment c'est fait

| Partie | Où |
|---|---|
| Les écrans (Preact, TypeScript) | `src/` — voir `docs/ARCHITECTURE.md` |
| Le look « vitrine » | `docs/DESIGN.md`, `src/ui/styles/` |
| La base de données et ses règles (droits, planification, taxes, numéros de facture) | `supabase/migrations/` |
| Les fonctions du serveur (textos, suivi en route, page client, paiement par carte, NIV, équipe, sauvegardes, mesure des routes) | `supabase/functions/` |
| Les données de départ du garage (prix, horaires, camions) | `supabase/seed.sql` |
| Les sauvegardes de nuit (dépôt privé) | `ops/sauvegardes/` |
| Les tests | `src/**/*.test.ts` (calculs), `tests/db` (règles de la base), `tests/api` (fonctions), `tests/e2e` (l'app au complet) |

## Pour les développeurs

```bash
npm ci
npm run dev                 # puis http://localhost:5173/?demo  (démo sans serveur : ?demo=mechanic, ?demo=office…)
npm test                    # calculs
bash tests/stack/start.sh   # copie locale du serveur (Postgres, Auth, API, fonctions), puis :
node --test tests/db/*.test.mjs tests/api/*.test.mjs
```

Chaque changement de la branche `main` est testé puis publié automatiquement (`.github/workflows/deploy.yml`).
