import type { coffre as fr } from '../fr/coffre';
export const coffre: typeof fr = {
  title: 'Coffre',
  help: 'Jobs done for family and friends: no invoice, no taxes, not in the revenue. What they gave is written here, apart. The accountant exports this report separately.',
  apart: 'Apart from the revenue and the taxes: these jobs have no invoice. The accountant exports this report separately.',
  totals: 'For the period',
  count: 'Entries',
  given: 'Received',
  worth: 'Value of the work (before taxes)',
  worthShort: 'value {value}',
  spent: 'Spent (stock bought)',
  balance: 'In the Coffre now',
  stock: 'Coffre’s stock (value, no taxes)',
  stockLink: 'See the Coffre’s stock',
  purchase: 'Bought: {what}',
  list: 'The entries',
  jobs: 'Jobs {n}',
  empty: 'Nothing in the Coffre for this period',
  emptyText: 'On a family or friends job: menu ⋯, then “Paid by the Coffre”.',
  remove: 'Take out',
  removeConfirm: 'Tap again to take it out',
  removed: 'Taken out of the Coffre: these jobs can have an invoice again',
  open: 'Coffre (family and friends)',
  openSub: 'The separate report, for the accountant',
  job: {
    banner: 'Paid by the Coffre (family and friends): no invoice, no taxes.',
    menu: 'Paid by the Coffre',
    menuSub: 'Family and friends: no invoice, no taxes',
    finish: 'Finish the job'
  },
  pay: { method: 'Coffre' },
  sheet: {
    title: 'Paid by the Coffre',
    lead: 'Family and friends: check the jobs they pay this way. They will have no invoice and no taxes, and go in the Coffre, apart from the revenue.',
    jobs: 'The jobs',
    jobLine: 'Job {n}, {day}',
    jobValue: 'Value of the work: {value}',
    noJob: 'No job of this customer can go in the Coffre (a job already paid keeps its invoice).',
    amount: 'Amount received',
    amountHint: 'What they gave ($0 if nothing). Value of the checked work: {value}.',
    day: 'Received on',
    note: 'Note',
    what: 'These jobs have no invoice and no taxes. The accountant sees them apart, in the Coffre report.',
    save: 'Put in the Coffre',
    pickOne: 'Check at least one job.',
    amountNeeded: 'Type the amount received ($0 if nothing).',
    done: { one: 'In the Coffre: 1 job, no invoice or taxes', other: 'In the Coffre: {n} jobs, no invoice or taxes' }
  },
  export: {
    xlsx: 'Coffre report (Excel)', csv: 'Coffre report (CSV)', file: 'coffre-report', sheet: 'Coffre', title: 'Coffre report (family and friends)',
    period: 'Period:', day: 'Date', customer: 'Customer', jobs: 'Jobs', work: 'Work', value: 'Value of the work (before taxes)', amount: 'Amount received',
    note: 'Note', by: 'Written by', total: 'Total'
  }
};
