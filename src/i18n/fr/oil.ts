/* « Rappels d’huile » : les autos dues pour un changement d’huile, à appeler. */
export const oil = {
  title: 'Rappels d’huile',
  help: 'Les autos dues pour un changement d’huile. On appelle le client 6 mois après son dernier changement d’huile : celui fait chez nous, ou la date qu’il a donnée (« Dernier changement d’huile » sur la fiche de l’auto). Si la dernière visite n’avait pas de changement d’huile, on l’appelle 3 mois après cette visite. Une auto qui a déjà un rendez-vous avec un changement d’huile sort de la liste toute seule.',
  sub: { one: '{n} client à appeler', other: '{n} clients à appeler', zero: 'Personne à appeler aujourd’hui' },
  loading: 'Chargement des visites',
  tabs: { label: 'Afficher', call: 'À appeler', soon: 'Bientôt', all: 'Tous' },
  empty: {
    callTitle: 'Personne à appeler aujourd’hui', callText: 'La liste se remplit toute seule : chaque visite terminée y ajoute son auto, 6 mois ou 3 mois plus tard.',
    callNext: 'Le prochain : {name}, {when}.',
    soonTitle: 'Personne dans les 30 prochains jours', soonText: 'Regarde « Tous » pour voir les autos qui s’en viennent.',
    allTitle: 'Aucune auto à suivre pour le moment', allText: 'Dès qu’une job est terminée, ou qu’une auto a sa date de « Dernier changement d’huile », elle apparaît ici avec la date où appeler le client.',
    offline: 'Hors ligne : la liste montre ce que ce téléphone a déjà reçu.'
  },
  row: {
    noCar: 'Auto pas notée',
    lastOil: 'Huile changée le {day}',
    lastVisit: 'Dernière visite le {day}, sans changement d’huile',
    lateDays: { zero: 'Dû aujourd’hui', one: 'Dû depuis hier', other: 'Dû depuis {n} jours' },
    lateMonths: { one: 'Dû depuis 1 mois', other: 'Dû depuis {n} mois' },
    dueOn: 'Dû le {day}',
    againOn: 'Rappeler le {day}',
    stopped: 'Ne plus appeler',
    next: '{when}, sans changement d’huile'
  },
  sheet: {
    car: 'Auto', phone: 'Téléphone', noPhone: 'Pas de numéro au dossier',
    lastOil: 'Dernier changement d’huile', never: 'Jamais chez nous',
    lastVisit: 'Dernière visite', due: 'Dû le', next: 'Prochain rendez-vous',
    nextHint: 'Ce rendez-vous n’a pas de changement d’huile : propose de l’ajouter.',
    said: 'Dernier appel',
    saidAgain: 'Noté le {at} par {name} : rappeler le {day}', saidAgainNoName: 'Noté le {at} : rappeler le {day}',
    saidStop: 'Noté le {at} par {name} : ne plus appeler pour cette auto', saidStopNoName: 'Noté le {at} : ne plus appeler pour cette auto',
    call: 'Appeler', text: 'Texter', book: 'Réserver', file: 'Fiche du client',
    after: 'Après l’appel', afterHint: 'Le client n’a pas réservé ? Choisis quand le rappeler.',
    in1w: 'Rappeler dans 1 semaine', in1m: 'Rappeler dans 1 mois', in3m: 'Rappeler dans 3 mois',
    stop: 'Ne plus appeler pour cette auto', stopConfirm: 'Toucher encore pour ne plus l’appeler',
    clear: 'Remettre dans la liste',
    needCar: 'Cette visite n’a pas d’auto : ajoute l’auto à la fiche du client pour noter un rappel.'
  },
  toast: { again: 'Noté : rappeler le {day}', stop: 'Noté : on ne l’appelle plus pour cette auto', clear: 'Remis dans la liste' }
};
