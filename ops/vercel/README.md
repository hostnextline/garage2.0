# L'app sur Vercel

Vercel publie l'app construite et testée par GitHub (le même fichier que GitHub Pages) :

1. À chaque changement de `main`, le workflow « Publier l'app » fait les tests, construit l'app, puis pousse :
   - la branche **`vercel`** : l'app dans `public/` et `vercel.json` (ce dossier-ci) à côté ;
   - la branche `gh-pages` (GitHub Pages, l'ancienne adresse).
2. Le projet Vercel « mecanique-mobile-his » (équipe NextLine) a la branche de production **`vercel`** :
   il publie chaque nouvelle version sans rien construire lui-même. Si un test échoue, rien n'est poussé,
   et l'app en ligne reste la même.
3. Les branches de code (`main`, `construction-v2`) et `gh-pages` ne sont jamais publiées par Vercel
   (`"git": { "deploymentEnabled": false }`).

Les en-têtes (`vercel.json`) : les fichiers de `assets/` gardés un an (leur nom change à chaque version),
`sw.js` et `version.json` jamais gardés (les téléphones voient tout de suite une nouvelle version), et la
caméra (scan du VIN) et la position (la route du camion) permises seulement pour l'app elle-même.
