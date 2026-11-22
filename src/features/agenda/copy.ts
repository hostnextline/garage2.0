/* « Copier / Coller un rendez-vous »: the copy lives in shared/jobs/copy.ts since the shortcut menu of an appointment is
   shared with the lists of a truck's stops (Carte, Vue d'ensemble, Aujourd'hui); the agenda reads it from here. */
export { copiedJob, copyJob, clearCopy, copiedRow, pasteHref, bookHref } from '../../shared/jobs/copy';
