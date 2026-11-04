import type { map as fr } from '../fr/map';
export const map: typeof fr = {
  title: 'Map',
  help: 'The team’s day: the Centrale, each truck in its colour with its stops numbered in the order of its route, and where the mechanics are right now.',
  label: 'Team map',
  days: { yesterday: 'Yesterday', today: 'Today', tomorrow: 'Tomorrow' },
  dayLabel: 'Day shown',
  updated: 'Updated at {time}',
  updating: 'Updating…',
  refresh: 'Update now',
  recenter: 'See the whole team',
  offline: 'No connection: the map shows the update of {time}. It updates by itself when the connection comes back.',
  offlineDevice: 'No connection: the map shows what this phone knows. Live positions come back with the connection.',
  device: 'While the server answers, the map shows what this phone knows.',
  offlineShort: 'Offline: update of {time}',
  offlineDeviceShort: 'Offline: what this phone knows',
  refused: 'The map can’t update.',
  trucksCount: { zero: 'No truck', one: '{n} truck', other: '{n} trucks' },
  stopsCount: { zero: 'no stop', one: '{n} stop', other: '{n} stops' },
  summary: '{trucks}, {stops}',
  legend: {
    title: 'The trucks',
    help: 'Tap a truck to see only its route on the map. Tap it again to see the whole team.',
    progress: { zero: 'none of {total} stops done', one: '{n} of {total} stops done', other: '{n} of {total} stops done' },
    noStops: 'no stop that day',
    withDriver: '{driver}, {progress}',
    road: '{km} km by road, {time}',
    next: 'next stop',
    dayDone: 'Day done',
    unplaced: 'To place',
    unplacedSub: { one: '{n} appointment without a truck', other: '{n} appointments without a truck' },
    focusOn: 'See only {name}',
    focusOff: 'See the whole team again'
  },
  stops: {
    title: 'Stops of {name}',
    all: 'All stops',
    when: '{block}, around {time}',
    noPos: 'Address not placed on the map'
  },
  stop: {
    number: 'Stop {n}',
    open: 'Open the job',
    directions: 'Directions',
    close: 'Close',
    eta: 'Expected around {time}',
    etaKm: 'Expected around {time}, {km} km',
    noAddress: 'No address',
    unplaced: 'Not placed on a truck yet'
  },
  people: {
    title: 'On the road',
    stale: 'Last position {ago}'
  },
  ago: { now: 'just now', min: '{n} min ago', hours: '{n} h ago', yesterday: 'yesterday', on: 'on {date}' },
  tripLabel: 'Arriving around {time}',
  empty: {
    title: 'No appointment that day',
    text: 'The trucks’ stops show here as soon as an appointment is booked.',
    book: 'Book'
  },
  noHome: 'The Centrale has no place on the map yet. Add its address in Settings, Bookings.',
  noHomeAction: 'Open settings',
  pull: { open: 'See the list', close: 'Hide the list' }
};
