/* « En attente d'envoi »: a move of this appointment kept on the phone (no signal) and not sent yet, said where the
   appointment is listed (the lists of a truck's stops: Carte, Vue d'ensemble, Aujourd'hui), with the agenda's own words
   and icon. Until it leaves, the stop stays at its old moment and « Déplacer » is not offered again (moving.ts). */
import { CloudUpload } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { moveWaiting } from './moving';
import './jobs.css';

export function MoveWaiting(p: { id: string }) {
  if (!moveWaiting(p.id)) return null;
  return (
    <span class="move-wait" title={t('agenda.move.waitingText')} data-testid={`move-wait-${p.id}`}>
      <CloudUpload size={12} aria-hidden="true" />{t('agenda.move.waiting')}
    </span>
  );
}
