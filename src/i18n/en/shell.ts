import type { shell as fr } from '../fr/shell';
export const shell: typeof fr = {
  nav: {
    today: 'Today', agenda: 'Schedule', customers: 'Customers', invoices: 'Invoices', quotes: 'Estimates', map: 'Map', overview: 'Overview',
    hours: 'Hours', treasury: 'Treasury', inventory: 'Inventory', dashboard: 'Numbers', team: 'Team', settings: 'Settings',
    guide: 'Where to start', info: 'Info', account: 'My account', more: 'More'
  },
  groups: { day: 'The day', office: 'The office', garage: 'The garage' },
  more: {
    today: 'Today', booked: 'Booked', live: 'Under way', done: 'Done', due: 'To collect',
    filters: 'Show', groups: { all: 'All', day: 'Day', office: 'Office', garage: 'Garage' },
    help: 'Help and first steps',
    setup: 'Getting started: {done} of {total}', setupNext: 'Next step: {step}',
    badges: {
      today: { one: '{n} job to do today', other: '{n} jobs to do today' },
      invoices: { one: '{n} invoice to collect', other: '{n} invoices to collect' },
      inventory: { one: '{n} part to order', other: '{n} parts to order' }
    }
  },
  book: 'Book',
  quick: {
    title: 'Add',
    call: 'Incoming call', callSub: 'The number finds the customer; if not, start with the address, the car or the job',
    book: 'Book an appointment', bookSub: 'Customer, services, block',
    walkIn: 'Walk-in customer', walkInSub: 'The job starts now, here',
    quote: 'Estimate', quoteSub: 'A price on site, no customer file',
    customer: 'New customer', customerSub: 'Just the file',
    expense: 'Expense or receipt', expenseSub: 'Receipt photo, amount, category'
  },
  sync: {
    synced: 'All sent', sending: 'Sending…', offline: 'Offline',
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
  update: {
    title: 'App updates', help: 'The app updates itself the next time it opens. Here you can check right away and install it without waiting.',
    mine: 'Version on this device', devVersion: 'test version',
    check: 'Check for updates', checking: 'Checking…',
    none: 'The app is up to date.', offline: 'No signal: try again when the network is back.', error: 'The check did not work. Try again in a moment.',
    ready: 'A new version of the app is ready.', important: 'Important app update: install it as soon as you can.',
    notes: 'What changes: {notes}', apply: 'Update now', later: 'Later'
  },
  moved: {
    title: 'The app has a new address: {host}',
    lead: 'Open it, sign in, then add it to your home screen. This one still works, but links sent to customers now come from the new one.',
    open: 'Open the new address', hide: 'Hide'
  },
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
