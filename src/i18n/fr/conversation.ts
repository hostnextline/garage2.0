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
  file: { photo: 'Photo', openPhoto: 'Ouvrir la photo en grand', video: 'Vidéo', audio: 'Message vocal', doc: 'Document', open: 'Ouvrir' },
  bubble: {
    title: 'Conversation avec {name}',
    open: 'Ouvrir la conversation avec {name}',
    unread: { one: '{n} nouveau texto', other: '{n} nouveaux textos' },
    min: 'Réduire',
    close: 'Fermer la conversation',
    file: 'Sa fiche',
    book: 'Réserver pour ce numéro',
    noFile: 'Pas encore de fiche',
    noWords: '📎 Photo ou document',
    off: 'Les textos ne sont pas branchés (Réglages, Branchements) : tu vois ce qui est arrivé, sans pouvoir répondre d’ici.',
    error: 'Le service de textos n’a pas répondu : voici ce qui est arrivé. La suite revient dans un instant.'
  },
  status: {
    ok: '',
    off: 'Les textos automatiques ne sont pas branchés (Réglages, Branchements).',
    no_phone: 'Ce client n’a pas de numéro de cellulaire.',
    error: 'Le service de textos n’a pas répondu. Réessaie dans un instant.',
    offline: 'Pas de réseau : la conversation reviendra avec le réseau.'
  }
};
