# Sauvegardes du garage

Ce dossier est copié dans un dépôt GitHub **privé** à part (`hostnextline/garage2.0-sauvegardes`).
Chaque nuit, vers 3 h 23, GitHub télécharge toutes les données du garage et les range dans `donnees/`
(un fichier par table). L'historique du dépôt garde chaque nuit : on peut revenir au jour qu'on veut.

- **Aucun mot de passe n'est gardé** : GitHub donne à la sauvegarde un ticket signé, valable quelques minutes,
  et le serveur du garage vérifie que le ticket vient bien de ce dépôt-là.
- **Les clés des services** (textos, paiements par carte) ne sont jamais dans les sauvegardes.
- Pas de limite de 1000 lignes : tout est pris, page par page, et compté.
- Lancer une sauvegarde tout de suite : onglet **Actions**, « Sauvegarde du garage », **Run workflow**.

## Remettre des données (après une erreur)

1. Choisir la sauvegarde : dans l'historique du dépôt (« History »), télécharger le dossier `donnees` du bon jour.
2. Écrire le fichier de restauration :
   - ce qui manque seulement (ce qui a été effacé revient, rien de plus récent n'est écrasé) :
     `node restaurer.mjs donnees > restauration.sql`
   - une seule partie : `node restaurer.mjs donnees --tables customers,vehicles > restauration.sql`
   - retour en arrière complet (les données redeviennent comme ce soir-là) :
     `node restaurer.mjs donnees --remplacer > restauration.sql`
3. Faire tourner `restauration.sql` sur la base du garage (éditeur SQL de Supabase, ou `psql`).
   Tout se fait d'un bloc : si une étape échoue, rien n'est changé.

Les numéros de facture ne reculent jamais (aucun numéro donné deux fois).
