/* Par où commencer : les premiers pas de chaque rôle, la visite guidée, installer l'app, les questions fréquentes.
   Tutoiement dans l'équipe, des mots simples, une idée par phrase. */
export const guide = {
  title: 'Par où commencer',
  sub: {
    owner: 'Les premiers pas pour lancer le garage dans l’app.',
    office: 'Les premiers pas pour le bureau.',
    mechanic: 'Les premiers pas pour ta journée sur la route.',
    treasurer: 'Les premiers pas pour tenir les comptes.'
  },
  roles: { owner: 'Propriétaire', office: 'Bureau', mechanic: 'Mécano', treasurer: 'Trésorier' },
  help: 'Chaque étape se coche toute seule quand c’est fait. Touche une étape pour aller au bon écran\u00a0: l’app te montre où toucher.',
  progress: '{done} sur {total}',
  progressLabel: 'Étapes faites\u00a0: {done} sur {total}',
  allDone: 'Tout est prêt. Tu connais l’essentiel de l’app.',
  checklist: 'Tes premiers pas',
  next: 'Prochaine étape',
  go: 'Y aller',
  later: 'Plus tard',
  laterToast: 'D’accord. On t’en reparle dans une semaine.',
  seeAll: 'Tout voir',
  done: 'Fait',
  todo: 'À faire',
  unknown: 'À vérifier avec du réseau',
  confirm: 'C’est vérifié',
  confirmed: 'C’est noté\u00a0: les prix sont vérifiés.',

  steps: {
    company: { title: 'La fiche de l’entreprise', text: 'Le nom, le téléphone, l’adresse et les numéros de TPS et TVQ\u00a0: ils sont sur chaque facture.' },
    services: { title: 'Les prix des services', text: 'Vérifie chaque prix\u00a0: c’est ce que le client voit dans son texto et sur sa facture.' },
    trucks: { title: 'Les camions et leurs heures', text: 'Chaque camion, son mécano et ses heures de travail. Les blocs s’ouvrent selon ces heures.' },
    team: { title: 'Inviter l’équipe', text: 'Les mécanos, le bureau et le trésorier reçoivent un lien pour entrer dans l’app.' },
    texts: { title: 'Les textos aux clients', text: 'Branche GoHighLevel\u00a0: la confirmation, «\u00a0en route\u00a0» et la facture partent tout seuls.' },
    cards: { title: 'Le paiement par carte', text: 'Branche Stripe\u00a0: le client paie sa facture par carte depuis son lien.' },
    booking: { title: 'La première réservation', text: 'Réserve un vrai rendez-vous\u00a0: le client reçoit sa confirmation par texto.' },
    book: { title: 'Ta première réservation', text: 'Le client, ses services, puis un bloc proposé. Le camion et l’ordre des arrêts se font tout seuls.' },
    customers: { title: 'Trouver un client', text: 'Par son nom, son téléphone ou sa plaque.' },
    agenda: { title: 'L’agenda', text: 'Les rendez-vous de la semaine, par jour et par bloc.' },
    day: { title: 'Commencer ta journée', text: 'Le matin, commence ta journée dans l’écran Aujourd’hui\u00a0: le bureau voit que tu travailles.' },
    job: { title: 'Les étapes d’une job', text: 'Le gros bouton rouge te guide, une étape à la fois, jusqu’au paiement.' },
    offline: { title: 'Sans réseau', text: 'Ce qui marche quand il n’y a pas de réseau, et ce qui attend.' },
    expense: { title: 'Une dépense avec la photo du reçu', text: 'Prends le reçu en photo\u00a0: il reste attaché à la dépense.' },
    report: { title: 'Le rapport et les taxes à remettre', text: 'Les ventes, les dépenses, la TPS et la TVQ à remettre pour la période.' },
    tour: { title: 'La visite guidée', text: 'Deux minutes\u00a0: on te montre les parties de l’app, une à la fois.' }
  },
  detail: {
    missing: 'Il manque\u00a0: {list}.',
    noServices: 'Aucun service pour l’instant.',
    unpriced: { one: '{n} service n’a pas de prix.', other: '{n} services n’ont pas de prix.' },
    confirmPrices: 'Tous les services ont un prix. Vérifie-les, puis touche «\u00a0C’est vérifié\u00a0».',
    noTruck: 'Aucun camion actif pour l’instant.',
    noDriver: '{name} n’a pas de mécano.',
    noHours: '{name} n’a pas d’heures de travail.',
    alone: 'Tu es seul dans l’app pour l’instant.',
    offline: 'Vérifie quand tu auras du réseau.',
    noTruckMine: 'Le propriétaire doit d’abord te donner un camion.'
  },
  fields: { name: 'le nom', phone: 'le téléphone', address: 'l’adresse', tps: 'le numéro de TPS', tvq: 'le numéro de TVQ' },

  jobSteps: {
    title: 'Les étapes d’une job',
    lead: 'Le gros bouton rouge montre toujours la prochaine étape. Une à la fois.',
    leave: { title: 'Je pars', text: 'Le client reçoit un texto avec le lien pour suivre ton camion.' },
    arrive: { title: 'Je suis arrivé', text: 'Le bureau voit que tu es sur place.' },
    waiver: { title: 'Faire signer', text: 'Le client signe sur ton téléphone avant les travaux.' },
    invoice: { title: 'Facture', text: 'Les travaux faits deviennent la facture. Vérifie-la.' },
    pay: { title: 'Encaisser', text: 'Comptant, débit, crédit ou Interac. Le tampon Payé se pose.' },
    finish: { title: 'Terminer', text: 'La job est finie. Ta prochaine job apparaît.' }
  },

  tour: {
    title: 'La visite guidée',
    lead: 'On te montre les parties de l’app, une à la fois. Tu peux arrêter quand tu veux.',
    start: 'Faire la visite guidée',
    again: 'Refaire la visite',
    finishedOn: 'Visite faite le {date}.',
    others: 'Les visites des autres rôles',
    othersLead: 'Pour montrer l’app à ton équipe.',
    label: 'Visite guidée',
    here: 'C’est ici',
    count: '{n} sur {total}',
    prev: 'Précédent',
    next: 'Suivant',
    finish: 'Terminer',
    stop: 'Arrêter',
    ok: 'Compris',
    wait: 'Un instant…',
    finished: 'Visite terminée. Tu peux la refaire quand tu veux dans «\u00a0Par où commencer\u00a0».',
    empty: 'Cette visite n’a rien à montrer sur cet écran pour l’instant.',
    steps: {
      sync: { title: 'La synchro', text: 'Cette pastille dit si tout est envoyé. Sans réseau, continue\u00a0: tout part tout seul quand le réseau revient.' },
      add: { title: 'Le bouton +', text: 'Pour tout ajouter\u00a0: un rendez-vous, un client sans rendez-vous, une estimation, une dépense.' },
      addTreasurer: { title: 'Le bouton +', text: 'Une dépense ou un reçu, de n’importe où dans l’app.' },
      today: { title: 'Aujourd’hui', text: 'La journée en un coup d’œil\u00a0: la prochaine job de chaque camion et ce qui reste à faire.' },
      agenda: { title: 'L’agenda', text: 'Les rendez-vous par jour et par bloc\u00a0: matin, après-midi, soir.' },
      agendaBlock: { title: 'Un bloc', text: 'Chaque bloc montre la place qui reste. Touche un bloc libre pour y réserver.' },
      book: { title: 'Réserver', text: 'Le client, ses services, puis un bloc proposé. Le serveur choisit le camion et l’ordre des arrêts.' },
      bookCustomer: { title: 'Le client', text: 'Écris un nom ou un numéro de téléphone. S’il est nouveau, crée sa fiche ici.' },
      bookServices: { title: 'Les services', text: 'Choisis les services\u00a0: le prix et la durée se calculent tout seuls.' },
      bookBlock: { title: 'Le bloc', text: 'L’app propose les blocs où un camion passe tout près. Choisis-en un, puis réserve.' },
      hours: { title: 'Les horaires', text: 'Les heures de travail de chaque camion. Ce sont elles qui ouvrent ou ferment les blocs.' },
      team: { title: 'L’équipe', text: 'Invite tes mécanos et le bureau. Chacun voit seulement ce que son rôle permet.' },
      settings: { title: 'Les réglages', text: 'La fiche de l’entreprise, les taxes, les prix, les textos et le paiement par carte.' },
      dashboard: { title: 'Les chiffres', text: 'Les ventes du mois, les jobs faites et l’argent qui reste à encaisser.' },
      customers: { title: 'Trouver un client', text: 'Écris un nom, un numéro de téléphone ou une plaque.' },
      map: { title: 'La carte', text: 'Où sont les camions et les jobs du jour.' },
      shift: { title: 'Commencer ta journée', text: 'Touche ici le matin. Le bureau voit que tu travailles et où est ton camion.' },
      next: { title: 'Ta prochaine job', text: 'Elle est toujours en haut. Touche-la pour l’ouvrir.' },
      bigstep: { title: 'Le gros bouton rouge', text: 'Il montre la seule prochaine étape\u00a0: Je pars, Je suis arrivé, Faire signer, Facture, Encaisser, Terminer.' },
      waiver: { title: 'La signature', text: 'Le client signe sur ton téléphone avant le début des travaux.' },
      work: { title: 'Les travaux', text: 'Ce qui est prévu pour cette job, avec les prix.' },
      extra: { title: 'Des travaux en plus', text: 'Tu trouves autre chose\u00a0? Propose-le\u00a0: le client accepte ou refuse, sur ton téléphone ou par texto.' },
      pay: { title: 'Facture et paiement', text: 'À la fin\u00a0: la facture, puis Encaisser. La job se termine quand c’est payé.' },
      syncMechanic: { title: 'Sans réseau', text: 'Pas de réseau dans un sous-sol\u00a0? Continue. Tout reste sur le téléphone et part tout seul quand le réseau revient.' },
      treasuryAdd: { title: 'Ajouter une dépense', text: 'Prends le reçu en photo, vérifie le montant et la catégorie, puis enregistre.' },
      treasuryReport: { title: 'Le rapport', text: 'Les ventes, les dépenses et les taxes à remettre (TPS et TVQ) pour la période choisie.' },
      invoices: { title: 'Les factures', text: 'Toutes les factures, payées ou à payer.' },
      inventory: { title: 'Le stock', text: 'Les pièces qui manquent sont en haut de la liste.' }
    }
  },

  install: {
    title: 'Installer l’app sur ton téléphone',
    lead: 'Elle s’ouvre comme une vraie app, en plein écran, même sans réseau.',
    button: 'Installer l’app',
    installed: 'L’app est installée sur cet appareil.',
    iphone: 'Sur iPhone (Safari)',
    iphone1: 'Touche le bouton Partager, en bas de l’écran.',
    iphone2: 'Choisis «\u00a0Sur l’écran d’accueil\u00a0».',
    iphone3: 'Touche «\u00a0Ajouter\u00a0».',
    android: 'Sur Android (Chrome)',
    android1: 'Touche ⋮ en haut à droite.',
    android2: 'Choisis «\u00a0Installer l’app\u00a0» (ou «\u00a0Ajouter à l’écran d’accueil\u00a0»).',
    android3: 'Confirme.',
    movedLead: 'L’app a une nouvelle adresse. Ouvre-la, connecte-toi, puis installe-la de là : son guide te montre comment.',
    computer: 'Sur le téléphone, ouvre cette adresse\u00a0:',
    copy: 'Copier l’adresse',
    copied: 'Adresse copiée'
  },

  faq: {
    title: 'Questions fréquentes',
    lead: 'Des réponses courtes, par sujet.',
    topics: { book: 'Réserver', blocks: 'Les blocs', offline: 'Sans réseau', texts: 'Les textos', payments: 'Les paiements', rights: 'Les droits' },
    qa: {
      book: {
        how: { q: 'Comment réserver un rendez-vous\u00a0?', a: 'Touche «\u00a0+\u00a0», puis «\u00a0Réserver un rendez-vous\u00a0». Choisis le client, son auto et les services, puis un des blocs proposés. Touche «\u00a0Réserver\u00a0»\u00a0: le client reçoit sa confirmation par texto.' },
        newCustomer: { q: 'Le client n’est pas encore dans l’app\u00a0?', a: 'Écris son nom ou son numéro dans le champ du client. S’il n’existe pas, crée sa fiche au même endroit\u00a0: nom, téléphone, adresse.' },
        change: { q: 'Comment changer ou annuler un rendez-vous\u00a0?', a: 'Ouvre le rendez-vous depuis l’agenda. Tu peux le déplacer dans un autre bloc, ou l’annuler en écrivant la raison. Si le jour ou le bloc change, le client reçoit un texto.' },
        walkIn: { q: 'Un client sans rendez-vous\u00a0?', a: 'Touche «\u00a0+\u00a0», puis «\u00a0Client sans rendez-vous\u00a0»\u00a0: la job commence tout de suite, sur place.' }
      },
      blocks: {
        what: { q: 'C’est quoi, un bloc\u00a0?', a: 'La journée est coupée en trois blocs\u00a0: le matin ({am}), l’après-midi ({pm}) et le soir ({eve}). On promet au client un bloc, pas une heure exacte.' },
        who: { q: 'Qui choisit le camion et l’ordre des arrêts\u00a0?', a: 'Le serveur. Il place chaque job sur le camion le plus proche et met les arrêts dans le meilleur ordre de route.' },
        full: { q: 'Pourquoi un bloc est plein\u00a0?', a: 'Chaque camion a ses heures de travail. Quand les jobs et la route remplissent ces heures, le bloc est plein. Choisis un autre bloc, ou ajoute des heures au camion dans Horaires.' }
      },
      offline: {
        works: { q: 'Qu’est-ce qui marche sans réseau\u00a0?', a: 'Presque tout\u00a0: voir ta journée, avancer une job, faire signer, faire la facture, encaisser. Tout reste sur le téléphone et part tout seul quand le réseau revient.' },
        needs: { q: 'Qu’est-ce qui a besoin du réseau\u00a0?', a: 'Les blocs proposés quand on réserve, la carte en direct, les textos aux clients et le paiement par carte en ligne.' },
        chip: { q: 'Comment savoir si tout est envoyé\u00a0?', a: 'Regarde la pastille en haut\u00a0: «\u00a0À jour\u00a0» veut dire que tout est envoyé. «\u00a0Hors ligne\u00a0» ou «\u00a03 à envoyer\u00a0» veut dire que ça attend le réseau.' },
        refused: { q: 'Un changement a été refusé\u00a0?', a: 'Un bandeau rouge dit pourquoi. Corrige si besoin, puis touche «\u00a0Réessayer\u00a0», ou «\u00a0Retirer\u00a0» si ce n’est plus utile.' }
      },
      texts: {
        which: { q: 'Quels textos reçoit le client\u00a0?', a: 'La confirmation du rendez-vous, un changement de rendez-vous, «\u00a0en route\u00a0» avec le lien pour suivre le camion, les travaux en plus à accepter, et la facture.' },
        notSent: { q: 'Les textos ne partent pas\u00a0?', a: 'Ils passent par GoHighLevel, que le propriétaire branche dans les réglages. Sans ça, l’app te donne le message et le lien\u00a0: tu peux l’envoyer toi-même de ton téléphone.' },
        lang: { q: 'Le client parle anglais\u00a0?', a: 'Les textos, la page du client et la facture suivent la langue écrite dans sa fiche.' }
      },
      payments: {
        how: { q: 'Comment encaisser\u00a0?', a: 'À la fin de la job\u00a0: la facture, puis «\u00a0Encaisser\u00a0». Choisis comptant, débit, crédit ou Interac. Le tampon Payé se pose quand tout est payé.' },
        later: { q: 'Le client veut payer plus tard\u00a0?', a: 'Le bureau ou le propriétaire peut permettre «\u00a0Payer plus tard\u00a0», par exemple pour un compte d’entreprise. Sinon, la job ne se termine pas avant d’être payée.' },
        online: { q: 'Le paiement par carte en ligne\u00a0?', a: 'Quand Stripe est branché, le client peut payer par carte depuis le lien de sa facture. Le paiement s’inscrit tout seul dans l’app.' }
      },
      rights: {
        who: { q: 'Qui voit quoi\u00a0?', a: 'Le propriétaire voit tout. Le bureau réserve et gère les clients. Le mécano voit les jobs de son camion. Le trésorier voit l’argent et les dépenses.' },
        missing: { q: 'Il te manque l’accès à une partie\u00a0?', a: 'Parle au propriétaire\u00a0: il peut te donner ce droit dans Équipe.' },
        preview: { q: 'Voir l’app comme quelqu’un d’autre\u00a0?', a: 'Le propriétaire peut voir l’app comme un membre de l’équipe, pour vérifier ce qu’il voit. Rien ne peut être changé pendant ce temps.' }
      }
    }
  }
};
