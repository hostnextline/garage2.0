/* « Réorganiser la journée » (Partie 28) : chaque camion et ses arrêts dans une liste, un arrêt glissé plus haut, plus
   bas ou sur l’autre camion, les heures recalculées, rien d’enregistré avant « Enregistrer », aucun texto envoyé.
   Tutoiement pour l’équipe. */
export const reorg = {
  /* where it opens (the agenda's day, Aujourd'hui, « Ma journée », Carte, Vue d'ensemble, a stop's menu, the job) */
  open: 'Réorganiser la journée',
  openTomorrow: 'Réorganiser demain',
  openMine: 'Réorganiser ma journée',
  /* the job screen's menu row, under « Réorganiser la journée » */
  openSub: 'Changer l’ordre ou le camion des arrêts de cette journée',
  sub: { one: '{day}, 1 rendez-vous', other: '{day}, {n} rendez-vous' },
  /* the status line */
  hint: 'Glisse ≡ pour changer l’ordre ou le camion. Touche un arrêt pour plus de choix.',
  unsaved: 'Pas enregistré',
  /* a truck's head */
  truckHead: { one: '1 arrêt, de {from} à {to}, {drive} de route', other: '{n} arrêts, de {from} à {to}, {drive} de route' },
  truckHeadUnmeasured: { one: '1 arrêt, de {from} à {to}, route pas encore mesurée', other: '{n} arrêts, de {from} à {to}, route pas encore mesurée' },
  truckOver: 'finit à {end}, après ses heures ({hours})',
  done: { one: '1 arrêt fait', other: '{n} arrêts faits' },
  enRoute: 'En route : {name}',
  onSite: 'Sur place : {name}',
  /* the drag */
  grip: 'Déplacer {name}',
  keys: 'Espace pour prendre l’arrêt, flèches pour le déplacer, Entrée pour le poser, Échap pour annuler.',
  picked: '{name} pris. Flèches pour le déplacer, Entrée pour le poser.',
  placed: '{name} : arrêt {pos} sur {n}, {truck}.',
  putBack: '{name} est revenu à sa place.',
  dropHere: 'Glisse un arrêt ici',
  /* the row menu */
  menuFirst: 'Mettre en premier',
  menuUp: 'Monter',
  menuDown: 'Descendre',
  menuOn: 'Mettre sur {truck}',
  menuBack: 'Remettre à sa place',
  /* a place it may not go */
  cannotMachine: 'Ne peut pas : ce travail demande le camion (pneus).',
  cannotOff: '{truck} ne travaille pas ce jour-là.',
  cannotRight: 'Seuls le propriétaire et le bureau changent un arrêt de camion.',
  otherBlock: 'Pour changer de bloc : « Déplacer ».',
  cannotEnds: '{truck} finit à {time} ce jour-là : {name} n’y entre pas.',
  /* a stop's line */
  waiting: 'En attente d’envoi',
  newStop: 'Nouveau',
  unplaced: { one: '1 à placer : « Déplacer »', other: '{n} à placer : « Déplacer »' },
  at: 'vers {time}',
  before: 'avant {time}',
  asking: 'calcul…',
  window: 'plage {from} à {to}',
  winNew: '{from} à {to} devient {nfrom} à {nto}',
  newWindow: 'Nouvelle plage',
  flexNew: 'Dans la journée : recevra {from} à {to}',
  flexLater: 'Dans la journée (sa plage se fixe la veille à {time})',
  flexUnmeasured: 'Dans la journée (sa plage viendra quand la route sera mesurée)',
  told: 'dit : {from} à {to}',
  toldDay: 'dit : {day}',
  winBack: '{from} à {to} revient à {tfrom} à {tto} : l’heure qu’il a eue',
  toldToday: 'déjà averti aujourd’hui : un 2e texto partira',
  lateRow: 'Arriverait {by} après sa plage',
  earlyRow: 'Arriverait {by} avant sa plage',
  pinKept: 'Heure fixée {time}',
  pinLost: 'L’heure fixée ({time}) ne tient plus : vers {eta}',
  pinDropped: 'L’heure fixée ({time}) part : tu l’as déplacé',
  /* Part 29 (Hassan : « accept the appointement where i put it without moving all the others arround ») : l’arrêt glissé
     prend l’heure de sa nouvelle place et la garde ; les autres gardent la leur */
  atFixed: 'fixé à {time}',
  atFixedUnmeasured: 'Fixé là où tu l’as mis',
  wasAt: 'avant : vers {time}',
  pinMovedTo: 'Heure fixée {from} → {to} : il arrivait déjà à cette heure',
  /* a drop onto the other kind of vehicle */
  kindToCar: '{name} ira avec la voiture : l’app ne le remettra plus sur le camion.',
  kindToTruck: '{name} ira avec le camion : l’app ne le remettra plus sur la voiture.',
  kindOk: 'Le mettre là',
  /* someone else changed the day, the draft kept on the phone */
  changedBy: {
    one: '{name} vient d’enregistrer cette journée : son ordre est repris ; ton arrêt déplacé est gardé.',
    other: '{name} vient d’enregistrer cette journée : son ordre est repris ; tes {n} arrêts déplacés sont gardés.'
  },
  changed: 'La journée vient de changer : {what}. Tes arrêts déplacés sont gardés : vérifie, puis enregistre.',
  added: '{name} ajouté',
  gone: '{name} parti',
  started: '{name} commencé',
  moved: '{name} déplacé',
  autoLost: 'L’ordre de l’app est à redemander : la journée a changé.',
  draftBack: 'Ton ordre pas encore enregistré ({time}) est revenu : vérifie, puis enregistre.',
  draftForget: 'Oublier ce brouillon',
  /* the summary over the buttons */
  sumAsking: 'Calcul des heures…',
  sumNone: 'Personne ne change d’heure.',
  sumFixed: { one: '{list} : fixé là où tu l’as mis.', other: '{list} : fixés là où tu les as mis.' },
  sumFixedOne: '{name} à {time}',
  sumKept: 'Les autres gardent leur heure.',
  sumPushed: { one: '1 arrêt passe plus tard dans sa plage : {names}.', other: '{n} arrêts passent plus tard dans leur plage : {names}.' },
  sumPushedFlex: { one: '1 arrêt passe plus tard dans la journée : {names}.', other: '{n} arrêts passent plus tard dans la journée : {names}.' },
  sumRepinned: { one: 'L’heure fixée de {names} passe à son arrivée.', other: 'Les heures fixées de {names} passent à leur arrivée.' },
  sumNewTime: { one: 'Nouvelle heure pour {names}.', other: 'Nouvelle heure pour {names}.' },
  sumNoAnswer: 'Heures d’arrivée : pas encore calculées.',
  sumChanges: {
    one: '1 client changera d’heure : {names}. Rien ne lui est envoyé maintenant.',
    other: '{n} clients changeront d’heure : {names}. Rien ne leur est envoyé maintenant.'
  },
  sumLate: {
    one: '1 client serait en retard : {names}. Appelle-le ou change l’ordre.',
    other: '{n} clients seraient en retard : {names}. Appelle-les ou change l’ordre.'
  },
  sumEarly: {
    one: '1 client arriverait avant sa plage : {names}. Appelle-le ou change l’ordre.',
    other: '{n} clients arriveraient avant leur plage : {names}. Appelle-les ou change l’ordre.'
  },
  sumPins: { one: '1 heure fixée ne tient plus : {names}.', other: '{n} heures fixées ne tiennent plus : {names}.' },
  sumOver: { one: '1 camion finirait après ses heures.', other: '{n} camions finiraient après leurs heures.' },
  sumUnmeasured: {
    one: '1 arrêt sans heure mesurée : son heure ne change pas pour l’instant.',
    other: '{n} arrêts sans heure mesurée : leur heure ne change pas pour l’instant.'
  },
  unmeasuredTruck: 'Routes de cette journée pas toutes mesurées : ces heures viendront plus tard.',
  measuring: 'Mesure des routes de la journée… (l’ordre peut encore changer pendant la mesure)',
  retry: 'Réessayer',
  /* the buttons */
  save: 'Enregistrer',
  saveAnyway: 'Enregistrer quand même',
  checking: 'Vérification…',
  saving: 'Enregistrement…',
  saved: 'Journée enregistrée. Aucun texto n’est parti.',
  cancel: 'Annuler',
  close: 'Fermer',
  leaveTitle: 'Quitter sans enregistrer ?',
  leaveText: 'Ton nouvel ordre sera perdu.',
  stay: 'Rester',
  leave: 'Quitter',
  offline: 'Pas de réseau : tu peux préparer l’ordre, mais les heures et « Enregistrer » attendent le réseau.',
  waitMove: 'Un déplacement de cette journée attend d’être envoyé : « Enregistrer » attend qu’il parte.',
  outcome: 'Les heures ont changé depuis la vérification : regarde, puis enregistre de nouveau.',
  busy: 'Le serveur est occupé : réessaie dans un instant.',
  lost: 'Pas de réponse du serveur : la journée est peut-être enregistrée. Je vérifie…',
  lostNot: 'Pas enregistré. Réessaie.',
  /* « Laisser l'app choisir » */
  auto: 'Laisser l’app choisir',
  autoBack: 'Remettre comme avant',
  autoTitle: 'Laisser l’app refaire toute la journée ?',
  autoText: 'L’app oublie l’ordre et les heures fixées de cette journée et propose les siens ; chaque arrêt reste sur le même genre de véhicule (le camion ou la voiture). Rien n’est enregistré avant « Enregistrer ».',
  autoOk: 'Voir l’ordre de l’app',
  autoKeep: 'Garder le mien',
  autoShown: 'Voici l’ordre de l’app. Rien n’est enregistré.',
  autoOver: 'L’app ne trouve pas de place pour {name} : il reste à la fin, en retard.',
  /* the « ? » of a truck */
  help: 'Glisse un arrêt par sa poignée ≡ : plus haut, plus bas, ou sur l’autre camion. L’arrêt glissé prend l’heure de sa nouvelle place et la garde ; les autres gardent leur heure. Rien ne change tant que tu n’as pas touché « Enregistrer », et aucun texto ne part. Un client qui arriverait en dehors de la plage qu’on lui a dite reçoit une nouvelle plage, montrée avant d’enregistrer. Plus tard, une réservation, une annulation ou une route mesurée (aussi la nuit) peut encore changer l’heure des autres arrêts ; un arrêt à heure fixée garde la sienne tant que le camion peut y être. Quand ta journée est prête : « Envoyer les heures aux clients ».'
};
