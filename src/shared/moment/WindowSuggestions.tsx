/* « Plages d'arrivée »: the best moments near the address (one per day, its best window, from the server), never a far
   one; a click chooses one and brings the calendar to it. WindowPicker decides what a click does. */
import { Check, RefreshCw, Sparkles } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { duration } from '../../lib/dates';
import { Button, Pill } from '../../ui';
import type { BlockChoice, BlockPickerProps } from '../../domain/moment/choice';
import { choiceWords } from '../../domain/moment/choice';
import { unmeasured } from '../../domain/moment/logic';
import { KindSwitch, KindTag, SuggNotes, staleClick } from './parts';
import { rowChoice, type DayRow } from './moments';
import type { SuggState } from './hooks';
import type { Kind } from './vehicles';

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export interface WindowSuggestionsProps {
  sugg: SuggState; rows: DayRow[]; dur: number; hasPos: boolean; online: boolean;
  /** the switch « Voiture / Camion »: shown when the garage has both kinds (kindOf: the kind of a row's vehicle) */
  kinds: boolean; kindOf: (truckId: string) => Kind;
  need: BlockPickerProps['need']; kind: BlockPickerProps['kind']; onKind: BlockPickerProps['onKind'];
  isPicked: (c: BlockChoice) => boolean;
  /** moving an appointment: the moment it is in now */
  isCurrent: (s: DayRow) => boolean;
  /** « Arrêt 2 sur 4 de la journée » of each row (null: not said) */
  ranks: ({ n: number; total: number } | null)[];
  onPick: (s: DayRow) => void;
  onRetry: () => void;
  rowProps: (c: BlockChoice) => Record<string, unknown>;
}

export function WindowSuggestions(p: WindowSuggestionsProps) {
  const l = lang.value;
  const { status } = p.sugg;
  const usable = status === 'ok' || status === 'loading';
  const stale = status === 'loading';
  return (
    <section class="bp-sugg" aria-labelledby="bp-sugg-title">
      <div class="bp-head bp-head-wrap">
        <h3 id="bp-sugg-title" class="bp-title"><Sparkles size={18} aria-hidden="true" />{t('booking.win.picker.title')}</h3>
        {p.kinds && p.onKind && <KindSwitch need={p.need} kind={p.kind} onKind={p.onKind} />}
        {!usable && p.online && <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={p.onRetry}>{t('booking.picker.retry')}</Button>}
      </div>
      <SuggNotes status={status} empty={!p.rows.length} hasPos={p.hasPos} skeleton={{ h: 44, lines: 1 }} noneTestid="win-sugg-none"
        words={{ loading: t('booking.win.picker.loading'), offline: t('booking.win.picker.offline'), error: t('booking.win.picker.error'), none: t('booking.win.picker.none', { d: duration(p.dur, l) }) }} />
      {p.rows.length > 0 && usable && (
        <div class={`bp-best-list${stale ? ' is-stale' : ''}`} role="group" aria-label={t('booking.win.picker.title')} data-testid="win-suggs">
          {p.rows.map((s, i) => {
            const c = rowChoice(s);
            const on = p.isPicked(c);
            const rank = p.ranks[i];
            const bits = [
              // « Vraies routes »: a trip of that day not measured yet → no time (it would be the « unknown » 20 min)
              p.hasPos ? cap(unmeasured(s) ? t('booking.picker.unmeasured') : s.drive_min <= 2 ? t('booking.picker.noDrive') : t('booking.picker.drive', { d: duration(s.drive_min, l) })) : '',
              rank ? (rank.total === 1 ? t('booking.picker.orderOnly') : t('booking.picker.order', { n: rank.n, total: rank.total })) : ''
            ].filter(Boolean);
            return (
              <button key={`${s.day}|${s.win[0]}`} type="button" class={`bp-best-row${on ? ' is-on' : ''}`} aria-pressed={on} aria-disabled={stale || undefined}
                onClick={staleClick(stale, () => p.onPick(s))} {...p.rowProps(c)} data-testid={`win-sugg-${i}`} data-day={s.day} data-win={s.win[0]}>
                <span class="bp-sugg-title">
                  {p.isCurrent(s) ? <Pill tone="muted" dot={false}>{t('booking.win.picker.current')}</Pill> : i === 0 && !unmeasured(s) && <span class="bp-best-star" title={t('booking.picker.best')}>★<span class="sr-only">{t('booking.picker.best')} : </span></span>}
                  {choiceWords(c, l)}
                  {on && <Check size={18} class="bp-best-tick" aria-hidden="true" />}
                </span>
                <span class="bp-sugg-sub" title={bits.join(' · ')}>
                  {p.kinds && s.truck && <KindTag kind={p.kindOf(s.truck)} size={14} testid="bp-sugg-kind" />}
                  {bits[0] && <span>{bits[0]}</span>}
                  {rank && <span class="sr-only" data-testid="bp-sugg-order">{bits[bits.length - 1]}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
