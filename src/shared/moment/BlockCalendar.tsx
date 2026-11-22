/* The blocks calendar of the block picker: two weeks of days, a cell per block coloured by the room left (from the
   phone's copy, so it works without network), far moments marked with a dashed edge. One tab stop, the arrows move.
   BlocksPicker builds the cells and decides what a click does. */
import { useRef, useState } from 'preact/hooks';
import { Check, ChevronLeft, ChevronRight, Route } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { clockRange, duration, longDay, tinyDay, type Block, type BlockKey } from '../../lib/dates';
import { Button } from '../../ui';
import type { CellState } from '../../domain/moment/logic';
import { cellMove, keyOf } from './blockCells';

export interface CalCell { key: BlockKey; start: number; end: number; state: CellState; left: number }
export interface CalRow { day: string; blocks: CalCell[] }

export interface BlockCalendarProps {
  rows: CalRow[]; blocks: Block[]; today: string; range: string;
  isPicked: (day: string, block: BlockKey) => boolean;
  /** moving a job: the block it is in now */
  isCurrent: (day: string, block: BlockKey) => boolean;
  /** far from the vehicle's other stops that day (the server's score) */
  isFar: (day: string, block: BlockKey) => boolean;
  anyFar: boolean;
  onPick: (day: string, block: BlockKey) => void;
  /** the right-click / long press and the mouse handlers of an open cell */
  cellProps: (day: string, block: BlockKey) => Record<string, unknown>;
  canEarlier: boolean; canLater: boolean; onEarlier: () => void; onLater: () => void;
}

const off = (c: Pick<CalCell, 'state'>) => c.state === 'closed' || c.state === 'started';

export function BlockCalendar(p: BlockCalendarProps) {
  const l = lang.value;
  const grid = useRef<HTMLTableElement>(null);
  const flat = p.rows.flatMap((r) => r.blocks.map((c) => ({ day: r.day, block: c.key, state: c.state })));
  const unknown = flat.some((c) => c.state === 'unknown');
  const focusable = flat.find((c) => p.isPicked(c.day, c.block)) || flat.find((c) => !off(c)) || flat[0];
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const currentKey = focusKey && flat.some((c) => keyOf(c.day, c.block) === focusKey) ? focusKey : focusable ? keyOf(focusable.day, focusable.block) : null;
  const onKey = (e: KeyboardEvent) => {
    const k = (e.target as HTMLElement)?.dataset?.k;
    if (!k) return;
    const j = cellMove(flat.findIndex((c) => keyOf(c.day, c.block) === k), e.key, p.blocks.length, flat.length);
    if (j == null) return;
    e.preventDefault();
    const nk = keyOf(flat[j].day, flat[j].block);
    setFocusKey(nk);
    grid.current?.querySelector<HTMLElement>(`[data-k="${nk}"]`)?.focus();
  };
  const stateWords = (state: CellState, left: number) => t(`booking.picker.stateLong.${state}`, { d: duration(left, l) });

  return (
    <section class="bp-cal" aria-labelledby="bp-cal-title">
      <div class="bp-head">
        <h3 id="bp-cal-title" class="bp-title">{t('booking.picker.calendar')}</h3>
        <span class="faint small grow">{p.range}</span>
      </div>
      <table class="bp-table" ref={grid} onKeyDown={onKey} aria-label={t('booking.picker.calendar')} aria-describedby="bp-cal-help">
        <thead>
          <tr>
            <th scope="col"><span class="sr-only">{t('common.date')}</span></th>
            {p.blocks.map((b) => <th scope="col" key={b.key}><span class="bp-th">{t(`common.blocks.${b.key}`)}</span><span class="bp-th-hours">{clockRange(b.start, b.end, l)}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {p.rows.map((r) => {
            const isToday = r.day === p.today;
            return (
              <tr key={r.day} class={`${r.blocks.every(off) ? 'is-closed-day' : ''}${isToday ? ' is-today' : ''}`}>
                <th scope="row" class="bp-day"><span class="bp-day-name">{tinyDay(r.day, l)}</span>{isToday && <span class="bp-day-today">{t('common.today')}</span>}</th>
                {r.blocks.map((c) => {
                  const k = keyOf(r.day, c.key);
                  const on = p.isPicked(r.day, c.key);
                  const shut = off(c);
                  const cur = p.isCurrent(r.day, c.key);
                  // far: marked, still pickable (never said of the block the job is in now)
                  const far = !shut && !cur && p.isFar(r.day, c.key);
                  const label = t('booking.picker.cellLabel', { day: longDay(r.day, l), block: t(`common.blocks.${c.key}`).toLowerCase(), state: stateWords(c.state, c.left) })
                    + (far ? `, ${t('booking.far.cell')}` : '') + (cur ? ` (${t('booking.picker.current').toLowerCase()})` : '');
                  return (
                    <td key={c.key}>
                      <button type="button" class={`bp-cell is-${c.state}${on ? ' is-on' : ''}${cur ? ' is-current' : ''}${far ? ' is-far' : ''}`} data-k={k} tabIndex={k === currentKey ? 0 : -1}
                        aria-pressed={on} aria-disabled={shut || undefined} aria-label={label} title={label}
                        onClick={() => { setFocusKey(k); if (!shut) p.onPick(r.day, c.key); }} {...(shut ? {} : p.cellProps(r.day, c.key))} data-testid={`bp-cell-${r.day}-${c.key}`}>
                        {on && <Check size={16} aria-hidden="true" />}
                        <span>{t(`booking.picker.state.${c.state}`, { d: duration(c.left, l) })}</span>
                        {far && <Route class="bp-far-mark" size={13} aria-hidden="true" />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p id="bp-cal-help" class="sr-only">{t('booking.picker.calendarHelp')}</p>
      <div class="bp-foot">
        <ul class="bp-legend" aria-hidden="true">
          {(['ok', 'tight', 'full', 'closed'] as const).map((s) => <li key={s}><span class={`bp-swatch is-${s}`} />{t(`booking.picker.legend.${s}`)}</li>)}
          {/* « Vraies routes » on: a block the server has not answered for yet */}
          {unknown && <li data-testid="bp-legend-unknown"><span class="bp-swatch is-unknown" />{t('booking.picker.legend.unknown')}</li>}
          {p.anyFar && <li data-testid="bp-legend-far"><span class="bp-swatch is-far"><Route size={11} /></span>{t('booking.far.legend')}</li>}
        </ul>
        <span class="row">
          {p.canEarlier && <Button size="sm" icon={<ChevronLeft />} onClick={p.onEarlier} data-testid="bp-earlier">{t('booking.picker.earlier')}</Button>}
          {p.canLater && <Button size="sm" iconEnd={<ChevronRight />} onClick={p.onLater} data-testid="bp-later">{t('booking.picker.later')}</Button>}
        </span>
      </div>
    </section>
  );
}
