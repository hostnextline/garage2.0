import type { log as fr } from '../fr/log';
export const log: typeof fr = {
  customer: 'Customer file',
  vehicle: 'Vehicle',
  booking: 'Booking',
  move: 'Moving an appointment',
  job: 'Change to a job',
  walkIn: 'Walk-in customer',
  invoice: 'Invoice',
  invoiceFinish: 'Invoice finished',
  payment: 'Payment',
  hours: 'Truck hours',
  truckStart: 'Where a truck leaves from',
  settings: 'Settings',
  expense: 'Expense',
  change: 'Change',
  step: { leave: 'I’m leaving', arrive: 'I’ve arrived', finish: 'Job finished', cancel: 'Cancellation', no_show: 'Customer absent', reopen: 'Job reopened', back: 'Step undone', waiver: 'Authorization signed' }
};
