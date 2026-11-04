import type { today as fr } from '../fr/today';
export const today: typeof fr = {
  title: 'Today',
  mine: 'My day',
  team: 'The day',
  shift: {
    notStarted: 'Your day has not started',
    notStartedSub: 'The office sees your position only during your day.',
    start: 'Start my day',
    started: 'Day started at {time}',
    worked: '{time} of work',
    end: 'End my day',
    endConfirm: 'Tap again to end',
    ended: 'Day ended at {time}',
    endedSub: '{time} of work today',
    resume: 'Resume my day',
    startedToast: 'Have a good day. Your position is shared with the office.',
    endedToast: 'Day ended. Your position is no longer shared.',
    offline: 'No signal: the day starts and ends with signal. Try again in a moment.',
    help: 'During your day, the phone sends your position to the office, about once a minute, while the app is open. “End my day” stops everything.'
  },
  position: {
    shared: 'Position shared with the office, {ago}',
    starting: 'Looking for your position…',
    deniedTitle: 'Your position is blocked',
    denied: 'The office does not see you on the map and the customer does not see your truck coming.',
    deniedHow: 'To allow it: open the phone’s settings, then the app (or the browser), then Location, and choose “Allow”. Then come back here.',
    unavailable: 'The phone cannot find your position right now (GPS off, or indoors). It comes back by itself.',
    unsupported: 'This phone does not give its position to the app.',
    retry: 'Try again'
  },
  ago: { now: 'just now', min: '{n} min ago', long: '{time} ago' },
  next: {
    title: 'Next stop',
    now: 'Right now',
    open: 'Open the job',
    allDone: 'No more stops today',
    allDoneText: 'Your jobs of the day are done. End your day when you get back.',
    empty: 'No appointment today',
    emptyText: 'Nothing on your truck’s schedule today.',
    noTruck: 'No truck in your name',
    noTruckText: 'Ask the owner to give you a truck (Team).',
    seeAgenda: 'See the schedule'
  },
  then: 'Then',
  closed: {
    show: { one: 'See the finished stop', other: 'See the {n} finished stops' },
    hide: 'Hide the finished stops'
  },
  summary: {
    title: 'Your day at a glance',
    stops: { one: 'stop', other: 'stops' },
    drive: 'driving',
    work: 'of work',
    help: 'Driving is estimated by the office from the addresses (by car, without traffic).'
  },
  tomorrow: {
    title: 'Tomorrow',
    titleDay: 'Next day: {day}',
    first: 'First stop',
    none: 'Nothing planned in the next few days for now.'
  },
  book: 'Book',
  bookSub: 'A customer on the phone: find them a block',
  agenda: 'Schedule',
  map: 'Map',
  trucks: {
    title: 'The trucks',
    noDriver: 'No driver',
    enRoute: 'On the way to {name}',
    enRouteEta: 'On the way to {name}, arriving around {time}',
    onSite: 'On site at {name}’s',
    onSiteSince: 'On site at {name}’s since {time}',
    waiting: 'Waiting',
    notStarted: 'Day not started',
    finished: 'Day done',
    empty: 'Nothing scheduled today',
    progress: '{done} of {total}',
    progressLabel: '{done} stops done out of {total}',
    next: 'Next: {name} around {time}',
    nextNoTime: 'Next: {name}',
    position: 'Position {ago}',
    noPosition: 'No position shared',
    unplaced: { one: '{n} job without a truck today: place it in the schedule.', other: '{n} jobs without a truck today: place them in the schedule.' },
    none: 'No active truck.',
    noneText: 'Add a truck and its driver in Hours or Team.'
  },
  collect: {
    title: 'To collect',
    help: 'Finished jobs whose invoice is not (fully) paid, for example when the customer will pay later.',
    none: 'Everything is paid.',
    later: 'Will pay later',
    laterReason: 'Will pay later: {reason}',
    invoice: 'Invoice {number}',
    total: 'Total to collect: {amount}'
  },
  proposals: {
    title: 'Proposals waiting',
    help: 'Work proposed on site that the customer has not accepted or declined yet.',
    none: 'No proposal waiting.'
  },
  confirm: {
    title: 'To confirm for tomorrow',
    help: 'Tomorrow’s appointments whose customer did not get the confirmation text (the day, the block and the planned total).',
    none: 'Tomorrow’s appointments are all confirmed.',
    send: 'Send',
    sendLabel: 'Send the confirmation to {name}',
    noPhone: 'No number'
  },
  payments: {
    title: 'Today’s payments',
    none: 'No payment received today yet.',
    total: 'Total of the day',
    totalLine: 'Total of the day: {amount}',
    treasury: 'Open the treasury',
    unknown: 'Payment',
    methods: { cash: 'Cash', debit: 'Debit', credit: 'Credit', interac: 'Interac transfer', card_online: 'Card online', cheque: 'Cheque', other: 'Other' }
  },
  loading: 'Loading the day…'
};
