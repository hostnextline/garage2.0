import type { agenda as fr } from '../fr/agenda';
export const agenda: typeof fr = {
  title: 'Schedule',
  titleMine: 'My schedule',
  help: 'Appointments by block (morning, afternoon, evening) and by truck. The bar shows the time taken by the jobs and the driving; the rest is free.\nOn a computer, drag a booked job to another block to move it.',
  helpMine: 'Your jobs by block, in the order of the stops. The bar shows the time taken by the jobs and the driving; the rest is free.',
  day: {
    prev: 'Previous day',
    next: 'Next day',
    today: 'Today',
    pick: 'Pick a date',
    count: { zero: 'No jobs', one: '{n} job', other: '{n} jobs' },
    trucks: { zero: 'no truck working', one: '{n} truck working', other: '{n} trucks working' },
    summary: '{jobs}, {trucks}',
    nobody: 'Nobody works that day',
    nobodyText: 'No truck has hours that day. Change the hours to open blocks.',
    hours: 'Change the hours',
    strip: 'Days of the week'
  },
  week: {
    title: 'Week of {from} to {to}',
    prev: 'Previous week',
    next: 'Next week',
    thisWeek: 'This week',
    view: 'View',
    dayView: 'Day',
    weekView: 'Week',
    openDay: 'Open {day}',
    dragHint: 'Drag a booked job to another block to move it, or open it and tap “Move”.',
    book: 'Book: {when}',
    drop: 'Drop here',
    jobs: { zero: 'no jobs', one: '{n} job', other: '{n} jobs' }
  },
  block: {
    title: '{block}, {hours}',
    closed: 'Closed',
    closedText: 'No truck works in this block.',
    started: 'Started',
    past: 'Past',
    book: 'Book in this block',
    empty: 'No jobs in this block.'
  },
  lane: {
    free: '{d} free',
    full: 'Full',
    over: 'Full, {d} too much',
    closed: 'Not working',
    offShift: 'No longer works in this block',
    meter: '{used} taken out of {cap}',
    unplaced: 'To place',
    unplacedText: 'Fits on no truck. Move the job or change the hours.',
    stop: 'Stop {n}'
  },
  off: 'Cancelled and no-shows ({n})',
  offline: 'Offline: you see the copy on this phone. Other people’s changes will arrive with the network.',
  loading: 'Loading the schedule…',
  move: {
    question: 'Move {name}’s job from {from} to {to}?',
    someone: 'this customer',
    text: 'The app picks the truck and the order of the stops again.',
    textSms: 'A text will let {name} know about the change.',
    ok: 'Move',
    done: 'Job moved',
    started: 'This block has already started: pick a block to come.',
    closed: 'This block is closed: no truck works.',
    notBooked: 'Only a booked job that has not left yet can be moved.'
  }
};
