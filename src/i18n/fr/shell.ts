/* Le cadre de l'app : menu, barre du bas, état de la synchro, bandeaux. */
export const shell = {
  nav: {
    today: 'Aujourd’hui', agenda: 'Agenda', customers: 'Clients', invoices: 'Factures', quotes: 'Estimations', map: 'Carte',
    hours: 'Horaires', treasury: 'Trésorerie', inventory: 'Inventaire', dashboard: 'Chiffres', team: 'Équipe', settings: 'Réglages',
    guide: 'Par où commencer', account: 'Mon compte', more: 'Plus'
  },
  groups: { day: 'La journée', office: 'Le bureau', garage: 'Le garage' },
  book: 'Réserver',
  quick: {
    title: 'Ajouter',
    book: 'Réserver un rendez-vous', bookSub: 'Le client, les services, le bloc',
    walkIn: 'Client sans rendez-vous', walkInSub: 'La job commence maintenant, ici',
    quote: 'Estimation', quoteSub: 'Un prix sur place, sans fiche client',
    customer: 'Nouveau client', customerSub: 'Seulement la fiche',
    expense: 'Dépense ou reçu', expenseSub: 'Photo du reçu, montant, catégorie'
  },
  sync: {
    synced: 'Tout est envoyé', sending: 'Envoi…', offline: 'Hors ligne',
    pending: { one: '{n} à envoyer', other: '{n} à envoyer' },
    title: 'Synchronisation',
    offlineLead: 'Pas de réseau. Tout ce que tu fais reste sur le téléphone et part tout seul quand le réseau revient.',
    pendingLead: 'Ces changements attendent le réseau. Ils partent tout seuls dans l’ordre.',
    lastPull: 'Dernière mise à jour : {when}',
    live: 'En direct',
    notLive: 'Mise à jour toutes les 45 secondes',
    sendNow: 'Envoyer maintenant',
    storage: 'Ce navigateur ne garde rien sur le téléphone (navigation privée ?). Sans réseau, l’app ne marchera pas.'
  },
  failed: {
    title: { one: 'Un changement a été refusé', other: '{n} changements ont été refusés' },
    lead: 'Le serveur les a refusés. La fiche est revenue à sa version d’avant. Lis la raison, corrige si besoin, puis réessaie ou retire.',
    retry: 'Réessayer',
    dismiss: 'Retirer',
    show: 'Voir'
  },
  update: {
    title: 'Mise à jour de l’app', help: 'L’app se met à jour toute seule la prochaine fois qu’elle s’ouvre. Ici, tu peux vérifier tout de suite et l’installer sans attendre.',
    mine: 'Version sur cet appareil', devVersion: 'version de test',
    check: 'Vérifier les mises à jour', checking: 'Vérification…',
    none: 'L’app est à jour.', offline: 'Pas de réseau : réessaie quand le signal revient.', error: 'La vérification n’a pas marché. Réessaie dans un moment.',
    ready: 'Une nouvelle version de l’app est prête.', important: 'Mise à jour importante de l’app : installe-la dès que tu peux.',
    notes: 'Ce qui change : {notes}', apply: 'Mettre à jour maintenant', later: 'Plus tard'
  },
  preview: { banner: 'Tu vois l’app comme {name}. Rien ne peut être changé.', stop: 'Revenir à moi' },
  queued: 'Gardé sur le téléphone : ça part dès que le réseau revient.',
  loadFail: 'Cette page ne s’ouvre pas. L’app a peut-être été mise à jour.',
  reload: 'Recharger',
  notFound: 'Cette page n’existe pas.',
  noRight: 'Tu n’as pas accès à cette partie de l’app.',
  home: 'Aller à Aujourd’hui',
  skip: 'Aller au contenu',
  menu: 'Menu',
  splash: 'Ouverture…',
  offlineBanner: 'Hors ligne : tu travailles sur la copie du téléphone.'
};
