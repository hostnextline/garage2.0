/* The stops of the day, one panel per truck (and « À placer »), in route order; a tap chooses the stop (its card opens). */
import { Check } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { job as jobRow } from '../../data/select';
import type { JobStatus } from '../../data/types';
import { StatusPill, Pill } from '../../ui';
import { UNPLACED_COLOR, type Assembled, type Stop } from '../../shared/map/assemble';
import { whenOf, lateStop } from './stopWords';

export function StopList(p: { m: Assembled; focus: string | null; selected: string | null; onChoose: (id: string) => void; plain?: boolean }) {
  const groups: { id: string; name: string; color: string; stops: Stop[] }[] = [
    ...p.m.trucks.filter((tr) => tr.stops.length).map((tr) => ({ id: tr.id, name: tr.name, color: tr.color, stops: tr.stops })),
    ...(p.m.unplaced.length ? [{ id: 'unplaced', name: t('map.legend.unplaced'), color: UNPLACED_COLOR, stops: p.m.unplaced }] : [])
  ].filter((g) => !p.focus || g.id === p.focus);
  return (
    <>
      {groups.map((g) => (
        <section key={g.id} class={`panel ${p.plain ? 'panel-plain' : 'glass'} panel-flush map-stops`} data-testid={`stops-${g.id}`}>
          <div class="panel-head"><h2 class="panel-title">{t('map.stops.title', { name: g.name })}</h2></div>
          <div class="rows" role="list">
            {g.stops.map((s) => {
              const row = jobRow(s.id);
              return (
                <button key={s.id} type="button" role="listitem" class={`row-item map-stop${p.selected === s.id ? ' is-selected' : ''}${s.done ? ' is-done' : ''}`} onClick={() => p.onChoose(s.id)} data-testid={`stop-${s.id}`}>
                  <span class="map-n" style={{ '--c': g.color }} aria-label={t('map.stop.number', { n: s.n })}>{s.done ? <Check size={16} strokeWidth={3} /> : g.id === 'unplaced' ? '?' : s.n}</span>
                  <span class="row-main">
                    <span class="row-title">{s.name}</span>
                    <span class="row-sub">{s.hasPos ? whenOf(s, row) : t('map.stops.noPos')}{lateStop(s, row) && <> <Pill tone="warn" data-testid={`stop-late-${s.id}`}>{t('common.window.late')}</Pill></>}</span>
                  </span>
                  <span class="row-end"><StatusPill status={s.status as JobStatus} /></span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
