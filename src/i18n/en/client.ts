import type { client as fr } from '../fr/client';
export const client: typeof fr = {
  title: 'H.I.S Mobile Mechanic',
  loading: 'Loading your file…',
  call: 'Call',
  callLabel: 'Call {garage} at {phone}',
  callUs: 'Call us at {phone}.',
  callUsNoPhone: 'Call the garage at the number that sent you this link.',
  otherLang: 'Français',
  otherLangLabel: 'Lire cette page en français',
  hello: 'Hello {name},',
  helloAlone: 'Hello,',
  today: 'Today',
  tomorrow: 'Tomorrow',
  between: 'Between {from} and {to}',
  blocks: { am: 'Morning', pm: 'Afternoon', eve: 'Evening' },
  printedOn: 'Printed on {date}',

  job: {
    title: 'Your appointment',
    lead: 'Here is your appointment with {garage}.',
    leadInvoice: 'Here is your invoice from {garage}.',
    vehicle: 'Vehicle',
    number: 'File number',
    status: {
      booked: 'Appointment confirmed',
      en_route: 'Your mechanic is on the way',
      on_site: 'Your mechanic is on site',
      done: 'Work done',
      cancelled: 'Appointment cancelled',
      no_show: 'Missed appointment'
    },
    explain: {
      booked: 'Your mechanic arrives during this time slot. You will get a text when he is on the way.',
      en_route: 'He is coming to you.',
      en_routeNoLink: 'He is coming to you. The link to follow the truck live was sent to you by text.',
      on_site: 'Your mechanic has arrived and is taking care of your vehicle.',
      done: 'The work is done.',
      cancelled: 'This appointment is cancelled. To book another one, call us.',
      no_show: 'We could not find you at the appointment. Call us to set up another one.'
    },
    track: 'Follow the truck live'
  },

  work: {
    title: 'Planned work',
    expected: 'Expected total, taxes included',
    expectedNoTax: 'Expected total',
    prepaid: 'Already paid',
    left: 'Left to pay',
    done: 'Done',
    accepted: 'Accepted',
    qty: '{qty} × {price}',
    none: 'Your mechanic will confirm the work on site.',
    taxDetail: 'See the tax details'
  },

  extras: {
    title: 'Work suggested by your mechanic',
    lead: 'Your mechanic found something else to do. Nothing will be done without your consent.',
    why: 'Why:',
    plusTax: 'plus taxes',
    accept: 'Accept',
    decline: 'Decline',
    confirmAccept: 'You accept this work for {price} plus taxes. Your mechanic will do it during his visit.',
    confirmAcceptNoTax: 'You accept this work for {price}. Your mechanic will do it during his visit.',
    confirmDecline: 'You decline this work. Your mechanic will not do it.',
    yesAccept: 'Yes, I accept',
    yesDecline: 'Yes, I decline',
    back: 'Back',
    thanks: 'Thank you! Your answer was sent to your mechanic.',
    newTotal: 'New expected total: {total}, taxes included.',
    declinedTitle: 'Declined work',
    declined: 'Declined'
  },

  invoice: {
    heroTitle: 'Your invoice',
    title: 'Invoice {number}',
    issued: 'Issued on {date}',
    subtotal: 'Subtotal',
    tps: 'GST (5%)',
    tvq: 'QST (9.975%)',
    total: 'Total',
    paid: 'Paid',
    balance: 'Balance due',
    tpsNo: 'GST no. {no}',
    tvqNo: 'QST no. {no}',
    print: 'Print',
    stamp: 'Paid',
    paidThanks: 'Invoice paid. Thank you!',
    payOnSite: 'To pay, call us or pay your mechanic on site.'
  },

  pay: {
    button: 'Pay {amount} by card',
    prepay: 'Pay {amount} ahead by card',
    prepayLead: 'You can also pay on site when the work is done.',
    secure: 'Secure payment by Stripe. You will come back here afterwards.',
    opening: 'Opening the payment page…',
    pending: 'A card payment was started. If it is finished, it will show here in a moment.',
    checking: 'Checking your payment…',
    checkingLead: 'We are confirming your payment. Keep this page open.',
    done: 'Thank you! Your payment was received.',
    late: 'The payment does not show yet. If it was accepted, it will show here within a few minutes.',
    checkAgain: 'Check again',
    fail: 'The payment page could not open. Try again in a moment or call us.'
  },

  quote: {
    title: 'Your estimate',
    lead: 'Here is the estimate from {garage}.',
    number: 'Estimate no. {number}',
    vehicle: 'Vehicle',
    validUntil: 'Valid until {date}',
    expired: 'This estimate is no longer valid since {date}. Call us to update it.',
    note: 'Estimated price. If your mechanic finds something else, nothing will be done without your consent.',
    total: 'Estimated total, taxes included',
    totalNoTax: 'Estimated total',
    book: 'Call to book'
  },

  errors: {
    bad_link: { title: 'This link does not work', text: 'It may be incomplete. We can send you a new one.' },
    expired: { title: 'This link has expired', text: 'We can send you a new one.' },
    gone: { title: 'This file no longer exists', text: 'If you have a question, we are here to answer it.' },
    network: { title: 'No connection', text: 'Check your Internet connection, then try again.' },
    server: { title: 'Something went wrong', text: 'Try again in a moment. If it keeps happening, call us.' },
    retry: 'Try again',
    answer: 'Your answer was not sent. Try again in a moment or call us.'
  },

  track: {
    title: 'Truck tracking',
    onTheWay: '{name} is on the way',
    onTheWayAnon: 'Your mechanic is on the way',
    eta: 'Expected around {time} (about {min} min)',
    etaSoon: 'Arriving any minute now',
    etaNone: 'He is coming to you.',
    mechanic: 'Your mechanic: {name}',
    updated: 'Position updated at {time}',
    noPos: 'The truck’s position is not available yet. This page updates by itself.',
    arrived: '{name} has arrived',
    arrivedAnon: 'Your mechanic has arrived',
    arrivedAt: 'Arrived at {time}',
    arrivedText: 'He is now taking care of your vehicle.',
    cancelled: 'Tracking has ended',
    cancelledText: 'This trip is no longer tracked. To know where your appointment stands, call us.',
    expired: 'This tracking link has expired',
    expiredText: 'Tracking only lasts for the trip. To know where your appointment stands, call us.',
    notFound: 'This tracking link does not work',
    notFoundText: 'It may be incomplete. Call us and we will tell you where your mechanic is.',
    lost: 'Connection lost. Trying again in a moment.',
    home: 'Your place',
    truck: 'Your mechanic’s truck',
    map: 'Map: the truck’s route to your place',
    seeAppointment: 'See my appointment',
    recenter: 'Re-center the map'
  }
};
