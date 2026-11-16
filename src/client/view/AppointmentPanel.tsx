/* The appointment: its status, the day, the hours (a block, a window, or « Dans la journée »), what happens next, the
   live tracking button while the mechanic is on the way, the car and the file number. */
import { MapPin } from 'lucide-preact';
import { Button } from '../../ui/Button';
import type { JobView } from '../api';
import { dayTitle, relDay, slotText } from '../format';
import { ct, type CLang } from '../i18n';
import { linkHash } from '../link';
import { CallUs } from '../ui';
import { explainKey } from './view-state';

const STATUSES = ['booked', 'en_route', 'on_site', 'done', 'cancelled', 'no_show'];

export function AppointmentPanel(p: { v: JobView; l: CLang; printable: boolean; token: string }) {
  const { v, l } = p;
  const j = v.job;
  const rel = relDay(j.day);
  const slot = slotText(j.start, j.end, l);
  const block = ['am', 'pm', 'eve'].includes(j.block) ? ct(l, `blocks.${j.block}`) : null;
  // « Plages d’arrivée »: a 'day' appointment shows its window (start, end); without one yet, « Dans la journée »
  const flex = j.block === 'day' && !slot;
  const closed = j.status === 'cancelled' || j.status === 'no_show';
  // the appointment's own link opens its LATEST trip (public_track accepts it): never an older trip's link kept on the phone
  const trackHref = j.status === 'en_route' && j.tracking ? linkHash('suivi', p.token, l) : null;
  return (
    <section class={`cl-panel glass${p.printable ? '' : ' cl-noprint'}`} aria-labelledby="cl-appt" data-testid="client-appointment">
      <div class="cl-appt-top">
        <span class={`pill pill-${STATUSES.includes(j.status) ? j.status : 'booked'}`} data-testid="client-status">{ct(l, `job.status.${j.status}`)}</span>
      </div>
      {rel && !closed && <p class="cl-eyebrow">{ct(l, rel)}</p>}
      <div class={closed ? 'cl-closed' : undefined}>
        <h2 class="cl-day" id="cl-appt">{dayTitle(j.day, l)}</h2>
        {(slot || block) && (
          <p class="cl-slot" data-testid="client-slot">{slot && <b>{slot}</b>}{block && <span>{block}</span>}</p>
        )}
        {flex && <p class="cl-slot" data-testid="client-flex"><b>{ct(l, 'flex')}</b>{!closed && <span>{ct(l, 'flexNote')}</span>}</p>}
      </div>
      <p class="cl-explain">{ct(l, explainKey(j, !!trackHref))}</p>
      {trackHref && (
        <div class="cl-track-link cl-noprint">
          <Button variant="primary" block icon={<MapPin />} href={trackHref} data-testid="client-track-link">{ct(l, 'job.track')}</Button>
        </div>
      )}
      <dl class="cl-facts">
        {j.vehicle && <><dt>{ct(l, 'job.vehicle')}</dt><dd>{j.vehicle}</dd></>}
        <dt>{ct(l, 'job.number')}</dt><dd>{j.number}</dd>
      </dl>
      {closed && <div style={{ marginTop: 'var(--sp-4)' }} class="cl-noprint"><CallUs garage={v.garage} l={l} /></div>}
    </section>
  );
}
