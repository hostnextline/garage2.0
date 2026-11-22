/* A place of the day: a block (« Matin, 8 h à 12 h ») or, with « Plages d'arrivée », the whole day. Its status (passé,
   commencé, fermé, complet), each truck as a lane (how full it is, its jobs in stop order), the trucks that do not
   work there, the jobs « À placer », and « Coller ici » / « Réserver ». From 760 px a whole day is a time grid. */
import { Plus, Clock, ClipboardPaste } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clockRange, type Day } from '../../lib/dates';
import { may } from '../../domain/rights';
import { href } from '../../platform/router';
import { roomy } from '../../platform/media';
import { Panel, Button } from '../../ui';
import type { BlockView } from './select';
import { blockMenu, mayPaste, blockPress } from './actions';
import { pasteHref } from './copy';
import { Lane, IdleLane, UnplacedLane } from './Lanes';
import { DayGrid } from './DayGrid';

/** the words of a place's status, or '' (late in a day of windows: still working, no longer booking: nothing to say) */
function statusOf(v: BlockView, whole: boolean): string {
  if (v.past) return t('agenda.block.past');
  if (v.started) return t(whole ? 'agenda.whole.over' : 'agenda.block.started');
  if (v.closed) return t('agenda.block.closed');
  return v.open && !v.room ? t('agenda.lane.full') : '';
}

export function BlockPanel(p: { day: Day; v: BlockView; first: boolean }) {
  const l = lang.value;
  const { v } = p;
  const whole = v.key === 'day';
  const full = v.open && !v.room;
  const status = statusOf(v, whole);
  const canBook = may.book() && v.open && v.room;
  return (
    <Panel class={`agenda-block${whole ? ' is-day' : ''}${v.started ? ' is-started' : ''}${v.closed ? ' is-closed' : ''}`} data-tour={p.first ? 'agenda-block' : undefined} data-testid={`block-${v.key}`}
      title={whole ? t('agenda.whole.title', { hours: clockRange(v.start, v.end, l) }) : t('agenda.block.title', { block: t(`common.blocks.${v.key}`), hours: clockRange(v.start, v.end, l) })}
      action={status ? <span class={`agenda-status${v.closed ? ' is-closed' : ''}${full && !v.started ? ' is-full' : ''}`}>{v.started && <Clock size={14} aria-hidden="true" />}{status}</span> : undefined}>
      {whole && roomy.value ? <DayGrid day={p.day} v={v} /> : (
        <div class="agenda-lanes" onContextMenu={(e) => blockMenu(e as MouseEvent, p.day, v.key, v)} {...blockPress(p.day, v.key, v)}>
          {v.closed && !v.lanes.length && !v.unplaced.length && <p class="muted small agenda-closed-text">{t(whole ? 'agenda.whole.closedText' : 'agenda.block.closedText')}</p>}
          {v.lanes.map((lane) => <Lane key={lane.truck.id} lane={lane} started={v.started} whole={whole} />)}
          {!v.started && !v.closed && v.idle.map((tr) => <IdleLane key={tr.id} truck={tr} />)}
          {v.unplaced.length > 0 && <UnplacedLane jobs={v.unplaced} />}
          {!v.closed && v.jobs === 0 && <p class="faint small agenda-empty-block">{t(whole ? 'agenda.whole.empty' : 'agenda.block.empty')}</p>}
        </div>
      )}
      {(canBook || mayPaste(v)) && (
        <div class="agenda-block-foot">
          {mayPaste(v) && <Button size="sm" variant="primary" icon={<ClipboardPaste />} href={pasteHref(p.day, v.key)} data-testid={`paste-${v.key}`}>{t('agenda.copy.pasteHere')}</Button>}
          {canBook && <Button size="sm" variant="secondary" icon={<Plus />} href={href('/book', { day: p.day, block: v.key })} data-testid={`book-${v.key}`}>{t(whole ? 'agenda.whole.book' : 'agenda.block.book')}</Button>}
        </div>
      )}
    </Panel>
  );
}
