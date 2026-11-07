/* Carte */
export const map = {
  title: 'Carte',
  help: 'La journée de l’équipe : le départ des camions, chaque camion dans sa couleur avec ses arrêts numérotés dans l’ordre de sa route, et où sont les mécanos en ce moment.',
  label: 'Carte de l’équipe',
  days: { yesterday: 'Hier', today: 'Aujourd’hui', tomorrow: 'Demain' },
  dayLabel: 'Jour affiché',
  updated: 'Mis à jour à {time}',
  updating: 'Mise à jour…',
  refresh: 'Mettre à jour maintenant',
  recenter: 'Voir toute l’équipe',
  offline: 'Pas de réseau : la carte montre la mise à jour de {time}. Elle se remet à jour toute seule quand le réseau revient.',
  offlineDevice: 'Pas de réseau : la carte montre ce que le téléphone connaît. Les positions en direct reviennent avec le réseau.',
  device: 'En attendant le serveur, la carte montre ce que le téléphone connaît.',
  offlineShort: 'Hors ligne : mise à jour de {time}',
  offlineDeviceShort: 'Hors ligne : ce que le téléphone connaît',
  refused: 'La carte ne peut pas se mettre à jour.',
  trucksCount: { zero: 'Aucun camion', one: '{n} camion', other: '{n} camions' },
  stopsCount: { zero: 'aucun arrêt', one: '{n} arrêt', other: '{n} arrêts' },
  summary: '{trucks}, {stops}',
  legend: {
    title: 'Les camions',
    help: 'Touche un camion pour voir seulement sa route sur la carte. Touche-le encore pour revoir toute l’équipe.',
    progress: { zero: 'aucun arrêt fait sur {total}', one: '{n} arrêt fait sur {total}', other: '{n} arrêts faits sur {total}' },
    noStops: 'aucun arrêt ce jour-là',
    withDriver: '{driver}, {progress}',
    road: '{km} km de route, {time}',
    next: 'prochain arrêt',
    dayDone: 'Journée finie',
    unplaced: 'À placer',
    unplacedSub: { one: '{n} rendez-vous sans camion', other: '{n} rendez-vous sans camion' },
    focusOn: 'Voir seulement {name}',
    focusOff: 'Revoir toute l’équipe',
    start: 'Départ des camions',
    change: 'Changer',
    ownStart: 'Départ de {name}',
    leaves: 'Part de : {place}',
    changeStart: 'Changer l’adresse de départ des camions'
  },
  lost: {
    text: { one: '{n} rendez-vous pas encore sur la carte (adresse sans position)', other: '{n} rendez-vous pas encore sur la carte (adresses sans position)' },
    find: 'Trouver',
    found: { one: 'Position trouvée : le rendez-vous est sur la carte.', other: '{n} positions trouvées : les rendez-vous sont sur la carte.' },
    none: 'Adresse pas trouvée sur la carte. Corrige-la dans la fiche du client.',
    offline: 'Pas de réseau pour chercher l’adresse. Réessaie plus tard.'
  },
  stops: {
    title: 'Arrêts de {name}',
    all: 'Tous les arrêts',
    when: '{block}, vers {time}',
    noPos: 'Adresse pas placée sur la carte'
  },
  stop: {
    number: 'Arrêt {n}',
    open: 'Ouvrir la job',
    directions: 'Itinéraire',
    close: 'Fermer',
    eta: 'Arrivée prévue vers {time}',
    etaKm: 'Arrivée prévue vers {time}, {km} km',
    noAddress: 'Pas d’adresse',
    unplaced: 'Pas encore placé sur un camion'
  },
  people: {
    title: 'Sur la route',
    stale: 'Dernière position {ago}'
  },
  ago: { now: 'à l’instant', min: 'il y a {n} min', hours: 'il y a {n} h', yesterday: 'hier', on: 'le {date}' },
  tripLabel: 'Arrivée vers {time}',
  empty: {
    title: 'Aucun rendez-vous ce jour-là',
    text: 'Les arrêts des camions apparaissent ici dès qu’un rendez-vous est réservé.',
    book: 'Réserver'
  },
  noHome: 'Le départ des camions n’a pas encore de place sur la carte. Ajoute son adresse dans Réglages, Réservations.',
  noHomeAction: 'Ouvrir les réglages',
  pull: { open: 'Voir la liste', close: 'Cacher la liste' }
};
