/* « Info »: every procedure of the app, in simple words, with an example. Searchable (search.ts).
   Each article: its subject, who it is for, a short answer, the steps (the real names of the buttons), an example
   from a real-looking day, tips, and words people may type to find it. French and English. */

export type InfoTopic = 'day' | 'booking' | 'pay' | 'customers' | 'map' | 'office' | 'setup';
export const INFO_TOPICS: InfoTopic[] = ['day', 'booking', 'pay', 'customers', 'map', 'office', 'setup'];
export type InfoRole = 'owner' | 'office' | 'mechanic' | 'accountant';

/** `roads`: what changes while the real roads are on (settings.booking.roads_on, Part 27): a sentence true only with the
    estimate of before has its twin here (articleText picks it) */
export interface InfoText { title: string; short: string; steps: string[]; example: string; tips?: string[]; keys?: string; roads?: Partial<Pick<InfoText, 'short' | 'steps' | 'example' | 'tips'>> }
export interface InfoArticle { id: string; topic: InfoTopic; roles: InfoRole[]; link?: string; fr: InfoText; en: InfoText }

/** the article's text in a language, with the real roads on or off */
export function articleText(a: InfoArticle, l: 'fr' | 'en', roadsOn: boolean): InfoText {
  const x = a[l];
  return roadsOn && x.roads ? { ...x, ...x.roads } : x;
}

export const ARTICLES: InfoArticle[] = [
  /* ---------- the day of the mechanic ---------- */
  {
    id: 'start-day', topic: 'day', roles: ['mechanic'], link: '#/',
    fr: {
      title: 'Commencer et terminer ma journée',
      short: 'Le matin, touche « Commencer ma journée ». Le soir, « Terminer ma journée ». Entre les deux, le bureau voit où tu es.',
      steps: [
        'Ouvre l’app : l’écran « Aujourd’hui » montre tes rendez-vous du jour, dans l’ordre.',
        'Touche « Commencer ma journée ». Accepte que le téléphone donne ta position.',
        'Fais tes jobs une après l’autre (voir « Une job du début à la fin »).',
        'Le soir, touche « Terminer ma journée » : ta position n’est plus envoyée.'
      ],
      example: 'Saleh arrive au camion à 7 h 50. Il ouvre l’app, touche « Commencer ma journée » et voit : 1. Amro à 8 h 20, 2. Andre à 12 h 15. Le bureau le voit maintenant sur la carte.',
      tips: [
        'La position est envoyée seulement quand l’app est ouverte sur l’écran (environ une fois par minute).',
        'Quand tu travailles chez un client, la carte te montre chez lui, même si ton téléphone dort.'
      ],
      keys: 'debut fin journee shift position commencer terminer matin soir'
    },
    en: {
      title: 'Start and end my day',
      short: 'In the morning, tap “Start my day”. At night, “End my day”. In between, the office sees where you are.',
      steps: [
        'Open the app: the “Today” screen shows your appointments of the day, in order.',
        'Tap “Start my day”. Allow the phone to share your location.',
        'Do your jobs one after the other (see “A job from start to finish”).',
        'At night, tap “End my day”: your location is no longer sent.'
      ],
      example: 'Saleh gets to the truck at 7:50. He opens the app, taps “Start my day” and sees: 1. Amro at 8:20, 2. Andre at 12:15. The office now sees him on the map.',
      tips: ['The location is sent only while the app is open on the screen (about once a minute).', 'While you work at a customer’s, the map shows you there, even if your phone sleeps.'],
      keys: 'start end day shift location morning night'
    }
  },
  {
    id: 'job-flow', topic: 'day', roles: ['mechanic', 'owner'],
    fr: {
      title: 'Une job du début à la fin',
      short: 'Le gros bouton rouge de la job te dit toujours quoi faire ensuite : Je pars, Je suis arrivé, le NIV, la signature, la facture, encaisser, terminer.',
      steps: [
        '« Je pars » : le client reçoit un texto avec ton heure d’arrivée et un lien pour suivre le camion.',
        '« Je suis arrivé » : la job passe « Sur place ». La feuille « La voiture » demande le kilométrage au tableau de bord (« Plus tard » pour passer).',
        '« Le NIV de l’auto » : scanne le NIV ou écris-le. Il ne se lit pas ? Touche « NIV illisible ».',
        '« Faire signer l’autorisation » : le client signe sur ton téléphone, avant le travail.',
        'Si tu trouves autre chose à faire, ajoute-le (voir « Proposer des travaux en plus »).',
        '« Faire la facture » : elle se fait à partir du travail. Vérifie les lignes, puis termine-la.',
        '« Encaisser » : choisis comment le client paie (voir « Encaisser un paiement »).',
        '« Terminer la job » : confirme les « Pièces utilisées », et c’est fini.'
      ],
      example: 'Chez Mahdi : Saleh touche « Je pars » à 14 h 40 (Mahdi reçoit « arrivée vers 15 h 03 »). À 15 h 05 : « Je suis arrivé », 84 200 km. Il scanne le NIV, Mahdi signe. Changement d’huile fait. « Faire la facture » : 103,47 $. « Encaisser » : comptant. « Terminer la job » : 4,4 L d’huile et 1 filtre utilisés.',
      tips: [
        'Une erreur ? Menu « … » de la job → « Défaire la dernière étape ».',
        'Tu ne peux pas partir chez le client suivant tant que la job d’avant n’est pas payée (sauf « Le client paiera plus tard »).',
        'Le NIV garde l’historique de l’auto, même si elle change de propriétaire.'
      ],
      keys: 'je pars arrive niv vin km kilometrage signature autorisation facture encaisser terminer pieces etapes bouton rouge sur place'
    },
    en: {
      title: 'A job from start to finish',
      short: 'The big red button of the job always tells you what is next: I’m leaving, I’ve arrived, the VIN, the signature, the invoice, payment, finish.',
      steps: [
        '“I’m leaving”: the customer gets a text with your arrival time and a link to follow the truck.',
        '“I’ve arrived”: the job goes “On site”. The “Car” sheet asks for the mileage on the dashboard (“Later” to skip).',
        '“The car’s VIN”: scan the VIN or type it. Unreadable? Tap “VIN unreadable”.',
        '“Get the authorization signed”: the customer signs on your phone, before the work.',
        'Found something else to do? Add it (see “Propose extra work”).',
        '“Make the invoice”: it is made from the work. Check the lines, then finish it.',
        '“Take payment”: choose how the customer pays (see “Take a payment”).',
        '“Finish the job”: confirm the “Parts used”, and you are done.'
      ],
      example: 'At Mahdi’s: Saleh taps “I’m leaving” at 2:40 (Mahdi gets “arriving around 3:03”). At 3:05: “I’ve arrived”, 84,200 km. He scans the VIN, Mahdi signs. Oil change done. “Make the invoice”: $103.47. “Take payment”: cash. “Finish the job”: 4.4 L of oil and 1 filter used.',
      tips: ['A mistake? The job’s “…” menu → “Undo the last step”.', 'You cannot leave for the next customer while the job before is unpaid (unless “The customer will pay later”).', 'The VIN keeps the car’s history, even if it changes owner.'],
      keys: 'leave arrived vin km mileage signature authorization invoice payment finish parts steps red button on site'
    }
  },
  {
    id: 'tracking', topic: 'day', roles: ['mechanic', 'owner', 'office'],
    fr: {
      title: 'Le texto « en route » et le suivi du camion',
      short: 'Quand tu touches « Je pars », le client reçoit un texto avec l’heure d’arrivée et un lien. Le lien ouvre une carte simple, style Uber, avec les minutes qui restent.',
      steps: [
        'Touche « Je pars » sur la job.',
        'Le client reçoit : « Saleh de Mécanique Mobile H.I.S est en route : arrivée prévue vers 15 h 03 (environ 14 min). Suivez son trajet : [lien] ».',
        'En ouvrant le lien, il voit le camion, le trajet, les minutes qui restent et un bouton pour appeler le garage.',
        'Le suivi s’arrête tout seul quand tu touches « Je suis arrivé ».'
      ],
      example: 'Andre reçoit le texto à 12 h 01. Il ouvre le lien : « 14 min, arrivée prévue vers 12 h 15 ». Il voit le petit camion noir s’approcher de sa maison.',
      tips: ['Texto perdu ? Menu « … » de la job → « Renvoyer le texto « en route » » (un nouveau lien).', 'Le lien marche seulement pendant le trajet (quelques heures au plus).'],
      keys: 'texto sms en route lien suivi suivre camion uber heure arrivee eta client'
    },
    en: {
      title: 'The “on the way” text and truck tracking',
      short: 'When you tap “I’m leaving”, the customer gets a text with the arrival time and a link. The link opens a simple, Uber-style map with the minutes left.',
      steps: ['Tap “I’m leaving” on the job.', 'The customer gets: “Saleh from Mécanique Mobile H.I.S is on the way: arriving around 3:03 (about 14 min). Follow the trip: [link]”.', 'The link shows the truck, the route, the minutes left and a button to call the garage.', 'Tracking stops by itself when you tap “I’ve arrived”.'],
      example: 'Andre gets the text at 12:01. He opens the link: “14 min, arriving around 12:15”. He sees the little black truck getting closer to his house.',
      tips: ['Lost text? The job’s “…” menu → “Send the ‘on the way’ text again” (a new link).', 'The link only works during the trip (a few hours at most).'],
      keys: 'text sms on the way link tracking follow truck uber arrival eta customer'
    }
  },
  {
    id: 'car-first', topic: 'day', roles: ['mechanic'],
    fr: {
      title: 'Le véhicule, l’huile et le filtre (en haut de la job)',
      short: 'En ouvrant une job, la première chose affichée est la voiture, l’huile qu’elle prend, le filtre, puis le travail à faire.',
      steps: [
        'Ouvre la job.',
        'En haut : l’année, la marque, le modèle, le moteur et la plaque.',
        'Dessous : l’huile (grade et litres) et le filtre à huile.',
        'Puis la liste du travail à faire.'
      ],
      example: 'Job d’Amro : « 2018 Toyota Corolla 1.8 L ». Huile 0W-20, 4,4 L, filtre 04152-YZZA6. Travail : changement d’huile, rotation des pneus.',
      tips: ['« À confirmer » veut dire que l’info vient de la liste des moteurs et pas d’une fiche vérifiée : jette un œil avant de verser l’huile.'],
      keys: 'voiture vehicule huile filtre moteur litres grade travail mecano'
    },
    en: {
      title: 'The car, the oil and the filter (at the top of the job)',
      short: 'When you open a job, the first thing shown is the car, the oil it takes, the filter, then the work to do.',
      steps: ['Open the job.', 'At the top: year, make, model, engine and plate.', 'Below: the oil (grade and litres) and the oil filter.', 'Then the list of work to do.'],
      example: 'Amro’s job: “2018 Toyota Corolla 1.8 L”. Oil 0W-20, 4.4 L, filter 04152-YZZA6. Work: oil change, tire rotation.',
      tips: ['“To confirm” means the info comes from the engine list, not a checked sheet: have a look before pouring the oil.'],
      keys: 'car vehicle oil filter engine litres grade work mechanic'
    }
  },
  {
    id: 'extra-work', topic: 'day', roles: ['mechanic'],
    fr: {
      title: 'Proposer des travaux en plus',
      short: 'Tu trouves autre chose à réparer ? Propose-le dans la job. Le client accepte ou refuse sur ton téléphone. Seul ce qu’il accepte va sur la facture.',
      steps: [
        'Dans la job, ajoute le travail (le service et son prix).',
        'Choisis de le proposer au client.',
        'Le gros bouton devient « Faire répondre le client » : il touche Accepter ou Refuser.',
        'Accepté : la ligne va sur la facture. Refusé : rien n’est facturé.'
      ],
      example: 'Pendant le changement d’huile d’Andre, Saleh voit des plaquettes usées. Il propose « Plaquettes avant, 189 $ ». Andre accepte sur le téléphone : la facture passe de 89,99 $ à 278,99 $ avant taxes.',
      keys: 'extra travaux supplementaires proposer accepter refuser ajout plaquettes'
    },
    en: {
      title: 'Propose extra work',
      short: 'Found something else to fix? Propose it in the job. The customer accepts or refuses on your phone. Only what is accepted is billed.',
      steps: ['In the job, add the work (the service and its price).', 'Choose to propose it to the customer.', 'The big button becomes “Have the customer answer”: they tap Accept or Refuse.', 'Accepted: the line goes on the invoice. Refused: nothing is billed.'],
      example: 'During Andre’s oil change, Saleh sees worn brake pads. He proposes “Front pads, $189”. Andre accepts on the phone: the invoice goes from $89.99 to $278.99 before taxes.',
      keys: 'extra work additional propose accept refuse pads'
    }
  },
  {
    id: 'cancel', topic: 'day', roles: ['mechanic', 'owner', 'office'],
    fr: {
      title: 'Annuler une job ou « Client absent »',
      short: 'Menu « … » de la job : « Annuler la job » libère le bloc ; « Client absent » note l’absence dans sa fiche.',
      steps: [
        'Ouvre la job, touche « … » en haut à droite.',
        '« Annuler la job » (avant le travail) : écris pourquoi. Le bloc se libère.',
        'Ou « Client absent » : personne sur place. L’absence compte dans sa fiche.',
        'Le client n’est pas averti automatiquement : appelle-le.'
      ],
      example: 'Saleh arrive chez Ola : personne, pas de réponse au téléphone après 10 minutes. Il touche « … » → « Client absent » → « Personne, pas de réponse ». Il passe au client suivant.',
      tips: ['Erreur ? Le bureau peut « Rouvrir la job » : elle revient à l’agenda, au même bloc (ou le même jour, avec les plages d’arrivée).'],
      keys: 'annuler absent no show personne rouvrir annulation'
    },
    en: {
      title: 'Cancel a job or “No-show”',
      short: 'The job’s “…” menu: “Cancel the job” frees the block; “No-show” records the absence on their file.',
      steps: ['Open the job, tap “…” at the top right.', '“Cancel the job” (before the work): say why. The block frees up.', 'Or “No-show”: nobody there. It counts on their file.', 'The customer is not told automatically: call them.'],
      example: 'Saleh gets to Ola’s: nobody, no answer after 10 minutes. He taps “…” → “No-show” → “Nobody, no answer”. On to the next customer.',
      tips: ['A mistake? The office can “Reopen the job”: it goes back on the agenda, same block (or same day, with arrival windows).'],
      keys: 'cancel no show absent nobody reopen'
    }
  },
  {
    id: 'walk-in', topic: 'day', roles: ['mechanic', 'owner', 'office'],
    fr: {
      title: 'Un client sans rendez-vous',
      short: 'Bouton rouge « + » → « Client sans rendez-vous » : la job commence maintenant, sur ton camion.',
      steps: [
        'Touche le « + » rouge en bas.',
        'Choisis « Client sans rendez-vous ».',
        'Choisis ou crée le client, son véhicule et le travail.',
        'La job s’ouvre « Sur place » : continue comme une job normale (signature, facture, encaisser).'
      ],
      example: 'Pendant qu’il est chez Amro, le voisin demande un changement d’huile. Saleh touche « + » → « Client sans rendez-vous », crée « Karim », sa Civic 2015, « Changement d’huile ». Il fait le travail tout de suite.',
      keys: 'sans rendez-vous walk-in voisin maintenant ici nouveau'
    },
    en: {
      title: 'A customer without an appointment',
      short: 'Red “+” button → “Walk-in customer”: the job starts now, on your truck.',
      steps: ['Tap the red “+” at the bottom.', 'Choose “Walk-in customer”.', 'Pick or create the customer, their vehicle and the work.', 'The job opens “On site”: carry on like a normal job (signature, invoice, collect).'],
      example: 'While at Amro’s, the neighbour asks for an oil change. Saleh taps “+” → “Walk-in customer”, creates “Karim”, his 2015 Civic, “Oil change”. He does it right away.',
      keys: 'walk-in without appointment neighbour now new'
    }
  },

  /* ---------- appointments ---------- */
  {
    id: 'book', topic: 'booking', roles: ['owner', 'office', 'mechanic'], link: '#/book',
    fr: {
      title: 'Réserver un rendez-vous',
      short: '« + » → « Réserver un rendez-vous » : le client, sa voiture, les services, puis un moment proposé. L’app place le client sur un camion et calcule l’heure.',
      steps: [
        'Touche le « + » rouge → « Réserver un rendez-vous ».',
        'Cherche le client (ou crée-le).',
        'Choisis sa voiture (ou ajoute-la, voir « Ajouter un client et ses véhicules »).',
        'Coche les services. La durée se calcule ; tu peux la changer.',
        'Le garage a la voiture et le camion ? Choisis « Peu importe », « Voiture » ou « Camion ».',
        'Choisis un moment proposé, ou « Choisir sur la carte » pour voir les routes de chaque jour.',
        'Touche « Réserver ». Le client reçoit un texto avec chaque service, son prix et le total.'
      ],
      example: 'Andre appelle pour un changement d’huile demain après-midi. Le bureau tape « Andre », choisit sa Sienna, coche « Changement d’huile », choisit « Demain, après-midi » et réserve. Andre reçoit le texto : « Changement d’huile 89,99 $ — Total : 89,99 $ + tx ».',
      tips: [
        'L’heure exacte est calculée par l’app (la route la plus courte). Le client a le bloc ; il reçoit l’heure le jour même avec « Je pars ».',
        'Un moment marqué « loin » met beaucoup de route dans la journée : voir « Garde-route ».',
        'Si le garage réserve par plages d’arrivée (voir « Plages d’arrivée de 4 heures »), tu choisis une plage de 4 heures au lieu d’un bloc. Le reste est pareil.'
      ],
      keys: 'reserver rendez-vous rdv booking bloc matin apres-midi soir camion voiture carte nouveau prendre',
      roads: { tips: [
        'L’heure est calculée par l’app avec les vraies routes (la circulation habituelle de l’heure). Un trajet pas encore mesuré compte un temps fixe : l’heure est sûre une fois la route mesurée. Le client a le bloc ; il reçoit l’heure le jour même avec « Je pars ».',
        'Un moment marqué « loin » met beaucoup de route dans la journée : voir « Garde-route ».',
        'Si le garage réserve par plages d’arrivée (voir « Plages d’arrivée de 4 heures »), tu choisis une plage de 4 heures au lieu d’un bloc. Le reste est pareil.'
      ] }
    },
    en: {
      title: 'Book an appointment',
      short: '“+” → “Book an appointment”: the customer, their car, the services, then a suggested moment. The app puts them on a truck and works out the time.',
      steps: ['Tap the red “+” → “Book an appointment”.', 'Find the customer (or create them).', 'Pick their car (or add it).', 'Tick the services. The length is worked out; you can change it.', 'The garage has the car and the truck? Choose “Either”, “Car” or “Truck”.', 'Pick a suggested moment, or “Choose on the map” to see each day’s routes.', 'Tap “Book”. The customer gets a text with each service, its price and the total.'],
      example: 'Andre calls for an oil change tomorrow afternoon. The office types “Andre”, picks his Sienna, ticks “Oil change”, picks “Tomorrow, afternoon” and books. Andre gets the text: “Oil change $89.99 — Total: $89.99 + tx”.',
      tips: ['The exact time is worked out by the app (the shortest route). The customer gets the block; the exact time comes on the day with “I’m leaving”.', 'A moment marked “far” puts a lot of driving in the day: see “Too much driving”.', 'If the garage books by arrival windows (see “4-hour arrival windows”), you pick a 4-hour window instead of a block. The rest is the same.'],
      keys: 'book appointment booking block morning afternoon evening truck car map new',
      roads: { tips: ['The time is worked out by the app with the real roads (the usual traffic of the hour). A drive not measured yet counts a fixed time: the time is sure once the road is measured. The customer gets the block; the exact time comes on the day with “I’m leaving”.', 'A moment marked “far” puts a lot of driving in the day: see “Too much driving”.', 'If the garage books by arrival windows (see “4-hour arrival windows”), you pick a 4-hour window instead of a block. The rest is the same.'] }
    }
  },
  {
    id: 'call', topic: 'booking', roles: ['owner', 'office'], link: '#/call',
    fr: {
      title: 'Un appel entrant',
      short: '« + » → « Appel entrant » : tape le numéro, le client connu sort tout seul. Quelqu’un de nouveau ? Commence par ce dont il parle : l’adresse, la voiture ou la job.',
      steps: [
        'Touche « + » → « Appel entrant » (ou « Ouvrir » sur le bandeau quand l’appel arrive par GoHighLevel).',
        'Tape les chiffres du numéro : les clients qui ont ces chiffres apparaissent.',
        'Un client connu : « Réserver pour … », sa fiche ou son prochain rendez-vous.',
        'Un nouveau : choisis « L’adresse », « La voiture » ou « La job » ; la réservation s’ouvre dans cet ordre, le nom et le numéro à la fin.',
        '« Réserver » crée le client et sa voiture, puis réserve.'
      ],
      example: 'Le téléphone sonne : 514 555 0187. Nadia tape « 0187 » : personne. Le client parle de sa Corolla qui fait du bruit : « La voiture » d’abord, puis l’adresse, le service, le moment, et enfin « Julie, 514 555-0187 ».',
      tips: ['Le propriétaire peut recevoir les appels de GoHighLevel dans son compte : Réglages → Branchements → « Recevoir les appels dans mon compte ».'],
      keys: 'appel entrant telephone sonne numero nouveau client connu ghl gohighlevel bandeau'
    },
    en: {
      title: 'An incoming call',
      short: '“+” → “Incoming call”: type the number, a known customer shows by itself. Someone new? Start with what they talk about: the address, the car or the job.',
      steps: ['Tap “+” → “Incoming call” (or “Open” on the banner when the call comes through GoHighLevel).', 'Type the digits of the number: the customers with those digits show up.', 'A known customer: “Book for …”, their file or their next appointment.', 'Someone new: choose the address, the car or the job; the booking opens in that order, the name and number last.', '“Book” creates the customer and their car, then books.'],
      example: 'The phone rings: 514 555 0187. Nadia types “0187”: nobody. The caller talks about their noisy Corolla: the car first, then the address, the service, the moment, and last “Julie, 514 555-0187”.',
      tips: ['The owner can get the GoHighLevel calls in their account: Settings → Connections → “Get the calls in my account”.'],
      keys: 'incoming call phone ringing number new known customer ghl gohighlevel banner'
    }
  },
  {
    id: 'multi-cars', topic: 'booking', roles: ['owner', 'office'],
    fr: {
      title: 'Un client avec plusieurs voitures',
      short: 'Dans « Réserver », chaque voiture du client a sa propre liste de travaux. Choisis une voiture, coche ses travaux, puis passe à l’autre.',
      steps: [
        'Dans « Réserver », choisis le client.',
        'Choisis la première voiture et coche ses travaux.',
        'Choisis la deuxième voiture : la liste repart à zéro, coche ses travaux.',
        'Revenir à la première voiture remet ses travaux.',
        'Réserve : un rendez-vous par voiture, dans le même bloc.'
      ],
      example: 'Mahdi a une Corolla et une Sienna. Corolla : changement d’huile. Sienna : pneus d’hiver. Un seul bloc « samedi matin », deux rendez-vous, un pour chaque voiture.',
      tips: ['Avec les plages d’arrivée : les deux rendez-vous ont le même jour et la même plage.'],
      keys: 'plusieurs voitures vehicules deux autos famille corolla sienna'
    },
    en: {
      title: 'A customer with several cars',
      short: 'In “Book”, each of the customer’s cars has its own list of work. Pick a car, tick its work, then go to the other.',
      steps: ['In “Book”, pick the customer.', 'Pick the first car and tick its work.', 'Pick the second car: the list starts empty, tick its work.', 'Going back to the first car brings its work back.', 'Book: one appointment per car, in the same block.'],
      example: 'Mahdi has a Corolla and a Sienna. Corolla: oil change. Sienna: winter tires. One block “Saturday morning”, two appointments, one per car.',
      tips: ['With arrival windows: both appointments get the same day and the same window.'],
      keys: 'several cars vehicles two family'
    }
  },
  {
    id: 'force', topic: 'booking', roles: ['owner', 'office'],
    fr: {
      title: 'Réserver quand même (bloc complet)',
      short: 'Un bloc est plein mais tu veux le client quand même ? Après l’avertissement, « Réserver quand même » le met à la fin de la route. Personne ne perd sa place.',
      steps: [
        'Réserve comme d’habitude.',
        'L’app dit que le bloc est complet.',
        'Touche « Réserver quand même » et confirme.',
        'Le client va à la fin de la route du camion ; la journée finit plus tard.'
      ],
      example: 'Samedi matin est plein. Un bon client insiste. Hassan touche « Réserver quand même » : il passe en 5e, après les 4 autres, vers 12 h 10.',
      tips: ['Seuls le propriétaire et le bureau peuvent le faire.', 'Avec les plages d’arrivée, c’est la journée qui est pleine : le client forcé passe à la fin de la route et peut être servi en dehors de sa plage. L’app l’indique « Hors plage ».'],
      keys: 'complet plein forcer quand meme surbooking bloc'
    },
    en: {
      title: 'Book anyway (full block)',
      short: 'A block is full but you want the customer anyway? After the warning, “Book anyway” puts them at the end of the route. Nobody loses their place.',
      steps: ['Book as usual.', 'The app says the block is full.', 'Tap “Book anyway” and confirm.', 'The customer goes at the end of the truck’s route; the day ends later.'],
      example: 'Saturday morning is full. A good customer insists. Hassan taps “Book anyway”: they go 5th, after the other 4, around 12:10.',
      tips: ['Only the owner and the office can do it.', 'With arrival windows, it is the day that is full: the forced customer goes at the end of the route and may be reached outside their window. The app shows “Outside the window”.'],
      keys: 'full force anyway overbook block'
    }
  },
  {
    id: 'move', topic: 'booking', roles: ['owner', 'office'],
    fr: {
      title: 'Modifier ou déplacer un rendez-vous',
      short: 'Sur la job, « Modifier » change tout au même endroit : le client, l’auto, l’adresse, le jour et le bloc, le camion, les services et les prix, le problème et les notes.',
      steps: [
        'Ouvre la job (pas encore commencée).',
        'Touche « Modifier » (aussi dans le menu « … », et d’un clic droit ou d’un appui long dans l’agenda).',
        'Change ce qu’il faut : un autre jour ou un autre bloc, un autre client (« Changer de client »), un service, un prix.',
        'Enregistre. Si le jour ou le bloc change, l’app te demande « Texter … ? » : « Envoyer le texto » avertit le client, « Pas de texto » n’envoie rien.',
        'Seulement le camion à changer ? Menu « … » → « Changer de camion » : choisis un camion qui travaille ce bloc, ou « Laisser l’app choisir ». Le client n’est pas averti (même jour, même heure). Avec les plages d’arrivée, si l’autre camion ne peut pas être là à cette heure, l’app te le dit avant et te propose la première heure possible : sa nouvelle plage est dite, et l’app te demande ensuite s’il faut texter le client.'
      ],
      example: 'Amro ne peut plus samedi. Le bureau ouvre sa job → « Modifier » → lundi matin, puis enregistre. L’app demande « Texter Amro ? » : « Envoyer le texto », et Amro reçoit son nouveau moment.',
      tips: ['Avec les plages d’arrivée, tu choisis le nouveau jour et l’heure où le mécano arrive (à 15 minutes près ; dans l’agenda à l’ordi, glisse la job à cette heure) : la job arrive à cette heure-là, le client reçoit la plage de 4 heures autour, et les autres arrêts gardent leur ordre et leur heure. Si quelqu’un serait en retard, l’app te dit qui avant d’enregistrer. « Flexible » : l’app choisit l’heure.', 'Le mauvais client sur le rendez-vous ? « Changer de client » : ses liens sont retirés, renvoie la confirmation au bon client.', 'Sans ouvrir la job : sur la Carte (« Déplacer » sur la fiche de l’arrêt), dans Vue d’ensemble et dans « Les camions » d’Aujourd’hui, appui long sur un arrêt (à l’ordi : clic droit) → « Déplacer ». La feuille s’ouvre sur place ; l’arrêt quitte la liste s’il change de jour.'],
      keys: 'modifier deplacer changer date jour reporter remettre bloc client camion prix service carte arret arrets vue ensemble camions texto texter sms'
    },
    en: {
      title: 'Edit or move an appointment',
      short: 'On the job, “Edit” changes everything in one place: the customer, the car, the address, the day and block, the truck, the services and prices, the problem and notes.',
      steps: ['Open the job (not started yet).', 'Tap “Edit” (also in the “…” menu, and with a right click or a long press in the agenda).', 'Change what you need: another day or block, another customer (“Change the customer”), a service, a price.', 'Save. If the day or block changes, the app asks “Text …?”: “Send the text” tells the customer, “No text” sends nothing.', 'Only the truck to change? “…” menu → “Change truck”: pick a truck working that block, or “Let the app choose”. The customer is not told (same day, same time). With arrival windows, if the other truck can’t be there at that time, the app tells you first and offers the earliest time: its new window is shown, and then the app asks you whether to text the customer.'],
      example: 'Amro can’t make Saturday. The office opens his job → “Edit” → Monday morning → save. The app asks “Text Amro?”: “Send the text”, and Amro gets his new time.',
      tips: ['With arrival windows, you pick the new day and the time the mechanic arrives (to the quarter hour; in the agenda on a computer, drag the job to that time): the job arrives then, the customer is told the 4-hour window around it, and the other stops keep their order and time. If someone would be late, the app tells you who before saving. “Flexible”: the app picks the time.', 'The wrong customer on the appointment? “Change the customer”: their links are removed, send the confirmation again to the right customer.', 'Without opening the job: on the Map (“Move” on the stop’s card), in Overview and in “The trucks” on Today, press and hold a stop (on a computer: right-click) → “Move”. The sheet opens right there; the stop leaves the list when it changes day.'],
      keys: 'edit move change date day reschedule block customer truck price service map stop stops overview trucks text sms'
    }
  },
  {
    id: 'far', topic: 'booking', roles: ['owner', 'office'], link: '#/book',
    fr: {
      title: 'Garde-route : trop de route dans une journée',
      short: 'L’app compte la route que chaque rendez-vous ajoute à la journée du camion. Un moment trop loin des autres arrêts est marqué « loin » et n’est jamais proposé.',
      steps: [
        'Quand tu réserves (ou déplaces), les moments proposés sont ceux qui ajoutent le moins de route.',
        'Dans le calendrier, un moment « loin des autres arrêts » est marqué.',
        'Tu le choisis quand même ? L’app propose des « Plutôt … » avec la route en moins.',
        'Avant de réserver, « Beaucoup de route ce jour-là » demande : « Réserver quand même » ou « Choisir un autre moment ».',
        '« Choisir sur la carte » montre les jours, la route ajoutée et le « Meilleur choix ».'
      ],
      example: 'Un client de Pointe-aux-Trembles veut mardi après-midi. Les deux autres arrêts de mardi sont à Lachine : le moment est « loin ». L’app propose « Plutôt jeudi matin : 48 min de route en moins ».',
      tips: ['Les limites se changent dans Réglages → Réservations (0 = pas de limite).', 'La route est une estimation (« Le calcul de la route », Réglages → Réservations), pas la circulation réelle.'],
      keys: 'loin route garde-route trop de route distance carte choisir meilleur choix plutot beaucoup',
      roads: { tips: ['Les limites se changent dans Réglages → Réservations (0 = pas de limite).', 'La route vient des vraies routes (TomTom), avec la circulation habituelle de l’heure ; sans la clé de TomTom, les vraies rues sans la circulation. Un trajet pas encore mesuré compte le « Trajet inconnu » de Réglages → Réservations.'] }
    },
    en: {
      title: 'Too much driving in a day',
      short: 'The app counts the driving each appointment adds to the truck’s day. A moment too far from the other stops is marked “far” and is never suggested.',
      steps: ['When you book (or move), the moments suggested are the ones that add the least driving.', 'In the calendar, a moment “far from the other stops” is marked.', 'You pick it anyway? The app offers “Rather …” buttons with the driving saved.', 'Before booking, “A lot of driving that day” asks: book anyway, or choose another moment.', '“Choose on the map” shows the days, the driving added and the “Best choice”.'],
      example: 'A customer in Pointe-aux-Trembles wants Tuesday afternoon. Tuesday’s two other stops are in Lachine: the moment is “far”. The app offers “Rather Thursday morning: 48 min less driving”.',
      tips: ['The limits are changed in Settings → Bookings (0 = no limit).', 'The driving is an estimate (“Route estimate”, Settings → Bookings), not real traffic.'],
      keys: 'far driving distance map choose best choice rather too much',
      roads: { tips: ['The limits are changed in Settings → Bookings (0 = no limit).', 'The driving comes from the real roads (TomTom), with the usual traffic of the hour; without TomTom’s key, the real streets without traffic. A drive not measured yet counts the “Unknown drive” of Settings → Bookings.'] }
    }
  },
  {
    id: 'windows', topic: 'booking', roles: ['owner', 'office', 'mechanic'], link: '#/settings/booking',
    fr: {
      title: 'Plages d’arrivée de 4 heures',
      short: 'Au lieu d’un bloc (matin, après-midi, soir), le client reçoit une plage de 4 heures autour de l’heure où l’app pense arriver : 1 heure avant, 3 heures après.',
      steps: [
        'Le propriétaire l’allume dans Réglages → Réservations → « Plages d’arrivée de 4 heures » (« Réserver par plages d’arrivée »). Éteint, l’app garde les blocs.',
        'Quand tu réserves, l’app propose des plages : « entre 14 h et 18 h ». Choisis-en une.',
        'Le client est libre toute la journée ? Choisis « Flexible » : sa plage lui est confirmée la veille.',
        'Sur la job, « Ma journée » et la carte, tu vois l’heure prévue et la plage dite au client.',
        '« Hors plage » : l’arrivée prévue sort de la plage. Appelle le client ou change l’ordre des arrêts.'
      ],
      example: 'L’app pense arriver chez Andre vers 15 h. Elle propose « entre 14 h et 18 h ». Le lendemain, un client s’ajoute : la route est refaite, Andre passe à 16 h 20, toujours dans sa plage. Il n’y a rien à lui dire.',
      tips: [
        'L’app tient chaque plage promise quand elle réorganise une route : elle ne déplace un arrêt que si tout le monde reste dans sa plage.',
        'La plage est large exprès (1 h avant, 3 h après) : ça laisse de la place pour réorganiser.',
        'Les rendez-vous « Flexible » se placent n’importe quand dans la journée : ils aident à mettre plus de rendez-vous dans une journée.',
        'Un arrêt mis à la main dans « Ordre des arrêts », ou réservé « quand même », peut sortir de sa plage.'
      ],
      keys: 'plage plages arrivee fenetre 4 heures entre flexible hors plage veille bloc blocs promesse'
    },
    en: {
      title: '4-hour arrival windows',
      short: 'Instead of a block (morning, afternoon, evening), the customer gets a 4-hour window around the time the app expects to arrive: 1 hour before, 3 hours after.',
      steps: [
        'The owner turns it on in Settings → Bookings → “4-hour arrival windows” (“Book by arrival windows”). Off, the app keeps the blocks.',
        'When you book, the app offers windows: “between 2 and 6 p.m.”. Pick one.',
        'The customer is free all day? Pick “Flexible”: their window is confirmed the day before.',
        'On the job, “My day” and the map, you see the planned time and the window the customer was told.',
        '“Outside the window”: the planned arrival is outside the window. Call the customer or change the order of the stops.'
      ],
      example: 'The app expects to reach Andre around 3 p.m. It offers “between 2 and 6 p.m.”. The next day another customer is added: the route is redone, Andre moves to 4:20, still inside his window. Nothing to tell him.',
      tips: [
        'The app keeps every promised window when it reorders a route: it only moves a stop if everyone stays inside their window.',
        'The window is wide on purpose (1 h before, 3 h after): it leaves room to reorder.',
        '“Flexible” appointments fit anywhere in the day: they help fit more appointments in a day.',
        'A stop ordered by hand in “Order of the stops”, or booked “anyway”, can end up outside its window.'
      ],
      keys: 'window windows arrival 4 hours between flexible outside day before block blocks promise'
    }
  },
  {
    id: 'stop-order', topic: 'booking', roles: ['owner', 'office', 'mechanic'],
    fr: {
      title: 'Changer l’ordre des clients (Mettre en premier)',
      short: 'L’app choisit l’ordre qui roule le moins. Pour passer un client avant les autres : menu « … » de sa job → « Mettre en premier ». Ou « Ordre des arrêts » pour tout réordonner.',
      steps: [
        'Ouvre la job du client.',
        'Rapide : « … » → « Mettre en premier ». C’est fait.',
        'Ou : « Ordre des arrêts » → flèches ⇈ (en premier), ↑, ↓ → « Enregistrer l’ordre ».',
        'Les heures d’arrivée de tout le monde sont recalculées.',
        'Pour revenir à l’ordre de l’app : « Ordre des arrêts » → « Laisser l’app choisir ».'
      ],
      example: 'Mahdi est urgent. Hassan ouvre sa job → « … » → « Mettre en premier ». Mahdi passe 1er vers 15 h 03, Amro passe 2e vers 16 h 08.',
      tips: ['Ceux qui sont en route ou sur place restent toujours en premier.', 'Le propriétaire, le bureau et le mécano du camion peuvent le faire.', 'Avec les plages d’arrivée, l’ordre se choisit pour toute la journée du camion. Attention : un ordre choisi à la main peut faire arriver le camion en dehors de la plage dite à un client. L’app avertit avant d’enregistrer et marque l’arrêt « Hors plage ».'],
      keys: 'ordre premier urgent prioriser avant changer ordre arrets route trier'
    },
    en: {
      title: 'Change the order of customers (Put first)',
      short: 'The app picks the order that drives the least. To put a customer first: their job’s “…” menu → “Put first”. Or “Order of the stops” to reorder everything.',
      steps: ['Open the customer’s job.', 'Quick: “…” → “Put first”. Done.', 'Or: “Order of the stops” → arrows ⇈ (first), ↑, ↓ → “Save the order”.', 'Everybody’s arrival time is worked out again.', 'Back to the app’s order: “Order of the stops” → “Let the app choose”.'],
      example: 'Mahdi is urgent. Hassan opens his job → “…” → “Put first”. Mahdi goes 1st around 3:03, Amro 2nd around 4:08.',
      tips: ['Those on the way or on site always stay first.', 'The owner, the office and the truck’s mechanic can do it.', 'With arrival windows, the order is chosen for the truck’s whole day. Careful: an order chosen by hand can make the truck arrive outside the window a customer was told. The app warns before saving and marks the stop “Outside the window”.'],
      keys: 'order first urgent priority before stops route sort'
    }
  },
  {
    id: 'quote', topic: 'booking', roles: ['owner', 'office', 'mechanic'], link: '#/quote/new',
    fr: {
      title: 'Faire une estimation',
      short: '« + » → « Estimation » : un prix pour le client, sans rendez-vous. Il peut la signer en ligne ; elle peut devenir un rendez-vous.',
      steps: [
        'Touche « + » → « Estimation ».',
        'Ajoute les services et les prix.',
        'Envoie-la au client (texto) : il la voit et peut la signer.',
        'Quand il accepte, réserve le rendez-vous à partir de l’estimation.'
      ],
      example: 'Bassam demande combien pour 4 pneus montés. Le bureau fait une estimation « Montage 4 pneus 18 po, 120 $ », l’envoie par texto. Bassam signe le soir même ; le rendez-vous est pris pour mardi.',
      keys: 'estimation soumission devis prix quote signer'
    },
    en: {
      title: 'Make an estimate',
      short: '“+” → “Estimate”: a price for the customer, without an appointment. They can sign it online; it can become an appointment.',
      steps: ['Tap “+” → “Estimate”.', 'Add the services and prices.', 'Send it to the customer (text): they see it and can sign it.', 'When they accept, book the appointment from the estimate.'],
      example: 'Bassam asks how much for 4 tires mounted. The office makes an estimate “Mount 4 tires 18 in., $120”, texts it. Bassam signs that evening; the appointment is booked for Tuesday.',
      keys: 'estimate quote price sign'
    }
  },

  /* ---------- payments ---------- */
  {
    id: 'pay', topic: 'pay', roles: ['mechanic', 'owner', 'office'],
    fr: {
      title: 'Encaisser un paiement',
      short: '« Encaisser » : choisis Comptant, Débit, Crédit, Virement Interac, Chèque ou Autre, vérifie le montant, puis « Encaisser » avec le montant.',
      steps: [
        'Sur la job (ou la facture), touche « Encaisser ».',
        'Choisis comment le client paie.',
        'Comptant : écris ce qu’il te donne ; l’app calcule la monnaie à rendre.',
        'Interac, chèque, autre : écris la référence si tu l’as.',
        'Touche le bouton « Encaisser 103,47 $ » (le montant est dessus). La facture est « PAYÉE » quand tout est payé.'
      ],
      example: 'Facture de 103,47 $. Le client donne 120 $ comptant. Saleh touche « Comptant », écrit 120 : l’app dit « Rends 16,55 $ » (arrondi au 5 sous). Il touche « Encaisser 103,47 $ ».',
      tips: ['Paiement en deux fois ? Change le montant : le reste demeure à payer.', 'Le client peut aussi payer par carte sur son téléphone si le paiement en ligne est branché.'],
      keys: 'encaisser payer paiement comptant cash debit credit interac cheque monnaie facture payee'
    },
    en: {
      title: 'Take a payment',
      short: '“Take payment”: choose Cash, Debit, Credit, Interac e-Transfer, Cheque or Other, check the amount, then the button with the amount.',
      steps: ['On the job (or invoice), tap “Take payment”.', 'Choose how the customer pays.', 'Cash: type what they give you; the app works out the change.', 'Interac, cheque, other: type the reference if you have it.', 'Tap the button with the amount on it. The invoice is “PAID” once everything is paid.'],
      example: 'Invoice of $103.47. The customer gives $120 cash. Saleh taps “Cash”, types 120: the app says “Give back $16.55” (rounded to 5 cents). He taps the button with $103.47.',
      tips: ['Paying in two parts? Change the amount: the rest stays owed.', 'The customer can also pay by card on their phone if online payment is set up.'],
      keys: 'collect pay payment cash debit credit interac cheque change invoice paid'
    }
  },
  {
    id: 'coffre', topic: 'pay', roles: ['owner', 'mechanic', 'accountant'],
    fr: {
      title: 'Le Coffre (famille et amis)',
      short: 'Pour la famille et les amis : la job n’a ni facture ni taxes et ne va pas dans la trésorerie. Ce qu’ils donnent est noté à part, dans le Coffre.',
      steps: [
        '« Encaisser » → touche la case « Coffre ». Ou menu « … » de la job → « Payé par le Coffre ».',
        'Coche la ou les jobs payées de cette façon.',
        'Écris le montant reçu (0 $ si rien), la date, une note si tu veux.',
        'Touche « Mettre au Coffre ». La facture est annulée (son numéro reste dans les livres).',
        'La job compte comme réglée : tu peux la terminer.'
      ],
      example: 'Oncle Sami fait changer son huile (89,99 $). Il donne 40 $ comme cadeau. Saleh touche « Encaisser » → « Coffre », coche la job, écrit 40 $, note « Oncle Sami ». Pas de taxes, rien dans les revenus.',
      tips: [
        'Tout le monde dans l’équipe peut mettre une job au Coffre. Seul le propriétaire peut en retirer une (erreur).',
        'Le trésorier voit le rapport : Trésorerie → Coffre → Excel ou CSV, à part des revenus.',
        'Une job déjà payée (même en partie) ne peut pas aller au Coffre.'
      ],
      keys: 'coffre famille amis cadeau pourboire sans taxes sans facture rapport comptable'
    },
    en: {
      title: 'The Coffre (family and friends)',
      short: 'For family and friends: the job has no invoice and no taxes and stays out of the treasury. What they give is recorded apart, in the Coffre.',
      steps: ['“Collect” → tap the “Coffre” tile. Or the job’s “…” menu → “Paid by the Coffre”.', 'Tick the job(s) paid this way.', 'Type the amount received ($0 if nothing), the date, a note if you want.', 'Tap “Put in the Coffre”. The invoice is cancelled (its number stays in the books).', 'The job counts as settled: you can finish it.'],
      example: 'Uncle Sami gets an oil change ($89.99). He gives $40 as a gift. Saleh taps “Collect” → “Coffre”, ticks the job, types $40, note “Uncle Sami”. No taxes, nothing in the revenue.',
      tips: ['Everyone on the team can put a job in the Coffre. Only the owner can take one out (mistake).', 'The treasurer sees the report: Treasury → Coffre → Excel or CSV, apart from the revenue.', 'A job already paid (even partly) cannot go in the Coffre.'],
      keys: 'coffre family friends gift tip no taxes no invoice report accountant'
    }
  },
  {
    id: 'pay-later', topic: 'pay', roles: ['owner', 'office'],
    fr: {
      title: 'Laisser un client payer plus tard',
      short: 'Normalement, on encaisse avant de partir. Le propriétaire, ou une personne qui a le droit des factures, peut laisser partir sans paiement (ex. compte d’entreprise).',
      steps: [
        'La facture doit être terminée.',
        'Sous le bouton rouge, touche « Le client paiera plus tard ».',
        '« Laisser partir sans paiement ? » : écris pourquoi (le bureau le verra), puis « Laisser partir ».',
        'La job se termine ; la facture reste à encaisser dans « Factures ».'
      ],
      example: 'Livraisons Express Laval paie à 30 jours. Saleh touche « Le client paiera plus tard », écrit « Compte d’entreprise, 30 jours », puis « Laisser partir ». Il peut partir chez le client suivant.',
      keys: 'payer plus tard paiera laisser partir credit compte entreprise 30 jours dette facture ouverte'
    },
    en: {
      title: 'Let a customer pay later',
      short: 'Normally you collect before leaving. The owner, or someone with the invoices right, can let them go without paying (e.g. a business account).',
      steps: ['The invoice must be finished.', 'Under the red button, tap “The customer will pay later”.', '“Let them go without paying?”: say why (the office will see it), then “Let them go”.', 'The job finishes; the invoice stays to collect in “Invoices”.'],
      example: 'Livraisons Express Laval pays at 30 days. Saleh taps “The customer will pay later”, types “Business account, 30 days”, then “Let them go”. He can leave for the next customer.',
      keys: 'pay later let them go credit business account 30 days open invoice'
    }
  },
  {
    id: 'invoice-cancel', topic: 'pay', roles: ['owner', 'office'],
    fr: {
      title: 'Les numéros de facture et une facture annulée',
      short: 'Chaque facture terminée a un numéro qui se suit, jamais deux fois. Pour corriger une facture, « Modifier la facture » la rouvre et elle garde son numéro.',
      steps: [
        'Une facture en brouillon n’a pas encore de numéro : on peut la changer.',
        'En la terminant, elle reçoit le numéro suivant.',
        'Pour corriger une facture terminée pas encore payée : « Modifier la facture » (voir cette fiche).',
        '« Annuler la facture » (avec la raison) seulement quand elle ne doit plus exister : elle garde son numéro, marquée annulée.'
      ],
      example: 'La facture F-0042 a une erreur de prix. Le bureau touche « Modifier la facture », corrige le prix et la termine de nouveau : elle reste F-0042.',
      keys: 'numero facture annuler corriger brouillon erreur modifier rouvrir'
    },
    en: {
      title: 'Invoice numbers and a cancelled invoice',
      short: 'Each finished invoice gets the next number, never twice. To fix an invoice, “Change the invoice” opens it again and it keeps its number.',
      steps: ['A draft has no number yet: it can be changed.', 'When finished, it gets the next number.', 'To fix a finished invoice not paid yet: “Change the invoice” (see that article).', '“Cancel the invoice” (with the reason) only when it must no longer exist: it keeps its number, marked cancelled.'],
      example: 'Invoice F-0042 has a wrong price. The office taps “Change the invoice”, fixes the price and finishes it again: it stays F-0042.',
      keys: 'invoice number cancel fix draft mistake change reopen'
    }
  },
  {
    id: 'invoice-edit', topic: 'pay', roles: ['owner', 'office', 'mechanic'],
    fr: {
      title: 'Modifier la facture',
      short: 'Une facture terminée, pas encore payée, se corrige sans l’annuler : « Modifier la facture » la rouvre en brouillon et elle garde son numéro.',
      steps: [
        'Ouvre la facture (ou la job) : touche « Modifier la facture », puis encore une fois pour confirmer.',
        'Change ce qu’il faut : une ligne, un prix, un travail à retirer.',
        'Termine-la de nouveau : elle garde son numéro.',
        'Le client avait déjà reçu l’ancienne ? Renvoie-la par texto.'
      ],
      example: 'Facture F-0042 : le filtre est compté deux fois. Nadia touche « Modifier la facture », retire la ligne en trop et termine la facture : toujours F-0042, 12 $ de moins. Elle la renvoie au client.',
      tips: ['Possible tant que la facture n’est pas payée et que la job n’est pas finie.', 'Un paiement déjà reçu attend sur la job ; le nouveau total ne peut pas être plus bas que ce qui est payé.', 'Pour retirer un travail déjà facturé (bouton « Modifier le travail »), rouvre d’abord la facture.'],
      keys: 'modifier facture corriger rouvrir erreur prix ligne retirer brouillon numero'
    },
    en: {
      title: 'Change the invoice',
      short: 'A finished invoice not paid yet is fixed without cancelling it: “Change the invoice” opens it again as a draft and it keeps its number.',
      steps: ['Open the invoice (or the job): tap “Change the invoice”, then once more to confirm.', 'Change what you need: a line, a price, work to take off.', 'Finish it again: it keeps its number.', 'The customer already got the old one? Send it again by text.'],
      example: 'Invoice F-0042: the filter is counted twice. Nadia taps “Change the invoice”, removes the extra line and finishes the invoice: still F-0042, $12 less. She sends it to the customer again.',
      tips: ['Possible while the invoice is not paid and the job is not finished.', 'A payment already received waits on the job; the new total cannot be lower than what was paid.', 'To take off work already billed (the “Edit the work” button), open the invoice again first.'],
      keys: 'change invoice fix reopen mistake price line remove draft number'
    }
  },

  /* ---------- customers ---------- */
  {
    id: 'customer-add', topic: 'customers', roles: ['owner', 'office', 'mechanic'], link: '#/customer/new',
    fr: {
      title: 'Ajouter un client et ses véhicules',
      short: '« + » → « Nouveau client » : nom, téléphone, adresse, et son véhicule si tu le connais : l’année, la marque, le modèle, ou le NIV.',
      steps: [
        'Touche « + » → « Nouveau client ».',
        'Écris le nom, le téléphone et l’adresse (choisis-la dans la liste pour qu’elle soit sur la carte).',
        '« Son véhicule (facultatif) » : choisis l’année, puis la marque, puis le modèle. Ou scanne le NIV.',
        'Tu connais son dernier changement d’huile ? Écris-le dans « Dernier changement d’huile » : l’app saura quand le rappeler.',
        '« Créer et réserver » ouvre la réservation avec cette auto déjà choisie.'
      ],
      example: 'Nouveau client : Karim, 1200 rue Sauvé. Véhicule : 2015, Honda, Civic. Dernier changement d’huile : en août. « Créer et réserver » : la Civic est déjà choisie.',
      tips: ['Tu peux ajouter une autre voiture plus tard depuis sa fiche : « Ajouter un véhicule ».'],
      keys: 'client nouveau ajouter voiture vehicule annee marque modele niv huile adresse telephone fiche'
    },
    en: {
      title: 'Add a customer and their vehicles',
      short: '“+” → “New customer”: name, phone, address, and their vehicle if you know it: the year, the make, the model, or the VIN.',
      steps: ['Tap “+” → “New customer”.', 'Type the name, phone and address (pick it in the list so it is on the map).', '“Their vehicle (optional)”: pick the year, then the make, then the model. Or scan the VIN.', 'You know their last oil change? Type it in “Last oil change”: the app will know when to call them.', '“Create and book” opens the booking with that car already chosen.'],
      example: 'New customer: Karim, 1200 rue Sauvé. Vehicle: 2015, Honda, Civic. Last oil change: in August. “Create and book”: the Civic is already chosen.',
      tips: ['You can add another car later from their file: “Add a vehicle”.'],
      keys: 'customer new add car vehicle year make model vin oil address phone'
    }
  },
  {
    id: 'conversation', topic: 'customers', roles: ['owner', 'office', 'mechanic'],
    fr: {
      title: 'Écrire au client (Conversation)',
      short: '« Conversation » montre les textos échangés avec le client et permet de lui répondre, depuis le numéro du garage. Pas besoin de l’app GoHighLevel.',
      steps: [
        'Sur la job (à côté d’« Appeler ») ou dans la fiche du client, touche « Conversation ».',
        'Tu vois les messages envoyés et reçus.',
        'Écris ta réponse, touche « Envoyer ». Elle part du numéro du garage.'
      ],
      example: 'Andre écrit « Je serai là dans 10 min, attendez SVP ». Saleh ouvre « Conversation » sur la job, répond « Pas de problème, j’attends devant ».',
      tips: ['La liste se met à jour toute seule aux 20 secondes.', 'Si le client a refusé les textos, on ne peut pas lui écrire.'],
      keys: 'conversation texto sms message ecrire repondre ghl gohighlevel client'
    },
    en: {
      title: 'Text the customer (Conversation)',
      short: '“Conversation” shows the texts with the customer and lets you answer from the garage’s number. No GoHighLevel app needed.',
      steps: ['On the job (next to “Call”) or in the customer’s file, tap “Conversation”.', 'You see the messages sent and received.', 'Type your answer, tap “Send”. It goes from the garage’s number.'],
      example: 'Andre writes “I’ll be there in 10 min, please wait”. Saleh opens “Conversation” on the job and answers “No problem, I’m waiting outside”.',
      tips: ['The list refreshes by itself every 20 seconds.', 'If the customer refused texts, you cannot write to them.'],
      keys: 'conversation text sms message write answer ghl gohighlevel customer'
    }
  },
  {
    id: 'texts-in', topic: 'customers', roles: ['owner'], link: '#/settings/connect',
    fr: {
      title: 'Les textos des clients (Texto entrant)',
      short: 'Quand un client texte le numéro du garage, une bulle s’ouvre en bas de l’écran, comme un messenger : tu lis et tu réponds du numéro du garage.',
      steps: [
        'Le propriétaire l’allume pour son compte : Réglages → Branchements → « Recevoir les textos dans mon compte ».',
        'Sur l’ordinateur, la petite fenêtre s’ouvre. Sur le téléphone, une tête ronde arrive avec quelques mots.',
        'Écris ta réponse et envoie : elle part du numéro du garage.',
        '« Réduire » : une tête ronde avec le nombre de nouveaux textos. « Fermer » : partie jusqu’au prochain texto de ce numéro.',
        'Plus de conversations que de place ? La dernière tête dit « +3 » : touche-la pour ouvrir la suivante.'
      ],
      example: 'Lara texte « Avez-vous une place demain ? ». La fenêtre s’ouvre sur l’ordinateur de Hassan. Il touche « Réserver pour ce numéro », réserve, puis répond « C’est fait : demain entre 8 h et 12 h ».',
      tips: ['Être averti même app fermée : « M’avertir quand l’app est fermée » (sur chaque téléphone ; un iPhone doit avoir l’app sur l’écran d’accueil).', 'En te déconnectant, l’avertissement s’arrête sur cet appareil : rallume-le en revenant.', '« Essayer » envoie un texto d’essai : on ne peut pas y répondre.'],
      keys: 'texto entrant sms bulle messenger client repondre numero garage ghl gohighlevel avertir notification'
    },
    en: {
      title: 'Texts from customers (Incoming text)',
      short: 'When a customer texts the garage’s number, a bubble opens at the bottom of the screen, like a messenger: you read and answer from the garage’s number.',
      steps: ['The owner turns it on for their account: Settings → Connections → “Get the texts in my account”.', 'On a computer, the small window opens. On a phone, a round head comes with a few words.', 'Type your answer and send: it goes from the garage’s number.', 'Minimise: a round head with the number of new texts. Close: gone until that number texts again.', 'More conversations than room? The last head says “+3”: tap it to open the next one.'],
      example: 'Lara texts “Do you have a spot tomorrow?”. The window opens on Hassan’s computer. He taps “Book for this number”, books, then answers “Done: tomorrow between 8 and noon”.',
      tips: ['To be told even with the app closed: “Alert me when the app is closed” (on each phone; an iPhone needs the app on its home screen).', 'Signing out stops the alert on that device: turn it on again when you come back.', '“Try it” sends a test text: it can’t be answered.'],
      keys: 'incoming text sms bubble messenger customer answer number garage ghl gohighlevel alert notification'
    }
  },
  {
    id: 'oil', topic: 'customers', roles: ['owner', 'office'], link: '#/oil',
    fr: {
      title: 'Les rappels d’huile',
      short: '« Rappels d’huile » liste les autos dues pour un changement d’huile, à appeler : 6 mois après un changement d’huile, 3 mois après une visite sans huile.',
      steps: [
        'Ouvre « Rappels d’huile » (tuile dans « Plus »).',
        '« À appeler » : les autos dues. « Bientôt » : dans les 30 jours. « Tous » : toutes les autos suivies.',
        'Touche une auto : appeler, texter, ou réserver (l’auto est déjà choisie).',
        'Après l’appel : « Rappeler dans 1 semaine », « 1 mois », « 3 mois », ou « Ne plus appeler pour cette auto ».'
      ],
      example: 'Julie a eu son changement d’huile le 15 mai. Le 15 novembre, sa Civic est dans « À appeler ». Nadia l’appelle : Julie réserve pour la semaine suivante. Sa Civic sort de la liste.',
      tips: ['Une auto qui a déjà un rendez-vous avec un changement d’huile n’est pas listée.', 'Le client connaît son dernier changement fait ailleurs ? Écris-le dans « Dernier changement d’huile » de son auto.'],
      keys: 'huile rappel rappels appeler changement d huile vidange 6 mois 3 mois relance'
    },
    en: {
      title: 'Oil reminders',
      short: '“Oil reminders” lists the cars due for an oil change, to call: 6 months after an oil change, 3 months after a visit without oil.',
      steps: ['Open “Oil reminders” (a tile in “More”).', '“To call”: the cars due. “Soon”: within 30 days. “All”: every car followed.', 'Tap a car: call, text, or book (the car already chosen).', 'After the call: “Call back in 1 week”, “1 month”, “3 months”, or “Stop calling for this car”.'],
      example: 'Julie had her oil change on May 15. On November 15, her Civic is in “To call”. Nadia calls her: Julie books for the next week. Her Civic leaves the list.',
      tips: ['A car that already has an appointment with an oil change is not listed.', 'The customer knows their last oil change done elsewhere? Type it in their car’s “Last oil change”.'],
      keys: 'oil reminder call oil change 6 months 3 months follow up'
    }
  },

  /* ---------- map ---------- */
  {
    id: 'map', topic: 'map', roles: ['owner', 'office'], link: '#/map',
    fr: {
      title: 'La carte de l’équipe',
      short: 'La carte montre les arrêts du jour de chaque camion (numérotés), la route, et où sont les mécanos.',
      steps: [
        'Ouvre « Carte ».',
        'Chaque camion a sa couleur ; les arrêts sont numérotés dans l’ordre.',
        'Le mécano apparaît avec son nom : « à l’instant », « il y a 3 min », ou « Au travail chez Mahdi ».',
        'Touche un camion dans la liste pour ne voir que sa route.',
        'Hier, Aujourd’hui, Demain : en haut.'
      ],
      example: 'Hassan ouvre la carte à 15 h 30 : « Saleh — Au travail chez Mahdi ». Les arrêts 2 et 3 attendent ; l’arrivée chez Amro est prévue vers 16 h 08.',
      tips: ['« Dernière position il y a 40 min » en pâle : son app n’est pas ouverte depuis un moment (téléphone dans la poche en roulant).'],
      keys: 'carte map position mecano ou est saleh camion route arrets gps'
    },
    en: {
      title: 'The team map',
      short: 'The map shows each truck’s stops of the day (numbered), the route, and where the mechanics are.',
      steps: ['Open “Map”.', 'Each truck has its colour; stops are numbered in order.', 'The mechanic shows with their name: “just now”, “3 min ago”, or “Working at Mahdi’s”.', 'Tap a truck in the list to see only its route.', 'Yesterday, Today, Tomorrow: at the top.'],
      example: 'Hassan opens the map at 3:30: “Saleh — Working at Mahdi’s”. Stops 2 and 3 are waiting; arrival at Amro’s is expected around 4:08.',
      tips: ['“Last position 40 min ago” in pale: their app has not been open for a while (phone in the pocket while driving).'],
      keys: 'map location mechanic where truck route stops gps'
    }
  },
  {
    id: 'overview', topic: 'map', roles: ['owner', 'office'], link: '#/overview',
    fr: {
      title: 'La Vue d’ensemble',
      short: 'Les rendez-vous d’aujourd’hui et la carte, sur un seul écran.',
      steps: ['Ouvre « Vue d’ensemble ».', 'À gauche (ou en haut) : la liste des rendez-vous du jour et leur état.', 'La carte montre les arrêts et les mécanos. Touche un arrêt pour le voir dans la liste.'],
      example: 'Le bureau garde la Vue d’ensemble ouverte toute la journée : il voit Amro « Terminé », Mahdi « Sur place », Andre « Réservé, vers 16 h 30 ».',
      keys: 'vue ensemble aujourd hui liste carte tableau'
    },
    en: {
      title: 'The Overview',
      short: 'Today’s appointments and the map, on one screen.',
      steps: ['Open “Overview”.', 'On the left (or top): today’s appointments and their state.', 'The map shows stops and mechanics. Tap a stop to see it in the list.'],
      example: 'The office keeps the Overview open all day: Amro “Done”, Mahdi “On site”, Andre “Booked, around 4:30”.',
      keys: 'overview today list map board'
    }
  },
  {
    id: 'truck-start', topic: 'map', roles: ['owner', 'office', 'mechanic'], link: '#/hours',
    fr: {
      title: 'Changer le point de départ d’un camion',
      short: 'Chaque camion part de la Centrale, ou de son propre départ (ex. la maison du mécano). Les routes se refont toutes seules.',
      steps: [
        'Ouvre « Horaires » → le camion → « Départ de ce camion ».',
        'Choisis l’adresse dans la liste.',
        'Enregistre. Les rendez-vous à venir sont replanifiés à partir de ce point.'
      ],
      example: 'Saleh part de chez lui à Laval. Hassan met « Départ de ce camion : 300 boul. Saint-Martin, Laval ». Le premier client du matin devient celui le plus proche de Laval.',
      tips: ['L’après-midi part du dernier client du matin ; chaque bloc essaie de finir près du premier client du bloc suivant.', 'Avec les plages d’arrivée, il n’y a qu’une route par jour : elle part d’ici le matin.'],
      keys: 'depart point camion maison centrale adresse route horaires'
    },
    en: {
      title: 'Change where a truck leaves from',
      short: 'Each truck leaves from the Centrale, or from its own start (e.g. the mechanic’s home). Routes are redone by themselves.',
      steps: ['Open “Hours” → the truck → “Where this truck leaves from”.', 'Pick the address in the list.', 'Save. Coming appointments are re-planned from there.'],
      example: 'Saleh leaves from home in Laval. Hassan sets “300 boul. Saint-Martin, Laval”. The first morning customer becomes the one closest to Laval.',
      tips: ['The afternoon leaves from the last morning customer; each block tries to end near the first customer of the next block.', 'With arrival windows, there is one route a day: it leaves from here in the morning.'],
      keys: 'start point truck home centrale address route hours'
    }
  },

  /* ---------- office ---------- */
  {
    id: 'hours', topic: 'office', roles: ['owner', 'office'], link: '#/hours',
    fr: {
      title: 'Les horaires des camions (fermer une journée)',
      short: 'Dans « Horaires », chaque camion a ses heures par jour de la semaine. Un jour fermé ne prend plus de rendez-vous.',
      steps: [
        'Ouvre « Horaires » et choisis le camion.',
        'Change les heures d’un jour, ou ferme-le.',
        'Applique : pour ce jour seulement, quelques semaines, ou à partir de maintenant.',
        'Des rendez-vous tombent dans les heures fermées ? Une feuille les montre : « Déplacer vers le camion » (l’autre véhicule, même jour, même bloc) ou « Fermer sans déplacer » (ils vont dans « À placer »).'
      ],
      example: 'Saleh est en congé vendredi. Hassan ferme la Voiture vendredi. La feuille montre 3 rendez-vous : « Déplacer vers le camion ». Un ne rentre pas : il reste « À placer » et Hassan appelle le client.',
      keys: 'horaires heures conge fermer jour camion voiture semaine a placer deplacer'
    },
    en: {
      title: 'Truck hours (closing a day)',
      short: 'In “Hours”, each truck has its hours per weekday. A closed day takes no appointments.',
      steps: ['Open “Hours” and pick the truck.', 'Change a day’s hours, or close it.', 'Apply: that day only, a few weeks, or from now on.', 'Appointments in the closed hours? A sheet shows them: move them to the other vehicle (same day, same block), or close without moving (they go to “To place”).'],
      example: 'Saleh is off Friday. Hassan closes the car on Friday. The sheet shows 3 appointments: he moves them to the truck. One does not fit: it stays “To place” and Hassan calls the customer.',
      keys: 'hours schedule day off close truck car week to place move'
    }
  },
  {
    id: 'treasury', topic: 'office', roles: ['owner', 'accountant'], link: '#/treasury',
    fr: {
      title: 'La Trésorerie et le rapport du comptable',
      short: 'La Trésorerie montre les revenus, les taxes (TPS, TVQ) et les dépenses d’une période. Le comptable l’exporte en Excel ou CSV.',
      steps: [
        'Ouvre « Trésorerie ».',
        'Choisis la période (mois, trimestre, année, ou des dates).',
        'Ajoute une dépense : « + » → « Dépense ou reçu », photo du reçu, montant, catégorie.',
        'Exporte le rapport pour le comptable.',
        'Le Coffre a son propre rapport (Trésorerie → Coffre), à part.'
      ],
      example: 'Fin octobre, le comptable ouvre la Trésorerie, choisit « Octobre » et télécharge l’Excel : revenus, TPS, TVQ, dépenses (essence, huile, filtres).',
      keys: 'tresorerie comptable revenus taxes tps tvq depenses recu rapport excel csv'
    },
    en: {
      title: 'The Treasury and the accountant’s report',
      short: 'The Treasury shows revenue, taxes (GST, QST) and expenses for a period. The accountant exports it to Excel or CSV.',
      steps: ['Open “Treasury”.', 'Pick the period (month, quarter, year, or dates).', 'Add an expense: “+” → “Expense or receipt”, photo, amount, category.', 'Export the report for the accountant.', 'The Coffre has its own report (Treasury → Coffre), apart.'],
      example: 'End of October, the accountant opens the Treasury, picks “October” and downloads the Excel: revenue, GST, QST, expenses (gas, oil, filters).',
      keys: 'treasury accountant revenue taxes gst qst expenses receipt report excel csv'
    }
  },
  {
    id: 'inventory', topic: 'office', roles: ['owner', 'office', 'mechanic'], link: '#/needs',
    fr: {
      title: 'L’inventaire et les besoins de la semaine',
      short: '« Besoins de la semaine » liste l’huile, les filtres et les pièces que les rendez-vous vont demander. « Ajouter … pièces à l’inventaire » crée ce qui manque.',
      steps: [
        'Ouvre « Inventaire » → « Besoins de la semaine ».',
        'Tu vois, pour la semaine : les litres d’huile par grade, les filtres, les pièces.',
        'Le bouton « Ajouter 3 pièces à l’inventaire » (le nombre change) crée les articles qui n’existent pas encore.',
        'Tu achètes du stock ? Dans l’article, « Entrée » : la quantité, le total payé et « Payé par » (Rien, Trésorerie ou Coffre).',
        'À « Terminer la job », le mécano confirme les « Pièces utilisées » : seulement celles-là sortent de l’inventaire.'
      ],
      example: 'Lundi matin, Saleh ouvre les besoins : 22 L de 0W-20, 9 L de 5W-30, 5 filtres. Il achète 20 L d’huile : « Entrée », 20, 154 $, payé par la Trésorerie (la dépense « Pièces » se fait toute seule).',
      tips: ['Le Coffre a son propre stock : « Garage / Coffre » en haut de l’inventaire.'],
      keys: 'inventaire besoins semaine huile filtres pieces stock fournisseur entree achat coffre'
    },
    en: {
      title: 'Inventory and the week’s needs',
      short: '“Needs of the week” lists the oil, filters and parts the appointments will need. “Add … parts to the inventory” creates what is missing.',
      steps: ['Open “Inventory” → “Needs of the week”.', 'You see for the week: litres of oil per grade, filters, parts.', 'The button “Add 3 parts to the inventory” (the number changes) creates the items that do not exist yet.', 'Buying stock? In the item, “Entry”: the quantity, the total paid and “Paid by” (Nothing, Treasury or Coffre).', 'At “Finish the job”, the mechanic confirms the “Parts used”: only those come off the inventory.'],
      example: 'Monday morning, Saleh opens the needs: 22 L of 0W-20, 9 L of 5W-30, 5 filters. He buys 20 L of oil: “Entry”, 20, $154, paid by the Treasury (the “Parts” expense is made by itself).',
      tips: ['The Coffre has its own stock: “Garage / Coffre” at the top of the inventory.'],
      keys: 'inventory needs week oil filters parts stock supplier buy coffre'
    }
  },
  {
    id: 'offline', topic: 'office', roles: ['mechanic', 'owner', 'office'],
    fr: {
      title: 'Sans réseau',
      short: 'Pas de réseau ? Continue : l’app garde ce que tu fais et l’envoie dès que le réseau revient.',
      steps: [
        'Fais tes étapes comme d’habitude : signature, facture et encaisser marchent aussi.',
        'Un message dit « Gardé sur le téléphone : ça part dès que le réseau revient. »',
        'Une pastille « Hors ligne » ou « 3 à envoyer » montre ce qui attend. Quand tout est envoyé, elle disparaît.',
        'Si le serveur refuse quelque chose, un bandeau rouge l’explique.'
      ],
      example: 'Dans un sous-sol, Saleh n’a pas de réseau. Il touche « Je suis arrivé », prend la signature et encaisse. En sortant, le téléphone retrouve le réseau et tout est envoyé.',
      tips: ['Les textos aux clients, les moments proposés quand on réserve et la carte en direct ont besoin du réseau : ils reviennent avec lui.'],
      keys: 'reseau internet hors ligne offline signal sous-sol envoye garde telephone'
    },
    en: {
      title: 'No signal',
      short: 'No signal? Keep going: the app keeps what you do and sends it as soon as the signal is back.',
      steps: ['Do your steps as usual: the signature, the invoice and payment work too.', 'A message says it is kept on the phone and goes out as soon as the signal is back.', 'An “Offline” or “3 to send” chip shows what is waiting. Once everything is sent, it goes away.', 'If the server refuses something, a red banner explains it.'],
      example: 'In a basement, Saleh has no signal. He taps “I’ve arrived”, gets the signature and takes the payment. Outside, the phone finds the signal and everything is sent.',
      tips: ['Texts to customers, the moments offered when booking and the live map need the signal: they come back with it.'],
      keys: 'signal internet offline network basement sent kept phone'
    }
  },

  /* ---------- setup ---------- */
  {
    id: 'team', topic: 'setup', roles: ['owner'], link: '#/team',
    fr: {
      title: 'Inviter un mécano et ses droits',
      short: 'Dans « Équipe », invite une personne avec son rôle (mécano, bureau, trésorier). Elle reçoit un lien pour choisir son mot de passe.',
      steps: [
        'Ouvre « Équipe » → « Inviter quelqu’un ».',
        'Écris son nom, son courriel, son rôle ; pour un mécano, son camion.',
        'Envoie l’invitation : elle choisit son mot de passe avec le lien.',
        'Les droits de chaque rôle et de chaque personne se changent dans « Équipe ».'
      ],
      example: 'Hassan engage Adam. Il l’invite comme mécano, camion « Voiture ». Adam ouvre le lien, choisit son mot de passe, et voit « Ma journée » avec ses rendez-vous.',
      keys: 'equipe inviter employe mecano droits roles acces mot de passe compte'
    },
    en: {
      title: 'Invite a mechanic and their rights',
      short: 'In “Team”, invite someone with their role (mechanic, office, treasurer). They get a link to choose a password.',
      steps: ['Open “Team” → “Invite someone”.', 'Type their name, email, role; for a mechanic, their truck.', 'Send the invitation: they choose a password with the link.', 'The rights of each role and each person are changed in “Team”.'],
      example: 'Hassan hires Adam. He invites him as a mechanic, truck “Voiture”. Adam opens the link, chooses his password, and sees “My day” with his appointments.',
      keys: 'team invite employee mechanic rights roles access password account'
    }
  },
  {
    id: 'texts-settings', topic: 'setup', roles: ['owner'], link: '#/settings/texts',
    fr: {
      title: 'Les textos envoyés aux clients',
      short: 'Dans « Réglages », choisis quels textos partent (confirmation, en route, arrivé, facture, rappel…) et change leurs mots.',
      steps: [
        'Ouvre « Réglages » → « Textos ».',
        'Active ou désactive chaque texto.',
        'Change le texte : les mots entre accolades se remplacent tout seuls ({prenom}, {heure}, {lien}…).'
      ],
      example: 'Hassan veut un ton plus chaleureux : il change le texto « en route » en « Salut {prenom} ! {mecano} s’en vient, arrivée vers {heure}. Suis-le ici : {lien} ».',
      keys: 'textos sms messages reglages modeles confirmation rappel activer'
    },
    en: {
      title: 'The texts sent to customers',
      short: 'In “Settings”, choose which texts go out (confirmation, on the way, arrived, invoice, reminder…) and change their words.',
      steps: ['Open “Settings” → “Texts”.', 'Turn each text on or off.', 'Change the text: the words in braces are filled in by themselves ({prenom}, {heure}, {lien}…).'],
      example: 'Hassan wants a warmer tone: he changes the “on the way” text to “Hi {prenom}! {mecano} is coming, around {heure}. Follow here: {lien}”.',
      keys: 'texts sms messages settings templates confirmation reminder'
    }
  },
  {
    id: 'install', topic: 'setup', roles: ['mechanic', 'owner', 'office', 'accountant'], link: '#/guide',
    fr: {
      title: 'Installer l’app et la mettre à jour',
      short: 'L’app s’ouvre dans le navigateur, mais tu peux l’ajouter à l’écran d’accueil comme une vraie app. Elle se met à jour toute seule.',
      steps: [
        'iPhone : ouvre l’app dans Safari, touche Partager → « Sur l’écran d’accueil ».',
        'Android : dans Chrome, menu ⋮ → « Installer l’app ».',
        'Ouvre-la ensuite depuis l’icône H.I.S.',
        'Une nouvelle version ? Un avis le dit. Pour vérifier toi-même : « Mon compte » → « Vérifier les mises à jour ».'
      ],
      example: 'Saleh ouvre le lien dans Safari, Partager → « Sur l’écran d’accueil ». L’icône H.I.S est maintenant à côté de ses autres apps.',
      tips: ['« Par où commencer » montre ces étapes pour ton téléphone.'],
      keys: 'installer telephone iphone android ecran accueil icone mise a jour nouvelle version verifier'
    },
    en: {
      title: 'Install the app and update it',
      short: 'The app opens in the browser, but you can add it to the home screen like a real app. It updates by itself.',
      steps: ['iPhone: open the app in Safari, tap Share → “Add to Home Screen”.', 'Android: in Chrome, menu ⋮ → “Install app”.', 'Then open it from the H.I.S icon.', 'A new version? A notice says so. To check yourself: “My account” → “Check for updates”.'],
      example: 'Saleh opens the link in Safari, Share → “Add to Home Screen”. The H.I.S icon is now next to his other apps.',
      tips: ['“Where to start” shows these steps for your phone.'],
      keys: 'install phone iphone android home screen icon update new version check'
    }
  },
];
