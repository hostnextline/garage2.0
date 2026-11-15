/* « Notes d'appels » : ce qui s'est dit au téléphone, écrit tout seul. */
export const calls = {
  title: 'Appels',
  sub: 'Ce qui s’est dit au téléphone, écrit tout seul après chaque appel.',
  count: { one: '{n} appel noté', other: '{n} appels notés' },
  in: 'Appel reçu', out: 'Appel fait',
  told: 'On lui a dit :', todo: 'À faire :',
  showAll: 'Voir tout ce qui s’est dit', hideAll: 'Cacher', noTranscript: 'Rien d’écrit pour cet appel.',
  file: 'Sa fiche', book: 'Réserver', newCustomer: 'Créer le client',
  unknown: 'Numéro inconnu',
  writing: 'La note s’écrit… elle arrive dans une minute ou deux.',
  failed: 'Note pas écrite', redo: 'Réessayer',
  short: 'Appel trop court pour une note.', noRecording: 'Pas d’enregistrement pour cet appel.',
  sync: 'Chercher les appels', syncing: 'Je cherche…',
  synced: '{n} notes écrites, {m} en attente.',
  noKey: 'La clé OpenAI manque : mets-la dans Réglages, Branchements.',
  tabs: { all: 'Tous les appels', todo: 'À faire' },
  empty: 'Aucun appel noté pour l’instant', emptyTodo: 'Rien à faire : tout est réglé.',
  emptyText: 'Après un appel sur le numéro du garage, sa note arrive ici toute seule. Il faut la clé OpenAI et l’enregistrement des appels activé dans GoHighLevel.',
  toSettings: 'Ouvrir les branchements'
};
