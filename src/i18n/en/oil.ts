import type { oil as fr } from '../fr/oil';
export const oil: typeof fr = {
  title: 'Oil reminders',
  help: 'The cars due for an oil change. We call the customer 6 months after their last oil change: the one done with us, or the day they gave (“Last oil change” on the car’s file). If the last visit had no oil change, we call 3 months after that visit. A car that already has an appointment with an oil change leaves the list by itself. The app knows an oil change by its service, by the words of the job (oil, lube, 5W-30…) or by the oil taken from the inventory; if it misses one, open the line and tap “The oil was changed at this visit”.',
  sub: { one: '{n} customer to call', other: '{n} customers to call', zero: 'Nobody to call today' },
  loading: 'Loading the visits',
  tabs: { label: 'Show', call: 'To call', soon: 'Soon', all: 'All' },
  empty: {
    callTitle: 'Nobody to call today', callText: 'The list fills itself: each finished visit adds its car, 6 months or 3 months later.',
    callNext: 'Next: {name}, {when}.',
    soonTitle: 'Nobody in the next 30 days', soonText: 'Look at “All” to see the cars coming up.',
    allTitle: 'No car to follow yet', allText: 'As soon as a job is finished, or a car has its “Last oil change” date, it shows here with the day to call the customer.',
    offline: 'Offline: the list shows what this phone already received.'
  },
  row: {
    noCar: 'Car not noted',
    lastOil: 'Oil changed on {day}',
    lastVisit: 'Last visit on {day}, no oil change',
    lateDays: { zero: 'Due today', one: 'Due since yesterday', other: 'Due for {n} days' },
    lateMonths: { one: 'Due for 1 month', other: 'Due for {n} months' },
    dueOn: 'Due {day}',
    againOn: 'Call back {day}',
    stopped: 'Do not call',
    next: '{when}, no oil change'
  },
  sheet: {
    car: 'Car', phone: 'Phone', noPhone: 'No number on file',
    lastOil: 'Last oil change', never: 'Never with us',
    lastVisit: 'Last visit', due: 'Due', next: 'Next appointment',
    nextHint: 'This appointment has no oil change: offer to add it.',
    said: 'Last call',
    saidAgain: 'Noted {at} by {name}: call back {day}', saidAgainNoName: 'Noted {at}: call back {day}',
    saidStop: 'Noted {at} by {name}: do not call for this car', saidStopNoName: 'Noted {at}: do not call for this car',
    call: 'Call', text: 'Text', book: 'Book', file: 'Customer file',
    after: 'After the call', afterHint: 'The customer did not book? Choose when to call back.',
    in1w: 'Call back in 1 week', in1m: 'Call back in 1 month', in3m: 'Call back in 3 months',
    stop: 'Stop calling for this car', stopConfirm: 'Tap again to stop calling',
    clear: 'Put back in the list',
    missedHint: 'The app saw no oil change at the visit of {day}. If the oil was changed that day, say it here.',
    missedFix: 'The oil was changed at this visit',
    needCar: 'This visit has no car: add the car to the customer’s file to note a call back.'
  },
  toast: { again: 'Noted: call back {day}', stop: 'Noted: we no longer call for this car', clear: 'Back in the list', fixed: 'Noted: next reminder {day}' }
};
