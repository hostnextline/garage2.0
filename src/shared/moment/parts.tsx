/* The pieces both moment pickers draw the same way: the moment chosen said plainly, the switch « Peu importe / Voiture /
   Camion », the tag « Avec la voiture / le camion », the garde-route warning with its « Plutôt … » buttons, the notes
   under the best moments, the « Vraies routes » banner (the address being measured), and the menu of a moment
   (right-click, long press). */
import { CalendarCheck, Car, Check, Map as MapIcon, MapPin, RefreshCw, Truck } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { Banner, Button, Seg, Skeleton } from '../../ui';
import type { MenuAction } from '../../ui/ContextMenu';
import type { VehicleKind } from '../../domain/moment/choice';
import type { SuggStatus } from './hooks';
import type { PlaceRoads } from '../../data/roads';
import type { Kind } from './vehicles';

/** what is chosen, said plainly, with « Voir sur la carte » once there is a moment and an address */
export function ChosenBar(p: { on: boolean; text: string; sub: string; onSee?: (() => void) | null }) {
  return (
    <div class={`bp-chosen${p.on ? ' is-on' : ''}`} data-testid="bp-chosen">
      <CalendarCheck aria-hidden="true" />
      <span class="bp-chosen-txt">
        <span>{p.text}</span>
        <span class="bp-chosen-sub">{p.sub}</span>
      </span>
      {p.onSee && <Button size="sm" variant="ghost" icon={<MapIcon />} onClick={p.onSee} data-testid="bp-see-map">{t('booking.preview.see')}</Button>}
    </div>
  );
}

/** the car or the truck: only when the garage has both (the caller decides); work for the tire machine locks it on the truck */
export function KindSwitch(p: { need?: boolean; kind?: VehicleKind; onKind: (k: VehicleKind) => void }) {
  return (
    <div class="bp-kind" data-testid="bp-kind">
      {p.need
        ? <p class="small bp-note" data-testid="bp-kind-need">{t('booking.kind.need')}</p>
        : <Seg<'any' | 'car' | 'truck'> value={p.kind || 'any'} onValue={(v) => p.onKind(v === 'any' ? null : v)} label={t('booking.kind.label')}
            options={[{ value: 'any', label: t('booking.kind.any') }, { value: 'car', label: t('booking.kind.car') }, { value: 'truck', label: t('booking.kind.truck') }]} />}
    </div>
  );
}

/** said clearly: this moment is the car's, or the truck's (never a vehicle's or a mechanic's name) */
export function KindTag(p: { kind: Kind; size: number; testid?: string }) {
  return (
    <span class={`bp-kind-tag is-${p.kind}`} data-testid={p.testid}>
      {p.kind === 'car' ? <Car size={p.size} aria-hidden="true" /> : <Truck size={p.size} aria-hidden="true" />}{t(`booking.kind.with.${p.kind}`)}
    </span>
  );
}

/** « garde-route »: the moment chosen is far from the vehicle's other stops that day, and better moments to take instead */
export function FarBanner(p: { text: string; better: { key: string; text: string; onPick: () => void }[] }) {
  return (
    <Banner kind="bad" data-testid="bp-far-warn">
      <span>{p.text}</span>
      {p.better.length > 0 && (
        <span class="bp-far-better">
          {p.better.map((b) => <Button key={b.key} size="sm" onClick={b.onPick} data-testid="bp-far-better">{b.text}</Button>)}
        </span>
      )}
    </Banner>
  );
}

/** « Vraies routes » (switch on only: `roads` is null off): the trips of this address are being measured (the
    suggestions update by themselves), or they could not be (« Réessayer »; booking stays possible). Nothing once
    measured, nor offline (the pickers already say so). */
export function RoadsBanner(p: { roads: PlaceRoads | null; online: boolean; onRetry: () => void }) {
  if (!p.roads || !p.online || p.roads.state === 'measured') return null;
  if (p.roads.state === 'measuring') return <Banner kind="info" data-testid="roads-measuring">{t('booking.picker.roadsMeasuring')}</Banner>;
  return (
    <Banner kind="warn" data-testid="roads-failed"
      action={<Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={p.onRetry} data-testid="roads-retry">{t('booking.picker.retry')}</Button>}>
      {t('booking.picker.roadsFailed')}
    </Banner>
  );
}

/** the notes under the title of the best moments: no position, looking, no network, no answer, nothing to offer */
export function SuggNotes(p: {
  status: SuggStatus; empty: boolean; hasPos: boolean; skeleton: { h: number; lines: number };
  words: { loading: string; offline: string; error: string; none: string }; noneTestid?: string;
}) {
  return (
    <>
      {p.status === 'ok' && !p.hasPos && <p class="faint small bp-note"><MapPin size={14} aria-hidden="true" /> {t('booking.picker.noPosition')}</p>}
      {p.status === 'loading' && p.empty && <div class="bp-sugg-skel" aria-busy="true"><span class="sr-only">{p.words.loading}</span><Skeleton h={p.skeleton.h} lines={p.skeleton.lines} /></div>}
      {p.status === 'offline' && <p class="muted small bp-note">{p.words.offline}</p>}
      {p.status === 'error' && <p class="muted small bp-note">{p.words.error}</p>}
      {p.status === 'ok' && p.empty && <p class="muted small bp-note" data-testid={p.noneTestid}>{p.words.none}</p>}
    </>
  );
}

/** the menu of a moment: « Choisir ce moment », and « Voir sur la carte » when there is an address. `pick` null: the
    moment cannot be chosen (a time the server refuses), only seen */
export function momentActions(pick: (() => void) | null, see: (() => void) | null): MenuAction[] {
  return [
    ...(pick ? [{ key: 'pick', label: t('booking.preview.pick'), icon: <Check size={18} />, run: pick, testid: 'menu-pick' }] : []),
    ...(see ? [{ key: 'map', label: t('booking.preview.see'), icon: <MapIcon size={18} />, run: see, testid: 'menu-see-map' }] : [])
  ];
}

/** a row of the best moments that is being replaced (a new address, a new duration) still shows, dimmed, but does not
    take a tap: it was best for the question before */
export const staleClick = (stale: boolean, run: () => void) => () => { if (!stale) run(); };
