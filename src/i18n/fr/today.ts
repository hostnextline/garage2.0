/* Aujourd’hui : « Ma journée » (le mécano), « La journée » (le propriétaire et le bureau), les paiements du jour (trésorier). */
export const today = {
  title: 'Aujourd’hui',
  mine: 'Ma journée',
  team: 'La journée',
  /* the mechanic's day */
  shift: {
    notStarted: 'Ta journée n’est pas commencée',
    notStartedSub: 'Le bureau voit ta position seulement pendant ta journée.',
    start: 'Commencer ma journée',
    started: 'Journée commencée à {time}',
    worked: '{time} de travail',
    end: 'Terminer ma journée',
    endConfirm: 'Toucher encore pour terminer',
    ended: 'Journée terminée à {time}',
    endedSub: '{time} de travail aujourd’hui',
    resume: 'Reprendre ma journée',
    startedToast: 'Bonne journée. Ta position est partagée avec le bureau.',
    endedToast: 'Journée terminée. Ta position n’est plus partagée.',
    offline: 'Pas de réseau : la journée se commence et se termine avec du réseau. Réessaie dans un instant.',
    help: 'Pendant ta journée, le téléphone envoie ta position au bureau, environ une fois par minute, quand l’app est ouverte. « Terminer ma journée » arrête tout.'
  },
  position: {
    shared: 'Position partagée avec le bureau, {ago}',
    starting: 'Recherche de ta position…',
    deniedTitle: 'Ta position est bloquée',
    denied: 'Le bureau ne te voit pas sur la carte et le client ne voit pas ton camion arriver.',
    deniedHow: 'Pour la permettre : ouvre les réglages du téléphone, puis l’app (ou le navigateur), puis Position, et choisis « Autoriser ». Reviens ensuite ici.',
    unavailable: 'Le téléphone ne trouve pas ta position en ce moment (GPS éteint, ou à l’intérieur). Ça reprend tout seul.',
    unsupported: 'Ce téléphone ne donne pas sa position à l’app.',
    retry: 'Réessayer'
  },
  ago: { now: 'à l’instant', min: 'il y a {n} min', long: 'il y a {time}' },
  /* the next stop */
  route: { label: 'La route que je fais', all: 'Les deux', car: 'Voiture', truck: 'Camion' },
  next: {
    title: 'Prochain arrêt',
    now: 'En ce moment',
    open: 'Ouvrir la job',
    allDone: 'Plus d’arrêt aujourd’hui',
    allDoneText: 'Tes jobs du jour sont faites. Termine ta journée en rentrant.',
    empty: 'Aucun rendez-vous aujourd’hui',
    emptyText: 'Rien à l’agenda de ton camion aujourd’hui.',
    noTruck: 'Aucun camion à ton nom',
    noTruckText: 'Demande au propriétaire de t’attribuer un camion (Équipe).',
    seeAgenda: 'Voir l’agenda'
  },
  return: {
    next: 'Tes jobs du jour sont faites. Prochaine destination : {place}',
    leave: 'Je pars vers {place}',
    leaveSub: 'Le garage reçoit ton heure d’arrivée et la carte en direct.',
    leaveSubManual: 'Les textos automatiques ne sont pas branchés : l’app te montre le message à envoyer.',
    onWay: 'En route vers {place}',
    eta: 'Arrivée prévue vers {time}',
    noEta: 'Heure d’arrivée pas encore calculée (position du téléphone inconnue).',
    arrived: 'Je suis arrivé',
    arrivedSub: 'Le suivi s’arrête. Termine ta journée quand tu veux.',
    arrivedToast: 'Bien arrivé. Bonne fin de journée.',
    sent: 'Le garage a reçu ton heure d’arrivée.',
    sentEta: 'Le garage a reçu ton heure d’arrivée ({time}).',
    quiet: 'En route vers {place} (texto de retour éteint).',
    noPhone: 'Aucun numéro de retour dans Réglages, Réservations : le garage n’a pas été texté.',
    noHome: 'Le départ des camions n’a pas de position sur la carte. Demande au bureau de la choisir dans Réglages, Réservations.',
    offline: 'Pas de signal : réessaie dans un instant.'
  },
  then: 'Ensuite',
  closed: {
    show: { one: 'Voir l’arrêt terminé', other: 'Voir les {n} arrêts terminés' },
    hide: 'Cacher les arrêts terminés'
  },
  summary: {
    title: 'Ta journée en bref',
    stops: { one: 'arrêt', other: 'arrêts' },
    drive: 'de route',
    work: 'de travail',
    help: 'La route est estimée par le bureau à partir des adresses (en voiture, sans le trafic).'
  },
  tomorrow: {
    title: 'Demain',
    titleDay: 'Prochain jour : {day}',
    first: 'Premier arrêt',
    none: 'Rien de prévu dans les prochains jours pour l’instant.'
  },
  /* the office */
  book: 'Réserver',
  bookSub: 'Un client au téléphone : trouve-lui un bloc',
  agenda: 'Agenda',
  map: 'Carte',
  trucks: {
    title: 'Les camions',
    noDriver: 'Sans chauffeur',
    enRoute: 'En route vers {name}',
    enRouteEta: 'En route vers {name}, arrivée vers {time}',
    onSite: 'Sur place chez {name}',
    onSiteSince: 'Sur place chez {name} depuis {time}',
    waiting: 'En attente',
    notStarted: 'Journée pas commencée',
    finished: 'Journée finie',
    empty: 'Rien à l’agenda aujourd’hui',
    progress: '{done} sur {total}',
    progressLabel: '{done} arrêts faits sur {total}',
    next: 'Prochain : {name} vers {time}',
    nextNoTime: 'Prochain : {name}',
    position: 'Position {ago}',
    noPosition: 'Pas de position partagée',
    unplaced: { one: '{n} job sans camion aujourd’hui : place-la dans l’agenda.', other: '{n} jobs sans camion aujourd’hui : place-les dans l’agenda.' },
    none: 'Aucun camion actif.',
    noneText: 'Ajoute un camion et son chauffeur dans Horaires ou Équipe.'
  },
  collect: {
    title: 'À encaisser',
    help: 'Les jobs terminées dont la facture n’est pas (ou pas toute) payée, par exemple quand le client paiera plus tard.',
    none: 'Tout est payé.',
    later: 'Paiera plus tard',
    laterReason: 'Paiera plus tard : {reason}',
    invoice: 'Facture {number}',
    total: 'Total à encaisser : {amount}'
  },
  proposals: {
    title: 'Propositions en attente',
    help: 'Le travail proposé sur place que le client n’a pas encore accepté ou refusé.',
    none: 'Aucune proposition en attente.'
  },
  confirm: {
    title: 'À confirmer pour demain',
    help: 'Les rendez-vous de demain dont le client n’a pas reçu le texto de confirmation (le jour, le bloc et le total prévu).',
    none: 'Les rendez-vous de demain sont tous confirmés.',
    send: 'Envoyer',
    sendLabel: 'Envoyer la confirmation à {name}',
    noPhone: 'Pas de numéro'
  },
  /* the treasurer */
  payments: {
    title: 'Paiements d’aujourd’hui',
    none: 'Aucun paiement reçu aujourd’hui pour l’instant.',
    totalLine: 'Total du jour : {amount}',
    treasury: 'Ouvrir la trésorerie',
    unknown: 'Paiement',
    methods: { cash: 'Comptant', debit: 'Débit', credit: 'Crédit', interac: 'Virement Interac', card_online: 'Carte en ligne', cheque: 'Chèque', other: 'Autre' }
  }
};
