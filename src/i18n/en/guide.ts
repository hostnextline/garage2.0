import type { guide as fr } from '../fr/guide';
export const guide: typeof fr = {
  title: 'Where to start',
  sub: {
    owner: 'The first steps to run the garage in the app.',
    office: 'The first steps for the office.',
    mechanic: 'The first steps for your day on the road.',
    treasurer: 'The first steps to keep the books.'
  },
  roles: { owner: 'Owner', office: 'Office', mechanic: 'Mechanic', treasurer: 'Treasurer' },
  help: 'Each step checks itself once it is done. Tap a step to go to the right screen: the app shows you where to tap.',
  progress: '{done} of {total}',
  progressLabel: 'Steps done: {done} of {total}',
  allDone: 'All set. You know the essentials of the app.',
  checklist: 'Your first steps',
  next: 'Next step',
  go: 'Go',
  later: 'Later',
  laterToast: 'All right. We will bring it up again in a week.',
  done: 'Done',
  todo: 'To do',
  unknown: 'To check with a signal',
  confirm: 'Checked',
  confirmed: 'Noted: the prices are checked.',

  steps: {
    company: { title: 'The company file', text: 'The name, phone, address and GST and QST numbers: they are on every invoice.' },
    services: { title: 'Service prices', text: 'Check each price: it is what the customer sees in the text and on the invoice.' },
    trucks: { title: 'Trucks and their hours', text: 'Each truck, its mechanic and its working hours. Time slots open according to those hours.' },
    team: { title: 'Invite the team', text: 'Mechanics, the office and the treasurer get a link to enter the app.' },
    texts: { title: 'Texts to customers', text: 'Connect GoHighLevel: the confirmation, “on the way” and the invoice go out by themselves.' },
    cards: { title: 'Card payments', text: 'Connect Stripe: customers pay their invoice by card from their link.' },
    booking: { title: 'The first booking', text: 'Book a real appointment: the customer gets a confirmation text.' },
    book: { title: 'Your first booking', text: 'The customer, the services, then a suggested time slot. The truck and the order of stops are set by themselves.' },
    customers: { title: 'Find a customer', text: 'By name, phone number or licence plate.' },
    agenda: { title: 'The agenda', text: 'The week’s appointments, by day and by time slot.' },
    day: { title: 'Start your day', text: 'In the morning, start your day on the Today screen: the office sees that you are working.' },
    job: { title: 'The steps of a job', text: 'The big red button guides you, one step at a time, until payment.' },
    offline: { title: 'Without a signal', text: 'What works when there is no signal, and what waits.' },
    expense: { title: 'An expense with a receipt photo', text: 'Take a photo of the receipt: it stays attached to the expense.' },
    report: { title: 'The report and the taxes to remit', text: 'Sales, expenses, and the GST and QST to remit for the period.' },
    tour: { title: 'The guided tour', text: 'Two minutes: we show you the parts of the app, one at a time.' }
  },
  detail: {
    missing: 'Missing: {list}.',
    noServices: 'No services yet.',
    unpriced: { one: '{n} service has no price.', other: '{n} services have no price.' },
    confirmPrices: 'Every service has a price. Check them, then tap “Checked”.',
    noTruck: 'No active truck yet.',
    noDriver: '{name} has no mechanic.',
    noHours: '{name} has no working hours.',
    alone: 'You are alone in the app for now.',
    offline: 'Check when you have a signal.',
    noTruckMine: 'The owner must first give you a truck.'
  },
  fields: { name: 'the name', phone: 'the phone number', address: 'the address', tps: 'the GST number', tvq: 'the QST number' },

  jobSteps: {
    title: 'The steps of a job',
    lead: 'The big red button always shows the next step. One at a time.',
    leave: { title: 'I’m leaving', text: 'The customer gets a text with the link to follow your truck.' },
    arrive: { title: 'I’ve arrived', text: 'The office sees that you are on site. Note the car’s mileage.' },
    vin: { title: 'The car’s VIN', text: 'Scan the VIN (driver’s door or windshield) or type it. Unreadable? Tap “VIN unreadable”.' },
    waiver: { title: 'Get it signed', text: 'The customer signs on your phone before the work.' },
    invoice: { title: 'Invoice', text: 'The work done becomes the invoice. Check it, then finish it.' },
    pay: { title: 'Collect', text: 'Cash, debit, credit, Interac e-Transfer or cheque. The Paid stamp lands.' },
    finish: { title: 'Finish', text: 'Confirm the parts used: the job is over. Your next job shows up.' }
  },

  tour: {
    title: 'The guided tour',
    lead: 'We show you the parts of the app, one at a time. You can stop whenever you want.',
    start: 'Take the guided tour',
    again: 'Take the tour again',
    finishedOn: 'Tour taken on {date}.',
    others: 'The tours of the other roles',
    othersLead: 'To show the app to your team.',
    here: 'Right here',
    count: '{n} of {total}',
    prev: 'Previous',
    next: 'Next',
    finish: 'Finish',
    stop: 'Stop',
    ok: 'Got it',
    wait: 'One moment…',
    finished: 'Tour finished. You can take it again anytime in “Where to start”.',
    empty: 'This tour has nothing to show on this screen for now.',
    steps: {
      add: { title: 'The + button', text: 'To add anything: an appointment, a walk-in customer, an estimate, an expense.' },
      addTreasurer: { title: 'The + button', text: 'An expense or a receipt, from anywhere in the app.' },
      today: { title: 'Today', text: 'The day at a glance: each truck’s next job and what is left to do.' },
      agenda: { title: 'The agenda', text: 'Appointments by day and by time slot: morning, afternoon, evening.' },
      agendaBlock: { title: 'A time slot', text: 'Each slot shows the room left. Tap a free slot to book in it.' },
      book: { title: 'Booking', text: 'The customer, the services, then a suggested slot. The server picks the truck and the order of stops.' },
      bookCustomer: { title: 'The customer', text: 'Type a name or a phone number. If they are new, create their file right here.' },
      bookServices: { title: 'The services', text: 'Choose the services: the price and the time add up by themselves.' },
      bookBlock: { title: 'The time slot', text: 'The app suggests the slots where a truck is close by. Pick one, then book.' },
      hours: { title: 'Hours', text: 'Each truck’s working hours. They open or close the time slots.' },
      team: { title: 'The team', text: 'Invite your mechanics and the office. Each person only sees what their role allows.' },
      settings: { title: 'Settings', text: 'The company file, taxes, prices, texts and card payments.' },
      dashboard: { title: 'The numbers', text: 'The month’s sales, the jobs done and the money left to collect.' },
      customers: { title: 'Find a customer', text: 'Type a name, a phone number or a licence plate.' },
      map: { title: 'The map', text: 'Where the trucks and today’s jobs are.' },
      shift: { title: 'Start your day', text: 'Tap here in the morning. The office sees that you are working and where your truck is.' },
      next: { title: 'Your next job', text: 'It is always at the top. Tap it to open it.' },
      bigstep: { title: 'The big red button', text: 'It shows the one next step: I’m leaving, I’ve arrived, the car’s VIN, Get it signed, Invoice, Collect, Finish.' },
      waiver: { title: 'The signature', text: 'The customer signs on your phone before the work starts.' },
      work: { title: 'The work', text: 'What is planned for this job, with the prices.' },
      extra: { title: 'Extra work', text: 'Found something else? Suggest it: the customer accepts or declines, on your phone or by text.' },
      pay: { title: 'Invoice and payment', text: 'At the end: the invoice, then Collect. The job ends once it is paid.' },
      syncMechanic: { title: 'Without a signal', text: 'No signal in a basement? Keep going. Everything stays on the phone and goes out by itself when the signal is back.' },
      treasuryAdd: { title: 'Add an expense', text: 'Take a photo of the receipt, check the amount and the category, then save.' },
      treasuryReport: { title: 'The report', text: 'Sales, expenses and the taxes to remit (GST and QST) for the chosen period.' },
      invoices: { title: 'Invoices', text: 'Every invoice, paid or unpaid.' },
      inventory: { title: 'Stock', text: 'The parts running low are at the top of the list.' }
    }
  },

  install: {
    title: 'Install the app on your phone',
    lead: 'It opens like a real app, full screen, even with no signal.',
    button: 'Install the app',
    installed: 'The app is installed on this device.',
    iphone: 'On iPhone (Safari)',
    iphone1: 'Tap the Share button, at the bottom of the screen.',
    iphone2: 'Choose “Add to Home Screen”.',
    iphone3: 'Tap “Add”.',
    android: 'On Android (Chrome)',
    android1: 'Tap ⋮ at the top right.',
    android2: 'Choose “Install app” (or “Add to Home screen”).',
    android3: 'Confirm.',
    movedLead: 'The app has a new address. Open it, sign in, then install it from there: its guide shows you how.',
    computer: 'On the phone, open this address:',
    copy: 'Copy the address',
    copied: 'Address copied'
  },

  /* arrival windows (the garage books by arrival window): the texts above that speak of time slots, said for windows.
     Same paths as above; a text missing here is the one above (words.ts). */
  win: {
    steps: {
      trucks: { text: 'Each truck, its mechanic and its working hours. The arrival windows offered to customers follow those hours.' },
      book: { text: 'The customer, the services, then a suggested arrival window. The truck and the order of stops are set by themselves.' },
      agenda: { text: 'The week’s appointments, day by day.' }
    },
    tour: {
      steps: {
        agenda: { text: 'Appointments day by day, with the arrival window each customer was told.' },
        agendaBlock: { title: 'A day', text: 'Each day shows the room left. Tap a free day to book in it.' },
        book: { text: 'The customer, the services, then a suggested arrival window. The server picks the truck and the order of stops.' },
        bookBlock: { title: 'The arrival window', text: 'The app suggests 4-hour windows where a truck is close by. Pick one, then book.' },
        hours: { text: 'Each truck’s working hours. They decide the windows offered to customers.' }
      }
    },
    faq: {
      topics: { blocks: 'Windows' },
      qa: {
        book: {
          how: { a: 'Tap “+”, then “Book an appointment”. Choose the customer, their car and the services, then one of the suggested arrival windows. Tap “Book”: the customer gets a confirmation text.' },
          change: { a: 'Open the appointment from the agenda and tap “Edit”: the customer, the car, the address, the day and arrival window, the truck, the services and the prices. To cancel it: menu “…”, “Cancel the job”, with the reason. If the day or the window changes, the customer gets a text.' }
        },
        blocks: {
          what: { q: 'What is an arrival window?', a: 'Four hours around the time the app expects to arrive: 1 hour before, 3 hours after. If the app expects to arrive at 3 p.m., the customer hears “between 2 and 6 p.m.”. We promise a window, not an exact time.' },
          full: { q: 'Why is a day full?', a: 'Each truck has its working hours. When jobs and driving fill those hours, or we can no longer reach everyone inside their window, the day is full. Pick another day, offer “Flexible”, or add hours to the truck in Hours.' }
        },
        offline: {
          needs: { a: 'The suggested arrival windows when booking, the live map, texts to customers and online card payments.' }
        }
      }
    }
  },
  faq: {
    title: 'Common questions',
    lead: 'Short answers, by topic.',
    topics: { book: 'Booking', blocks: 'Time slots', offline: 'No signal', texts: 'Texts', payments: 'Payments', rights: 'Access' },
    qa: {
      book: {
        how: { q: 'How do I book an appointment?', a: 'Tap “+”, then “Book an appointment”. Choose the customer, their car and the services, then one of the suggested time slots. Tap “Book”: the customer gets a confirmation text.' },
        newCustomer: { q: 'The customer is not in the app yet?', a: 'Type their name or number in the customer field. If they do not exist, create their file in the same place: name, phone, address.' },
        change: { q: 'How do I move or cancel an appointment?', a: 'Open the appointment from the agenda and tap “Edit”: the customer, the car, the address, the day and time slot, the truck, the services and the prices. To cancel it: menu “…”, “Cancel the job”, with the reason. If the day or the slot changes, the customer gets a text.' },
        walkIn: { q: 'A customer without an appointment?', a: 'Tap “+”, then “Walk-in customer”: the job starts right away, on site.' }
      },
      blocks: {
        what: { q: 'What is a time slot?', a: 'The day is split into three slots: morning ({am}), afternoon ({pm}) and evening ({eve}). We promise the customer a slot, not an exact time.' },
        who: { q: 'Who picks the truck and the order of stops?', a: 'The server. It puts each job on the closest truck and sorts the stops in the best driving order.' },
        full: { q: 'Why is a time slot full?', a: 'Each truck has its working hours. When jobs and driving fill those hours, the slot is full. Pick another slot, or add hours to the truck in Hours.' },
        windows: { q: 'And the 4-hour arrival windows?', a: 'The garage can book by windows instead of time slots (the owner: in Settings, then Bookings, “Book by arrival windows”). The customer gets a 4-hour window: 1 hour before the time the app expects to arrive, 3 hours after. When the app reorders a route, it keeps every promised window. A customer who is free all day can be booked “Flexible”: their window is confirmed the day before, and it helps fit more appointments.' }
      },
      offline: {
        works: { q: 'What works without a signal?', a: 'Almost everything: see your day, move a job forward, get it signed, make the invoice, collect. Everything stays on the phone and goes out by itself when the signal is back.' },
        needs: { q: 'What needs a signal?', a: 'The suggested time slots when booking, the live map, texts to customers and online card payments.' },
        chip: { q: 'How do I know everything was sent?', a: 'When everything is sent, there is nothing to see. Otherwise a chip says “Offline” or “3 to send” (at the top on a phone, at the bottom of the menu on a computer): it is waiting for a signal and goes out by itself.' },
        refused: { q: 'A change was refused?', a: 'A red banner says why. Fix it if needed, then tap “Try again”, or “Remove” if it is no longer useful.' }
      },
      texts: {
        which: { q: 'Which texts does the customer get?', a: 'The appointment confirmation, a change of appointment, “on the way” with the link to follow the truck, extra work to accept, and the invoice.' },
        notSent: { q: 'Texts are not going out?', a: 'They go through GoHighLevel, which the owner connects in the settings. Without it, the app gives you the message and the link: you can send it yourself from your phone.' },
        lang: { q: 'The customer speaks English?', a: 'Texts, the customer page and the invoice follow the language written in their file.' }
      },
      payments: {
        how: { q: 'How do I collect?', a: 'At the end of the job: the invoice, then “Collect”. Choose cash, debit, credit, Interac e-Transfer, cheque or other. The Paid stamp lands once everything is paid. A job for family or friends can be paid by the Coffre: no invoice.' },
        later: { q: 'The customer wants to pay later?', a: 'Under the red button, tap “The customer will pay later”, write why, then “Let them go”: the job ends and the invoice stays to collect. For the owner and those with the invoices right. Otherwise, the job cannot end before it is paid.' },
        online: { q: 'Online card payment?', a: 'When Stripe is connected, the customer can pay by card from the link to their invoice. The payment is recorded in the app by itself.' }
      },
      rights: {
        who: { q: 'Who sees what?', a: 'The owner sees everything. The office books and manages customers. A mechanic sees his truck’s jobs. The treasurer sees the money and the expenses.' },
        missing: { q: 'You cannot open a part of the app?', a: 'Talk to the owner: they can give you that access in Team.' },
        preview: { q: 'See the app as someone else?', a: 'The owner can see the app as a team member, to check what they see. Nothing can be changed meanwhile.' }
      }
    }
  }
};
