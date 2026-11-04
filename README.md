# Mécanique Mobile H.I.S — l'app du garage (version 2)

L'app de l'équipe : réserver par bloc (matin, après-midi, soir), la journée des mécanos (je pars, je suis arrivé,
signature, facture, paiement), les clients et leurs autos, les estimations, l'équipe et ses droits, la carte,
la trésorerie, l'inventaire et les chiffres du garage. Elle marche sans réseau et s'installe sur le téléphone.

- L'app : **https://hostnextline.github.io/garage2.0/**
- La page des clients (lien envoyé par texto) : `client.html`

## Comment c'est fait

| Partie | Où |
|---|---|
| Les écrans (Preact, TypeScript) | `src/` — voir `docs/ARCHITECTURE.md` |
| Le look « vitrine » | `docs/DESIGN.md`, `src/ui/styles/` |
| La base de données et ses règles (droits, planification, taxes, numéros de facture) | `supabase/migrations/` |
| Les fonctions du serveur (textos, suivi en route, page client, paiement par carte, NIV, équipe, sauvegardes) | `supabase/functions/` |
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
