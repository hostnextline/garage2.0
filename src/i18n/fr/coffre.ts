/* Coffre : les jobs de la famille et des amis, à part des revenus et des taxes. */
export const coffre = {
  title: 'Coffre',
  help: 'Les jobs faites pour la famille et les amis : pas de facture, pas de taxes, pas dans les revenus. Ce qu’ils ont donné est noté ici, à part. Le comptable exporte ce rapport séparément.',
  apart: 'À part des revenus et des taxes : ces jobs n’ont pas de facture. Le comptable exporte ce rapport séparément.',
  totals: 'Pour la période',
  count: 'Entrées',
  given: 'Reçu',
  worth: 'Valeur des travaux (avant taxes)',
  worthShort: 'valeur {value}',
  list: 'Les entrées',
  jobs: 'Jobs {n}',
  empty: 'Rien au Coffre pour cette période',
  emptyText: 'Sur une job de la famille ou des amis : menu ⋯, puis « Payé par le Coffre ».',
  remove: 'Retirer',
  removeConfirm: 'Toucher encore pour retirer',
  removed: 'Retiré du Coffre : ces jobs peuvent avoir une facture de nouveau',
  open: 'Coffre (famille et amis)',
  openSub: 'Le rapport à part, pour le comptable',
  job: {
    banner: 'Payé par le Coffre (famille et amis) : pas de facture, pas de taxes.',
    menu: 'Payé par le Coffre',
    menuSub: 'Famille et amis : pas de facture, pas de taxes',
    finish: 'Terminer la job'
  },
  pay: { method: 'Coffre' },
  sheet: {
    title: 'Payé par le Coffre',
    lead: 'Famille et amis : coche les jobs qu’ils paient de cette façon. Elles n’auront pas de facture ni de taxes, et iront dans le Coffre, à part des revenus.',
    jobs: 'Les jobs',
    jobLine: 'Job {n}, {day}',
    jobValue: 'Valeur des travaux : {value}',
    noJob: 'Aucune job de ce client ne peut aller au Coffre (une job déjà payée garde sa facture).',
    amount: 'Montant reçu',
    amountHint: 'Ce qu’ils ont donné (0 $ si rien). Valeur des travaux cochés : {value}.',
    day: 'Reçu le',
    note: 'Note',
    what: 'Ces jobs n’ont ni facture ni taxes. Le comptable les voit à part, dans le rapport Coffre.',
    save: 'Mettre au Coffre',
    pickOne: 'Coche au moins une job.',
    amountNeeded: 'Écris le montant reçu (0 $ si rien).',
    done: { one: 'Au Coffre : 1 job, sans facture ni taxes', other: 'Au Coffre : {n} jobs, sans facture ni taxes' }
  },
  export: {
    xlsx: 'Rapport Coffre (Excel)', csv: 'Rapport Coffre (CSV)', file: 'rapport-coffre', sheet: 'Coffre', title: 'Rapport Coffre (famille et amis)',
    period: 'Période :', day: 'Date', customer: 'Client', jobs: 'Jobs', work: 'Travaux', value: 'Valeur des travaux (avant taxes)', amount: 'Montant reçu',
    note: 'Note', by: 'Noté par', total: 'Total'
  }
};
