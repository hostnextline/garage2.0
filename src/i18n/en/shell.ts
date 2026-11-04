import type { shell as fr } from '../fr/shell';
export const shell: typeof fr = {
  nav: {
    today: 'Today', agenda: 'Schedule', customers: 'Customers', invoices: 'Invoices', quotes: 'Estimates', map: 'Map',
    hours: 'Hours', treasury: 'Treasury', inventory: 'Inventory', dashboard: 'Numbers', team: 'Team', settings: 'Settings',
    guide: 'Where to start', account: 'My account', more: 'More'
  },
  groups: { day: 'The day', office: 'The office', garage: 'The garage' },
  book: 'Book',
  quick: {
    title: 'Add',
    book: 'Book an appointment', bookSub: 'Customer, services, block',
    walkIn: 'Walk-in customer', walkInSub: 'The job starts now, here',
    quote: 'Estimate', quoteSub: 'A price on site, no customer file',
    customer: 'New customer', customerSub: 'Just the file',
    expense: 'Expense or receipt', expenseSub: 'Receipt photo, amount, category'
  },
  sync: {
    synced: 'Up to date', sending: 'Sending…', offline: 'Offline',
    pending: { one: '{n} to send', other: '{n} to send' },
    title: 'Sync',
    offlineLead: 'No signal. Everything you do stays on the phone and goes out on its own when the signal comes back.',
    pendingLead: 'These changes are waiting for signal. They go out on their own, in order.',
    lastPull: 'Last update: {when}',
    live: 'Live',
    notLive: 'Updated every 45 seconds',
    sendNow: 'Send now',
    storage: 'This browser keeps nothing on the phone (private browsing?). Without signal, the app won’t work.'
  },
  failed: {
    title: { one: 'A change was refused', other: '{n} changes were refused' },
    lead: 'The server refused them. The record went back to its previous version. Read the reason, fix if needed, then retry or remove.',
    retry: 'Retry',
    dismiss: 'Remove',
    show: 'Show'
  },
  update: { ready: 'A new version of the app is ready.', apply: 'Update', later: 'Later' },
  preview: { banner: 'You are viewing the app as {name}. Nothing can be changed.', stop: 'Back to me' },
  queued: 'Kept on the phone: it goes out as soon as the signal is back.',
  loadFail: 'This page won’t open. The app may have been updated.',
  reload: 'Reload',
  notFound: 'This page doesn’t exist.',
  noRight: 'You don’t have access to this part of the app.',
  home: 'Go to Today',
  skip: 'Skip to content',
  menu: 'Menu',
  splash: 'Opening…',
  offlineBanner: 'Offline: you are working on the phone’s copy.'
};
