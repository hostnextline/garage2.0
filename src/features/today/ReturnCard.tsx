/* The way back: after the last stop of the day, the next destination is the start (the truck's own, else « Départ des
   camions »). « Je pars vers … » texts the garage the arrival time and the live map; « Je suis arrivé » ends the trip;
   once arrived, the card says so and offers nothing more (leaving again would text the garage a second time). */
import { useRef } from 'preact/hooks';
import { MapPinCheck, Truck } from 'lucide-preact';
import { Banner, BigStep } from '../../ui';
import { t } from '../../lib/i18n';
import { dayOf } from '../../lib/dates';
import { rowsOf } from '../../data/store';
import { me, myTrucks } from '../../data/auth';
import { settings, truck as truckRow } from '../../data/select';
import type { Job, Trip } from '../../data/types';
import { clockOf } from '../../shared/jobs/select';
import { doReturn, doReturnEnd } from '../../shared/jobs/flow';
import { pendingJobs } from '../../shared/jobs/pending';
import { returnState, lastFinished } from './rules';

/** where this person's truck goes home: the truck's own start, else « Départ des camions » */
function homeOf(): { label: string; address: string; ok: boolean } {
  const own = myTrucks().map((id) => truckRow(id)?.start).find((s) => s && s.lat != null && s.lng != null);
  const h = own || settings.value.booking?.home;
  return { label: h?.label || 'Centrale', address: h?.address || '', ok: !!h && h.lat != null && h.lng != null };
}

export function ReturnCard(p: { day: string; list: Job[] }) {
  const a = me.value;
  // one tap: « Je pars » waits for a position and the server; a second tap would make a second trip and text
  const busy = useRef(false);
  if (!a) return null;
  const once = (fn: () => Promise<void>) => async () => {
    if (busy.current) return;
    busy.current = true;
    try { await fn(); } finally { busy.current = false; }
  };
  const state = returnState(rowsOf<Trip>('trips'), a.id, p.day, (iso) => dayOf(new Date(iso)), lastFinished(p.list, (id) => pendingJobs().steps.get(id)));
  const home = homeOf();
  if (state.kind === 'active') {
    const trip = state.trip;
    const place = trip.dest_label || home.label;
    return (
      <section class="panel glass today-next is-now" data-tour="today-next" data-testid="today-return">
        <div class="panel-head"><h2 class="panel-title">{t('today.return.onWay', { place })}</h2></div>
        <div class="stack">
          <p class="muted" style={{ margin: 0 }} data-testid="today-return-eta">{trip.eta_at ? t('today.return.eta', { time: clockOf(trip.eta_at) }) : t('today.return.noEta')}</p>
          <BigStep icon={<MapPinCheck />} label={t('today.return.arrived')} sub={t('today.return.arrivedSub')} onClick={once(doReturnEnd)} data-testid="today-return-arrived" />
        </div>
      </section>
    );
  }
  if (state.kind === 'arrived') {
    return (
      <section class="panel glass today-next" data-tour="today-next" data-testid="today-return">
        <div class="panel-head"><h2 class="panel-title">{t('today.return.home', { place: home.label, time: clockOf(state.at) })}</h2></div>
        <p class="muted" style={{ margin: 0 }} data-testid="today-return-home">{t('today.return.homeText')}</p>
      </section>
    );
  }
  const manual = me.value?.texts_online === false;
  return (
    <section class="panel glass today-next" data-tour="today-next" data-testid="today-return">
      <div class="panel-head"><h2 class="panel-title">{t('today.next.allDone')}</h2></div>
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{t('today.return.next', { place: home.label })}{home.address ? ` (${home.address})` : ''}</p>
        {home.ok
          ? <BigStep icon={<Truck />} label={t('today.return.leave', { place: home.label })} sub={manual ? t('today.return.leaveSubManual') : t('today.return.leaveSub')} onClick={once(doReturn)} data-testid="today-return-leave" />
          : <Banner kind="warn">{t('today.return.noHome')}</Banner>}
      </div>
    </section>
  );
}
