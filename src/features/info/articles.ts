/* « Info »: every procedure of the app, in simple words, with an example. Searchable (search.ts).
   Each article: its subject, who it is for, a short answer, the steps (the real names of the buttons), an example
   from a real-looking day, tips, and words people may type to find it. French and English. */

export type InfoTopic = 'day' | 'booking' | 'pay' | 'customers' | 'map' | 'office' | 'setup';
export const INFO_TOPICS: InfoTopic[] = ['day', 'booking', 'pay', 'customers', 'map', 'office', 'setup'];
export type InfoRole = 'owner' | 'office' | 'mechanic' | 'accountant';

export interface InfoText { title: string; short: string; steps: string[]; example: string; tips?: string[]; keys?: string }
export interface InfoArticle { id: string; topic: InfoTopic; roles: InfoRole[]; link?: string; fr: InfoText; en: InfoText }

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
      short: 'In the morning, tap « Start my day ». At night, « End my day ». In between, the office sees where you are.',
      steps: [
        'Open the app: the « Today » screen shows your appointments of the day, in order.',
        'Tap « Start my day ». Allow the phone to share your location.',
        'Do your jobs one after the other (see « A job from start to finish »).',
        'At night, tap « End my day »: your location is no longer sent.'
      ],
      example: 'Saleh gets to the truck at 7:50. He opens the app, taps « Start my day » and sees: 1. Amro at 8:20, 2. Andre at 12:15. The office now sees him on the map.',
      tips: ['The location is sent only while the app is open on the screen (about once a minute).', 'While you work at a customer’s, the map shows you there, even if your phone sleeps.'],
      keys: 'start end day shift location morning night'
    }
  },
  {
    id: 'job-flow', topic: 'day', roles: ['mechanic', 'owner'],
    fr: {
      title: 'Une job du début à la fin',
      short: 'Le gros bouton rouge de la job te dit toujours quoi faire ensuite : Je pars, Je suis arrivé, la signature, la facture, encaisser, terminer.',
      steps: [
        '« Je pars » : le client reçoit un texto avec ton heure d’arrivée et un lien pour suivre le camion.',
        '« Je suis arrivé » : la job passe « Sur place ».',
        '« Faire signer l’autorisation » : le client signe sur ton téléphone, avant le travail.',
        'Si tu trouves autre chose à faire, ajoute-le (voir « Proposer des travaux en plus »).',
        '« Faire la facture » : elle se fait à partir du travail. Vérifie les lignes, puis termine-la.',
        '« Encaisser » : choisis comment le client paie (voir « Encaisser un paiement »).',
        '« Terminer la job » : c’est fini, tu peux passer au client suivant.'
      ],
      example: 'Chez Mahdi : Saleh touche « Je pars » à 14 h 40 (Mahdi reçoit « arrivée vers 15 h 03 »). À 15 h 05 : « Je suis arrivé ». Mahdi signe. Changement d’huile fait. « Faire la facture » : 103,47 $. « Encaisser » : comptant. « Terminer la job ».',
      tips: [
        'Une erreur ? Menu « … » de la job → « Défaire la dernière étape ».',
        'Tu ne peux pas partir chez le client suivant tant que la job d’avant n’est pas payée (sauf si le bureau a permis « payer plus tard »).',
        'Le bouton rouge demande la signature avant « Terminer ». Si la job reste « Sur place », c’est souvent que l’autorisation n’est pas signée.'
      ],
      keys: 'je pars arrive signature autorisation facture encaisser terminer etapes bouton rouge sur place'
    },
    en: {
      title: 'A job from start to finish',
      short: 'The big red button of the job always tells you what is next: I’m leaving, I’ve arrived, the signature, the invoice, collect, finish.',
      steps: [
        '« I’m leaving »: the customer gets a text with your arrival time and a link to follow the truck.',
        '« I’ve arrived »: the job goes « On site ».',
        '« Have the authorization signed »: the customer signs on your phone, before the work.',
        'Found something else to do? Add it (see « Propose extra work »).',
        '« Make the invoice »: it is made from the work. Check the lines, then finish it.',
        '« Collect »: choose how the customer pays (see « Take a payment »).',
        '« Finish the job »: done, on to the next customer.'
      ],
      example: 'At Mahdi’s: Saleh taps « I’m leaving » at 2:40 (Mahdi gets « arriving around 3:03 »). At 3:05: « I’ve arrived ». Mahdi signs. Oil change done. « Make the invoice »: $103.47. « Collect »: cash. « Finish the job ».',
      tips: ['A mistake? The job’s « … » menu → « Undo the last step ».', 'You cannot leave for the next customer while the job before is unpaid (unless the office allowed « pay later »).', 'The red button asks for the signature before « Finish ». A job stuck « On site » is often an unsigned authorization.'],
      keys: 'leave arrived signature authorization invoice collect finish steps red button on site'
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
      title: 'The « on the way » text and truck tracking',
      short: 'When you tap « I’m leaving », the customer gets a text with the arrival time and a link. The link opens a simple, Uber-style map with the minutes left.',
      steps: ['Tap « I’m leaving » on the job.', 'The customer gets: « Saleh from Mécanique Mobile H.I.S is on the way: arriving around 3:03 (about 14 min). Follow the trip: [link] ».', 'The link shows the truck, the route, the minutes left and a button to call the garage.', 'Tracking stops by itself when you tap « I’ve arrived ».'],
      example: 'Andre gets the text at 12:01. He opens the link: « 14 min, arriving around 12:15 ». He sees the little black truck getting closer to his house.',
      tips: ['Lost text? The job’s « … » menu → « Send the « on the way » text again » (a new link).', 'The link only works during the trip (a few hours at most).'],
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
      example: 'Amro’s job: « 2018 Toyota Corolla 1.8 L ». Oil 0W-20, 4.4 L, filter 04152-YZZA6. Work: oil change, tire rotation.',
      tips: ['« To confirm » means the info comes from the engine list, not a checked sheet: have a look before pouring the oil.'],
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
      steps: ['In the job, add the work (the service and its price).', 'Choose to propose it to the customer.', 'The big button becomes « Have the customer answer »: they tap Accept or Refuse.', 'Accepted: the line goes on the invoice. Refused: nothing is billed.'],
      example: 'During Andre’s oil change, Saleh sees worn brake pads. He proposes « Front pads, $189 ». Andre accepts on the phone: the invoice goes from $89.99 to $278.99 before taxes.',
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
      tips: ['Erreur ? Le bureau peut « Rouvrir la job » : elle revient à l’agenda, au même bloc.'],
      keys: 'annuler absent no show personne rouvrir annulation'
    },
    en: {
      title: 'Cancel a job or « No-show »',
      short: 'The job’s « … » menu: « Cancel the job » frees the block; « No-show » records the absence on their file.',
      steps: ['Open the job, tap « … » at the top right.', '« Cancel the job » (before the work): say why. The block frees up.', 'Or « No-show »: nobody there. It counts on their file.', 'The customer is not told automatically: call them.'],
      example: 'Saleh gets to Ola’s: nobody, no answer after 10 minutes. He taps « … » → « No-show » → « Nobody, no answer ». On to the next customer.',
      tips: ['A mistake? The office can « Reopen the job »: it goes back on the agenda, same block.'],
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
      short: 'Red « + » button → « Walk-in customer »: the job starts now, on your truck.',
      steps: ['Tap the red « + » at the bottom.', 'Choose « Walk-in customer ».', 'Pick or create the customer, their vehicle and the work.', 'The job opens « On site »: carry on like a normal job (signature, invoice, collect).'],
      example: 'While at Amro’s, the neighbour asks for an oil change. Saleh taps « + » → « Walk-in customer », creates « Karim », his 2015 Civic, « Oil change ». He does it right away.',
      keys: 'walk-in without appointment neighbour now new'
    }
  },

  /* ---------- appointments ---------- */
  {
    id: 'book', topic: 'booking', roles: ['owner', 'office', 'mechanic'], link: '#/book',
    fr: {
      title: 'Réserver un rendez-vous',
      short: '« + » → « Réserver un rendez-vous » : le client, sa voiture, les services, puis un bloc (matin, après-midi ou soir). L’app place le client sur un camion et calcule l’heure.',
      steps: [
        'Touche le « + » rouge → « Réserver un rendez-vous ».',
        'Cherche le client (ou crée-le).',
        'Choisis sa voiture (ou ajoute-la, voir « Ajouter un client et ses véhicules »).',
        'Coche les services. La durée se calcule ; tu peux la changer.',
        'Choisis un bloc : l’app propose les meilleurs (là où un camion passe déjà près).',
        'Touche « Réserver ». Le client reçoit un texto de confirmation.'
      ],
      example: 'Andre appelle pour un changement d’huile demain après-midi. Le bureau tape « Andre », choisit sa Sienna, coche « Changement d’huile », choisit « Demain, après-midi » et réserve. Andre reçoit : « Rendez-vous demain entre 12 h et 16 h, total prévu 103,47 $ ».',
      tips: ['L’heure exacte est calculée par l’app (la route la plus courte). Le client a le bloc ; il reçoit l’heure le jour même avec « Je pars ».'],
      keys: 'reserver rendez-vous rdv booking bloc matin apres-midi soir camion nouveau prendre'
    },
    en: {
      title: 'Book an appointment',
      short: '« + » → « Book an appointment »: the customer, their car, the services, then a block (morning, afternoon or evening). The app puts them on a truck and works out the time.',
      steps: ['Tap the red « + » → « Book an appointment ».', 'Find the customer (or create them).', 'Pick their car (or add it).', 'Tick the services. The length is worked out; you can change it.', 'Pick a block: the app suggests the best (where a truck already drives nearby).', 'Tap « Book ». The customer gets a confirmation text.'],
      example: 'Andre calls for an oil change tomorrow afternoon. The office types « Andre », picks his Sienna, ticks « Oil change », picks « Tomorrow, afternoon » and books. Andre gets: « Appointment tomorrow between 12 and 4 p.m., expected total $103.47 ».',
      tips: ['The exact time is worked out by the app (the shortest route). The customer gets the block; the exact time comes on the day with « I’m leaving ».'],
      keys: 'book appointment booking block morning afternoon evening truck new'
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
      keys: 'plusieurs voitures vehicules deux autos famille corolla sienna'
    },
    en: {
      title: 'A customer with several cars',
      short: 'In « Book », each of the customer’s cars has its own list of work. Pick a car, tick its work, then go to the other.',
      steps: ['In « Book », pick the customer.', 'Pick the first car and tick its work.', 'Pick the second car: the list starts empty, tick its work.', 'Going back to the first car brings its work back.', 'Book: one appointment per car, in the same block.'],
      example: 'Mahdi has a Corolla and a Sienna. Corolla: oil change. Sienna: winter tires. One block « Saturday morning », two appointments, one per car.',
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
      tips: ['Seuls le propriétaire et le bureau peuvent le faire.'],
      keys: 'complet plein forcer quand meme surbooking bloc'
    },
    en: {
      title: 'Book anyway (full block)',
      short: 'A block is full but you want the customer anyway? After the warning, « Book anyway » puts them at the end of the route. Nobody loses their place.',
      steps: ['Book as usual.', 'The app says the block is full.', 'Tap « Book anyway » and confirm.', 'The customer goes at the end of the truck’s route; the day ends later.'],
      example: 'Saturday morning is full. A good customer insists. Hassan taps « Book anyway »: they go 5th, after the other 4, around 12:10.',
      tips: ['Only the owner and the office can do it.'],
      keys: 'full force anyway overbook block'
    }
  },
  {
    id: 'move', topic: 'booking', roles: ['owner', 'office'],
    fr: {
      title: 'Déplacer un rendez-vous',
      short: 'Sur la job : « Déplacer le rendez-vous », choisis un autre jour ou un autre bloc. Le client peut recevoir un texto.',
      steps: [
        'Ouvre la job (pas encore commencée).',
        'Touche « Déplacer le rendez-vous » (ou menu « … »).',
        'Choisis le nouveau jour et le bloc.',
        'Confirme. Si les textos sont activés, le client est averti.'
      ],
      example: 'Amro ne peut plus samedi. Le bureau ouvre sa job → « Déplacer le rendez-vous » → lundi matin. Amro reçoit le texto du changement.',
      keys: 'deplacer changer date jour reporter remettre bloc'
    },
    en: {
      title: 'Move an appointment',
      short: 'On the job: « Move the appointment », pick another day or block. The customer can get a text.',
      steps: ['Open the job (not started yet).', 'Tap « Move the appointment » (or the « … » menu).', 'Pick the new day and block.', 'Confirm. If texts are on, the customer is told.'],
      example: 'Amro can’t make Saturday. The office opens his job → « Move the appointment » → Monday morning. Amro gets the text.',
      keys: 'move change date day reschedule block'
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
      tips: ['Ceux qui sont en route ou sur place restent toujours en premier.', 'Le propriétaire, le bureau et le mécano du camion peuvent le faire.'],
      keys: 'ordre premier urgent prioriser avant changer ordre arrets route trier'
    },
    en: {
      title: 'Change the order of customers (Put first)',
      short: 'The app picks the order that drives the least. To put a customer first: their job’s « … » menu → « Put first ». Or « Order of the stops » to reorder everything.',
      steps: ['Open the customer’s job.', 'Quick: « … » → « Put first ». Done.', 'Or: « Order of the stops » → arrows ⇈ (first), ↑, ↓ → « Save the order ».', 'Everybody’s arrival time is worked out again.', 'Back to the app’s order: « Order of the stops » → « Let the app choose ».'],
      example: 'Mahdi is urgent. Hassan opens his job → « … » → « Put first ». Mahdi goes 1st around 3:03, Amro 2nd around 4:08.',
      tips: ['Those on the way or on site always stay first.', 'The owner, the office and the truck’s mechanic can do it.'],
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
      short: '« + » → « Estimate »: a price for the customer, without an appointment. They can sign it online; it can become an appointment.',
      steps: ['Tap « + » → « Estimate ».', 'Add the services and prices.', 'Send it to the customer (text): they see it and can sign it.', 'When they accept, book the appointment from the estimate.'],
      example: 'Bassam asks how much for 4 tires mounted. The office makes an estimate « Mount 4 tires 18 in., $120 », texts it. Bassam signs that evening; the appointment is booked for Tuesday.',
      keys: 'estimate quote price sign'
    }
  },

  /* ---------- payments ---------- */
  {
    id: 'pay', topic: 'pay', roles: ['mechanic', 'owner', 'office'],
    fr: {
      title: 'Encaisser un paiement',
      short: '« Encaisser » : choisis Comptant, Débit, Crédit, Virement Interac, Chèque ou Autre, vérifie le montant, confirme.',
      steps: [
        'Sur la job (ou la facture), touche « Encaisser ».',
        'Choisis comment le client paie.',
        'Comptant : écris ce qu’il te donne ; l’app calcule la monnaie à rendre.',
        'Interac, chèque, autre : écris la référence si tu l’as.',
        'Touche « Confirmer ». La facture est « PAYÉE » quand tout est payé.'
      ],
      example: 'Facture de 103,47 $. Le client donne 120 $ comptant. Saleh touche « Comptant », écrit 120 : l’app dit « Rends 16,55 $ » (arrondi au 5 sous). Il confirme.',
      tips: ['Paiement en deux fois ? Change le montant : le reste demeure à payer.', 'Le client peut aussi payer par carte sur son téléphone si le paiement en ligne est branché.'],
      keys: 'encaisser payer paiement comptant cash debit credit interac cheque monnaie facture payee'
    },
    en: {
      title: 'Take a payment',
      short: '« Collect »: choose Cash, Debit, Credit, Interac transfer, Cheque or Other, check the amount, confirm.',
      steps: ['On the job (or invoice), tap « Collect ».', 'Choose how the customer pays.', 'Cash: type what they give you; the app works out the change.', 'Interac, cheque, other: type the reference if you have it.', 'Tap « Confirm ». The invoice is « PAID » once everything is paid.'],
      example: 'Invoice of $103.47. The customer gives $120 cash. Saleh taps « Cash », types 120: the app says « Give back $16.55 » (rounded to 5 cents). He confirms.',
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
        'Le propriétaire et le mécano du camion peuvent mettre une job au Coffre. Seul le propriétaire peut en retirer une (erreur).',
        'Le comptable voit le rapport : Trésorerie → Coffre → Excel ou CSV, à part des revenus.',
        'Une job déjà payée (même en partie) ne peut pas aller au Coffre.'
      ],
      keys: 'coffre famille amis cadeau pourboire sans taxes sans facture rapport comptable'
    },
    en: {
      title: 'The Coffre (family and friends)',
      short: 'For family and friends: the job has no invoice and no taxes and stays out of the treasury. What they give is recorded apart, in the Coffre.',
      steps: ['« Collect » → tap the « Coffre » tile. Or the job’s « … » menu → « Paid by the Coffre ».', 'Tick the job(s) paid this way.', 'Type the amount received ($0 if nothing), the date, a note if you want.', 'Tap « Put in the Coffre ». The invoice is cancelled (its number stays in the books).', 'The job counts as settled: you can finish it.'],
      example: 'Uncle Sami gets an oil change ($89.99). He gives $40 as a gift. Saleh taps « Collect » → « Coffre », ticks the job, types $40, note « Uncle Sami ». No taxes, nothing in the revenue.',
      tips: ['The owner and the truck’s mechanic can put a job in the Coffre. Only the owner can take one out (mistake).', 'The accountant sees the report: Treasury → Coffre → Excel or CSV, apart from the revenue.', 'A job already paid (even partly) cannot go in the Coffre.'],
      keys: 'coffre family friends gift tip no taxes no invoice report accountant'
    }
  },
  {
    id: 'pay-later', topic: 'pay', roles: ['owner', 'office'],
    fr: {
      title: 'Laisser un client payer plus tard',
      short: 'Normalement, on encaisse avant de partir. Le propriétaire ou le bureau peut permettre « payer plus tard » (ex. compte d’entreprise).',
      steps: [
        'La facture doit être terminée.',
        'Sur « Encaisser », choisis « Payer plus tard » et écris pourquoi.',
        'La job se termine ; la facture reste à payer dans « Factures ».'
      ],
      example: 'Livraisons Express Laval paie à 30 jours. Le bureau choisit « Payer plus tard », raison « Compte d’entreprise, 30 jours ». Saleh peut partir chez le client suivant.',
      keys: 'payer plus tard credit compte entreprise 30 jours dette facture ouverte'
    },
    en: {
      title: 'Let a customer pay later',
      short: 'Normally you collect before leaving. The owner or the office can allow « pay later » (e.g. a business account).',
      steps: ['The invoice must be finished.', 'On « Collect », choose « Pay later » and say why.', 'The job finishes; the invoice stays owed in « Invoices ».'],
      example: 'Livraisons Express Laval pays at 30 days. The office picks « Pay later », reason « Business account, 30 days ». Saleh can leave for the next customer.',
      keys: 'pay later credit business account 30 days open invoice'
    }
  },
  {
    id: 'invoice-cancel', topic: 'pay', roles: ['owner', 'office'],
    fr: {
      title: 'Les numéros de facture et une facture annulée',
      short: 'Chaque facture terminée a un numéro qui se suit, jamais deux fois. Une facture annulée garde son numéro ; la job en reçoit une nouvelle.',
      steps: [
        'Une facture en brouillon n’a pas encore de numéro : on peut la changer.',
        'En la terminant, elle reçoit le numéro suivant.',
        'Pour corriger une facture terminée : annule-la (avec la raison), puis refais-la.'
      ],
      example: 'La facture F-0042 a une erreur de prix. Le bureau l’annule (« mauvais prix ») et refait la facture : elle devient F-0043. F-0042 reste dans les livres, marquée annulée.',
      keys: 'numero facture annuler corriger brouillon erreur'
    },
    en: {
      title: 'Invoice numbers and a cancelled invoice',
      short: 'Each finished invoice gets the next number, never twice. A cancelled invoice keeps its number; the job gets a new one.',
      steps: ['A draft has no number yet: it can be changed.', 'When finished, it gets the next number.', 'To fix a finished invoice: cancel it (with the reason), then make it again.'],
      example: 'Invoice F-0042 has a wrong price. The office cancels it (« wrong price ») and makes it again: it becomes F-0043. F-0042 stays in the books, marked cancelled.',
      keys: 'invoice number cancel fix draft mistake'
    }
  },

  /* ---------- customers ---------- */
  {
    id: 'customer-add', topic: 'customers', roles: ['owner', 'office', 'mechanic'], link: '#/customer/new',
    fr: {
      title: 'Ajouter un client et ses véhicules',
      short: '« + » → « Nouveau client » : nom, téléphone, adresse. Puis ses voitures : marque, modèle, moteur. L’année n’est pas obligatoire.',
      steps: [
        'Touche « + » → « Nouveau client ».',
        'Écris le nom, le téléphone et l’adresse (choisis-la dans la liste pour qu’elle soit sur la carte).',
        'Ajoute une voiture : la marque, le modèle.',
        'L’année est facultative : « Je ne sais pas » pour passer.',
        'Choisis le moteur : l’app montre l’huile et le filtre qu’il prend.'
      ],
      example: 'Nouveau client : Karim, 514 555-1234, 1200 rue Sauvé. Voiture : Honda Civic, année inconnue, moteur 2.0 L. L’app affiche « 0W-20, 4,4 L, filtre 15400-PLM-A02 ».',
      tips: ['Tu peux aussi ajouter une voiture depuis la fiche du rendez-vous.'],
      keys: 'client nouveau ajouter voiture vehicule annee moteur adresse telephone fiche'
    },
    en: {
      title: 'Add a customer and their vehicles',
      short: '« + » → « New customer »: name, phone, address. Then their cars: make, model, engine. The year is optional.',
      steps: ['Tap « + » → « New customer ».', 'Type the name, phone and address (pick it in the list so it is on the map).', 'Add a car: make, model.', 'The year is optional: « I don’t know » to skip.', 'Pick the engine: the app shows the oil and filter it takes.'],
      example: 'New customer: Karim, 514 555-1234, 1200 rue Sauvé. Car: Honda Civic, year unknown, 2.0 L engine. The app shows « 0W-20, 4.4 L, filter 15400-PLM-A02 ».',
      tips: ['You can also add a car from the appointment screen.'],
      keys: 'customer new add car vehicle year engine address phone'
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
      short: '« Conversation » shows the texts with the customer and lets you answer from the garage’s number. No GoHighLevel app needed.',
      steps: ['On the job (next to « Call ») or in the customer’s file, tap « Conversation ».', 'You see the messages sent and received.', 'Type your answer, tap « Send ». It goes from the garage’s number.'],
      example: 'Andre writes « I’ll be there in 10 min, please wait ». Saleh opens « Conversation » on the job and answers « No problem, I’m waiting outside ».',
      tips: ['The list refreshes by itself every 20 seconds.', 'If the customer refused texts, you cannot write to them.'],
      keys: 'conversation text sms message write answer ghl gohighlevel customer'
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
      steps: ['Open « Map ».', 'Each truck has its colour; stops are numbered in order.', 'The mechanic shows with their name: « just now », « 3 min ago », or « Working at Mahdi’s ».', 'Tap a truck in the list to see only its route.', 'Yesterday, Today, Tomorrow: at the top.'],
      example: 'Hassan opens the map at 3:30: « Saleh — Working at Mahdi’s ». Stops 2 and 3 are waiting; arrival at Amro’s is expected around 4:08.',
      tips: ['« Last position 40 min ago » in pale: their app has not been open for a while (phone in the pocket while driving).'],
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
      steps: ['Open « Overview ».', 'On the left (or top): today’s appointments and their state.', 'The map shows stops and mechanics. Tap a stop to see it in the list.'],
      example: 'The office keeps the Overview open all day: Amro « Done », Mahdi « On site », Andre « Booked, around 4:30 ».',
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
      tips: ['L’après-midi part du dernier client du matin ; chaque bloc essaie de finir près du premier client du bloc suivant.'],
      keys: 'depart point camion maison centrale adresse route horaires'
    },
    en: {
      title: 'Change where a truck leaves from',
      short: 'Each truck leaves from the Centrale, or from its own start (e.g. the mechanic’s home). Routes are redone by themselves.',
      steps: ['Open « Hours » → the truck → « Where this truck leaves from ».', 'Pick the address in the list.', 'Save. Coming appointments are re-planned from there.'],
      example: 'Saleh leaves from home in Laval. Hassan sets « 300 boul. Saint-Martin, Laval ». The first morning customer becomes the one closest to Laval.',
      tips: ['The afternoon leaves from the last morning customer; each block tries to end near the first customer of the next block.'],
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
        'Les rendez-vous de ce jour vont sur un autre camion, ou dans « À placer » s’il n’y a pas de place.'
      ],
      example: 'Saleh est en congé vendredi. Hassan ferme le Camion Complet vendredi. Les 3 rendez-vous passent à l’autre camion ; un reste « À placer » et Hassan appelle le client.',
      keys: 'horaires heures conge fermer jour camion semaine a placer'
    },
    en: {
      title: 'Truck hours (closing a day)',
      short: 'In « Hours », each truck has its hours per weekday. A closed day takes no appointments.',
      steps: ['Open « Hours » and pick the truck.', 'Change a day’s hours, or close it.', 'Apply: that day only, a few weeks, or from now on.', 'That day’s appointments go to another truck, or « To place » if there is no room.'],
      example: 'Saleh is off Friday. Hassan closes the Camion Complet on Friday. 3 appointments move to the other truck; one stays « To place » and Hassan calls the customer.',
      keys: 'hours schedule day off close truck week to place'
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
      steps: ['Open « Treasury ».', 'Pick the period (month, quarter, year, or dates).', 'Add an expense: « + » → « Expense or receipt », photo, amount, category.', 'Export the report for the accountant.', 'The Coffre has its own report (Treasury → Coffre), apart.'],
      example: 'End of October, the accountant opens the Treasury, picks « October » and downloads the Excel: revenue, GST, QST, expenses (gas, oil, filters).',
      keys: 'treasury accountant revenue taxes gst qst expenses receipt report excel csv'
    }
  },
  {
    id: 'inventory', topic: 'office', roles: ['owner', 'office', 'mechanic'], link: '#/needs',
    fr: {
      title: 'L’inventaire et les besoins de la semaine',
      short: '« Besoins de la semaine » liste l’huile, les filtres et les pièces que les rendez-vous vont demander. « Ajouter à l’inventaire » crée ce qui manque.',
      steps: [
        'Ouvre « Inventaire » → « Besoins de la semaine ».',
        'Tu vois, pour la semaine : les litres d’huile par grade, les filtres, les pièces.',
        '« Ajouter à l’inventaire » crée les articles qui n’existent pas encore.',
        'Quand une job se termine, les pièces utilisées sont retirées de l’inventaire.'
      ],
      example: 'Lundi matin, Saleh ouvre les besoins : 22 L de 0W-20, 9 L de 5W-30, 5 filtres (3 Toyota, 2 Honda). Il passe chez le fournisseur avant de partir.',
      keys: 'inventaire besoins semaine huile filtres pieces stock fournisseur'
    },
    en: {
      title: 'Inventory and the week’s needs',
      short: '« Needs of the week » lists the oil, filters and parts the appointments will need. « Add to inventory » creates what is missing.',
      steps: ['Open « Inventory » → « Needs of the week ».', 'You see for the week: litres of oil per grade, filters, parts.', '« Add to inventory » creates the items that do not exist yet.', 'When a job finishes, the parts used come off the inventory.'],
      example: 'Monday morning, Saleh opens the needs: 22 L of 0W-20, 9 L of 5W-30, 5 filters (3 Toyota, 2 Honda). He stops at the supplier before leaving.',
      keys: 'inventory needs week oil filters parts stock supplier'
    }
  },
  {
    id: 'offline', topic: 'office', roles: ['mechanic', 'owner', 'office'],
    fr: {
      title: 'Sans réseau',
      short: 'Pas de réseau ? Continue : l’app garde ce que tu fais et l’envoie dès que le réseau revient.',
      steps: [
        'Fais tes étapes comme d’habitude.',
        'Un message dit « sera envoyé » : c’est gardé sur le téléphone.',
        'Dès que le réseau revient, tout part dans l’ordre.',
        'Si le serveur refuse quelque chose, un bandeau « refusé » l’explique.'
      ],
      example: 'Dans un sous-sol, Saleh n’a pas de réseau. Il touche « Je suis arrivé » et prend la signature. En sortant, le téléphone retrouve le réseau et tout est envoyé.',
      tips: ['La facture et les textos ont besoin du réseau : ils se font dès qu’il revient.'],
      keys: 'reseau internet hors ligne offline signal sous-sol envoye'
    },
    en: {
      title: 'No signal',
      short: 'No signal? Keep going: the app keeps what you do and sends it as soon as the signal is back.',
      steps: ['Do your steps as usual.', 'A message says « will be sent »: it is kept on the phone.', 'Once the signal is back, everything goes, in order.', 'If the server refuses something, a « refused » banner explains it.'],
      example: 'In a basement, Saleh has no signal. He taps « I’ve arrived » and gets the signature. Outside, the phone finds the signal and everything is sent.',
      tips: ['The invoice and texts need the signal: they happen as soon as it is back.'],
      keys: 'signal internet offline network basement sent'
    }
  },

  /* ---------- setup ---------- */
  {
    id: 'team', topic: 'setup', roles: ['owner'], link: '#/team',
    fr: {
      title: 'Inviter un mécano et ses droits',
      short: 'Dans « Équipe », invite une personne avec son rôle (mécano, bureau, comptable). Elle reçoit un lien pour choisir son mot de passe.',
      steps: [
        'Ouvre « Équipe » → « Inviter ».',
        'Écris son nom, son courriel, son rôle ; pour un mécano, son camion.',
        'Envoie l’invitation : elle choisit son mot de passe avec le lien.',
        'Les droits de chaque rôle se changent dans « Réglages ».'
      ],
      example: 'Hassan engage Adam. Il l’invite comme mécano, camion « Voiture ». Adam ouvre le lien, choisit son mot de passe, et voit « Ma journée » avec ses rendez-vous.',
      keys: 'equipe inviter employe mecano droits roles acces mot de passe compte'
    },
    en: {
      title: 'Invite a mechanic and their rights',
      short: 'In « Team », invite someone with their role (mechanic, office, accountant). They get a link to choose a password.',
      steps: ['Open « Team » → « Invite ».', 'Type their name, email, role; for a mechanic, their truck.', 'Send the invitation: they choose a password with the link.', 'Each role’s rights are changed in « Settings ».'],
      example: 'Hassan hires Adam. He invites him as a mechanic, truck « Voiture ». Adam opens the link, chooses his password, and sees « My day » with his appointments.',
      keys: 'team invite employee mechanic rights roles access password account'
    }
  },
  {
    id: 'texts-settings', topic: 'setup', roles: ['owner'], link: '#/settings',
    fr: {
      title: 'Les textos envoyés aux clients',
      short: 'Dans « Réglages », choisis quels textos partent (confirmation, en route, arrivé, facture, rappel…) et change leurs mots.',
      steps: [
        'Ouvre « Réglages » → les messages.',
        'Active ou désactive chaque texto.',
        'Change le texte : les mots entre accolades se remplacent tout seuls ({prenom}, {heure}, {lien}…).'
      ],
      example: 'Hassan veut un ton plus chaleureux : il change le texto « en route » en « Salut {prenom} ! {mecano} s’en vient, arrivée vers {heure}. Suis-le ici : {lien} ».',
      keys: 'textos sms messages reglages modeles confirmation rappel activer'
    },
    en: {
      title: 'The texts sent to customers',
      short: 'In « Settings », choose which texts go out (confirmation, on the way, arrived, invoice, reminder…) and change their words.',
      steps: ['Open « Settings » → messages.', 'Turn each text on or off.', 'Change the text: the words in braces are filled in by themselves ({prenom}, {heure}, {lien}…).'],
      example: 'Hassan wants a warmer tone: he changes the « on the way » text to « Hi {prenom}! {mecano} is coming, around {heure}. Follow here: {lien} ».',
      keys: 'texts sms messages settings templates confirmation reminder'
    }
  },
  {
    id: 'install', topic: 'setup', roles: ['mechanic', 'owner', 'office', 'accountant'],
    fr: {
      title: 'Installer l’app sur le téléphone',
      short: 'L’app s’ouvre dans le navigateur, mais tu peux l’ajouter à l’écran d’accueil comme une vraie app.',
      steps: [
        'iPhone : ouvre l’app dans Safari, touche Partager ⬆️ → « Sur l’écran d’accueil ».',
        'Android : dans Chrome, menu ⋮ → « Installer l’application ».',
        'Ouvre-la ensuite depuis l’icône H.I.S.'
      ],
      example: 'Saleh ouvre le lien dans Safari, Partager → « Sur l’écran d’accueil ». L’icône H.I.S est maintenant à côté de ses autres apps.',
      tips: ['Nouvelle version ? Ferme complètement l’app et rouvre-la.'],
      keys: 'installer telephone iphone android ecran accueil icone mise a jour nouvelle version'
    },
    en: {
      title: 'Install the app on the phone',
      short: 'The app opens in the browser, but you can add it to the home screen like a real app.',
      steps: ['iPhone: open the app in Safari, tap Share ⬆️ → « Add to Home Screen ».', 'Android: in Chrome, menu ⋮ → « Install app ».', 'Then open it from the H.I.S icon.'],
      example: 'Saleh opens the link in Safari, Share → « Add to Home Screen ». The H.I.S icon is now next to his other apps.',
      tips: ['A new version? Close the app completely and open it again.'],
      keys: 'install phone iphone android home screen icon update new version'
    }
  }
];
