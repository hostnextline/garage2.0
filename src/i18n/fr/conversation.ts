/* La conversation avec un client (textos dans les deux sens, par le numéro du garage). */
export const conversation = {
  title: 'Conversation',
  open: 'Conversation',
  from: 'Par le numéro du garage (GoHighLevel)',
  refresh: 'Rafraîchir',
  empty: 'Pas encore de textos avec ce client.',
  placeholder: 'Écris ta réponse…',
  send: 'Envoyer',
  sent: 'Texto envoyé du numéro du garage',
  them: 'Client',
  us: 'Garage',
  smsOff: 'Ce client ne veut pas de textos.',
  status: {
    ok: '',
    off: 'Les textos automatiques ne sont pas branchés (Réglages, Branchements).',
    no_phone: 'Ce client n’a pas de numéro de cellulaire.',
    error: 'Le service de textos n’a pas répondu. Réessaie dans un instant.',
    offline: 'Pas de réseau : la conversation reviendra avec le réseau.'
  }
};
