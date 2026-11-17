/* Le cadre de l'app : menu, barre du bas, état de la synchro, bandeaux. */
export const shell = {
  nav: {
    today: 'Aujourd’hui', agenda: 'Agenda', customers: 'Clients', invoices: 'Factures', quotes: 'Estimations', map: 'Carte', overview: 'Vue d’ensemble',
    hours: 'Horaires', treasury: 'Trésorerie', inventory: 'Inventaire', dashboard: 'Chiffres', team: 'Équipe', settings: 'Réglages',
    oil: 'Rappels d’huile', guide: 'Par où commencer', info: 'Info', account: 'Mon compte', more: 'Plus'
  },
  groups: { day: 'La journée', office: 'Le bureau', garage: 'Le garage' },
  more: {
    today: 'Aujourd’hui', booked: 'Réservées', live: 'En cours', done: 'Terminées', due: 'À recevoir',
    filters: 'Afficher', groups: { all: 'Tout', day: 'Journée', office: 'Bureau', garage: 'Garage' },
    help: 'Aide et premiers pas',
    setup: 'Démarrage : {done} sur {total}', setupNext: 'Prochaine étape : {step}',
    badges: {
      today: { one: '{n} job à faire aujourd’hui', other: '{n} jobs à faire aujourd’hui' },
      invoices: { one: '{n} facture à encaisser', other: '{n} factures à encaisser' },
      inventory: { one: '{n} pièce à commander', other: '{n} pièces à commander' },
      oil: { one: '{n} client à appeler pour son huile', other: '{n} clients à appeler pour leur huile' }
    }
  },
  book: 'Réserver',
  quick: {
    title: 'Ajouter',
    call: 'Appel entrant', callSub: 'Le numéro trouve le client ; sinon, on commence par l’adresse, la voiture ou la job',
    book: 'Réserver un rendez-vous', bookSub: 'Le client, les services, le bloc', bookSubWin: 'Le client, les services, la plage d’arrivée',
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
    show: 'Voir',
    line: '{label} : {error}',
    chip: { one: '1 refusé', other: '{n} refusés' }
  },
  session: {
    lost: { one: 'Reconnecte-toi : 1 changement attend', other: 'Reconnecte-toi : {n} changements attendent' },
    lostNone: 'Reconnecte-toi pour continuer',
    lead: 'Ta connexion a expiré. Rien n’est perdu : tes changements partent dès que tu es reconnecté.',
    signIn: 'Me reconnecter'
  },
  storageLost: 'Ce téléphone ne peut pas garder tes changements : reste en ligne',
  stuck: { one: 'Un changement attend que le serveur réponde. Il est gardé et repart tout seul.', other: '{n} changements attendent que le serveur réponde. Ils sont gardés et repartent tout seuls.' },
  crash: {
    title: 'Quelque chose n’a pas marché',
    text: 'Rien n’est perdu : tes changements sont gardés sur le téléphone.'
  },
  update: {
    title: 'Mise à jour de l’app', help: 'L’app se met à jour toute seule la prochaine fois qu’elle s’ouvre. Ici, tu peux vérifier tout de suite et l’installer sans attendre.',
    mine: 'Version sur cet appareil', devVersion: 'version de test',
    check: 'Vérifier les mises à jour', checking: 'Vérification…',
    none: 'L’app est à jour.', offline: 'Pas de réseau : réessaie quand le signal revient.', error: 'La vérification n’a pas marché. Réessaie dans un moment.',
    ready: 'Une nouvelle version de l’app est prête.', important: 'Mise à jour importante de l’app : installe-la dès que tu peux.',
    notes: 'Ce qui change : {notes}', apply: 'Mettre à jour maintenant',
    downloading: 'Une nouvelle version se télécharge. Elle sera prête dans un moment.',
    installed: 'Une nouvelle version de l’app est installée. Recharge pour l’utiliser.',
    tooOld: 'Mets l’app à jour',
    tooOldLead: 'Cette version de l’app est trop vieille pour continuer. Tes changements sont gardés : ils partiront avec la nouvelle version.'
  },
  moved: {
    title: 'L’app a une nouvelle adresse : {host}',
    lead: 'Ouvre-la, connecte-toi, puis ajoute-la à l’écran d’accueil. Celle-ci marche encore, mais les liens envoyés aux clients partent maintenant de la nouvelle.',
    open: 'Ouvrir la nouvelle adresse', hide: 'Cacher'
  },
  preview: { banner: 'Tu vois l’app comme {name}. Rien ne peut être changé.', stop: 'Revenir à moi' },
  queued: 'Gardé sur le téléphone : ça part dès que le réseau revient.',
  loadFail: 'Cette page ne s’ouvre pas. L’app a peut-être été mise à jour.',
  // a page whose code is not on the phone yet, asked with no signal
  loadOffline: 'Pas de réseau : cette page s’ouvrira quand le signal reviendra.',
  loadBack: 'Le signal est revenu : touche « Réessayer » pour ouvrir cette page.',
  reload: 'Recharger',
  notFound: 'Cette page n’existe pas.',
  noRight: 'Tu n’as pas accès à cette partie de l’app.',
  home: 'Aller à Aujourd’hui',
  skip: 'Aller au contenu',
  menu: 'Menu',
  splash: 'Ouverture…',
  /* the words of the design kit (status pills, the stamp, the totals) */
  kit: {
    job: { booked: 'Réservé', en_route: 'En route', on_site: 'Sur place', done: 'Terminé', cancelled: 'Annulé', no_show: 'Client absent' },
    invoice: { draft: 'Brouillon', issued: 'À payer', partial: 'Payée en partie', paid: 'Payée', void: 'Annulée' },
    stamp: { paid: 'Payé', cancelled: 'Annulé', no_show: 'Absent' },
    paid: 'Payé', balance: 'Reste à payer'
  }
};
