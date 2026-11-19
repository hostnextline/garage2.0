/* Heures travaillées : les journées de chaque personne (« Commencer / Terminer ma journée »), pour la paie. */
export const timesheet = {
  title: 'Heures travaillées',
  mine: 'Mes heures',
  help: 'Les heures viennent des boutons « Commencer ma journée » et « Terminer ma journée » de « Ma journée ». Une journée compte le jour où elle a commencé. La semaine va du lundi au dimanche.',
  helpAll: 'Les heures viennent des boutons « Commencer ma journée » et « Terminer ma journée ». Chaque mécano voit seulement ses heures ; les propriétaires et le trésorier voient celles de tout le monde et peuvent les corriger. Chaque correction est gardée.',
  week: { prev: 'Semaine d’avant', next: 'Semaine d’après', now: 'Cette semaine' },
  total: 'Total de la semaine',
  days: { zero: 'Aucun jour travaillé', one: '{n} jour travaillé', other: '{n} jours travaillés' },
  month: 'Total de {month}',
  team: 'L’équipe',
  teamSub: 'Touche une personne pour voir ses journées.',
  teamTotal: 'Toute l’équipe',
  nobody: 'Personne à afficher',
  nobodyText: 'Les mécanos de l’équipe apparaissent ici, avec leurs heures de la semaine.',
  onShift: 'En journée depuis {time}',
  list: 'Les journées',
  off: 'Pas travaillé',
  open: 'En cours depuis {time}',
  nextDay: 'le lendemain',
  check: 'À vérifier',
  checkCount: { one: '{n} à vérifier', other: '{n} à vérifier' },
  checkAll: {
    one: '{n} journée à vérifier : « Terminer ma journée » a été oublié et la journée s’est fermée toute seule la nuit. Touche-la pour écrire la vraie heure de fin.',
    other: '{n} journées à vérifier : « Terminer ma journée » a été oublié et elles se sont fermées toutes seules la nuit. Touche chacune pour écrire la vraie heure de fin.'
  },
  checkMine: {
    one: '{n} journée à vérifier : « Terminer ma journée » a été oublié et elle s’est fermée toute seule la nuit. Dis ta vraie heure de fin au propriétaire ou au trésorier : ils la corrigent ici.',
    other: '{n} journées à vérifier : « Terminer ma journée » a été oublié et elles se sont fermées toutes seules la nuit. Dis tes vraies heures de fin au propriétaire ou au trésorier : ils les corrigent ici.'
  },
  fixed: 'Corrigée par {who}, {when}',
  fixedShort: 'Corrigée',
  add: 'Ajouter des heures',
  addHere: 'Ajouter',
  seeMine: 'Voir mes heures',
  sheet: {
    edit: 'Corriger la journée',
    add: 'Ajouter des heures',
    day: 'Le jour',
    start: 'Début',
    end: 'Fin',
    openEnd: 'En cours : la fin se met quand {name} appuie sur « Terminer ma journée ».',
    nextDay: 'Finit le lendemain, {day}.',
    total: 'Durée : {time}',
    forgot: 'Fermée toute seule à {time} : « Terminer ma journée » a été oublié. Écris la vraie heure de fin.',
    save: 'Enregistrer',
    saved: 'Heures enregistrées',
    remove: 'Retirer cette journée',
    removeConfirm: 'Toucher encore pour retirer',
    removed: 'Journée retirée des heures',
    kept: 'Chaque correction est gardée : qui, quand, avant et après.',
    errors: {
      no_start: 'Écris l’heure du début.',
      no_end: 'Écris l’heure de la fin.',
      zero: 'Le début et la fin sont à la même heure.',
      too_long: 'Une journée ne peut pas dépasser 24 heures.',
      future: 'Cette heure n’est pas encore passée.',
      overlap: 'Ces heures chevauchent une autre journée de cette personne.'
    }
  }
};
