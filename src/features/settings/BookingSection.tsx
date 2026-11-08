/* Réservations: « Départ des camions » first (where the trucks leave from: every route and arrival time is counted
   from there, it is shown on every map), then the times of the 3 blocks, how far ahead one can book and the numbers
   of the route estimate. Moving the start, or changing a number of the estimate, re-plans the coming appointments
   on the server (Part 17); the phone brings them back at once. */
import { useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { DEFAULT_BLOCKS, type BlockKey } from '../../lib/dates';
import { settings } from '../../data/select';
import { saveSettings } from '../../data/api';
import { flush, pull } from '../../data/sync';
import { Panel, Field, Input, PhoneInput, Banner, Button, Switch, attempt, toast } from '../../ui';
import { Copy, Share2, ExternalLink } from 'lucide-preact';
import { appBase, movedTo } from '../../lib/config';
import { AddressField, type PlaceValue } from '../customers/AddressField';
import { MapView } from '../map/MapView';
import { useSectionDraft, SaveBar, Section, NumInput, TimeInput, rangeError } from './SectionFrame';

interface Booking {
  blocks: { key: BlockKey; start: number; end: number }[];
  horizon_days: number | null; speed_kmh: number | null; detour_pct: number | null; stop_min: number | null; unknown_min: number | null;
  min_block_min: number | null; near_km: number | null;
  home: { label: string; address: string; lat: number | null; lng: number | null };
  /** the number texted when a mechanic heads back after the last job (arrival time, live map) */
  return_phone: string;
}
const NUMS: { k: keyof Booking; min: number; max: number; unit: 'days' | 'kmh' | 'pct' | 'min' | 'km'; decimals?: boolean }[] = [
  { k: 'horizon_days', min: 7, max: 365, unit: 'days' },
  { k: 'speed_kmh', min: 10, max: 110, unit: 'kmh' },
  { k: 'detour_pct', min: 0, max: 100, unit: 'pct' },
  { k: 'stop_min', min: 0, max: 60, unit: 'min' },
  { k: 'unknown_min', min: 5, max: 120, unit: 'min' },
  { k: 'min_block_min', min: 15, max: 240, unit: 'min' },
  { k: 'near_km', min: 1, max: 50, unit: 'km', decimals: true }
];
const LABEL: Record<string, string> = { horizon_days: 'horizon', speed_kmh: 'speed', detour_pct: 'detour', stop_min: 'stop', unknown_min: 'unknown', min_block_min: 'minBlock', near_km: 'near' };
/** what the planner counts: when one of these changes, the coming appointments are planned again */
const planOf = (x: Pick<Booking, 'blocks' | 'speed_kmh' | 'detour_pct' | 'stop_min' | 'unknown_min' | 'min_block_min' | 'home'>) =>
  JSON.stringify([x.home.lat, x.home.lng, x.speed_kmh, x.detour_pct, x.stop_min, x.unknown_min, x.min_block_min, x.blocks.map((b) => [b.key, b.start, b.end])]);

export function BookingSection() {
  const b = settings.value.booking;
  const blocksSaved = (b.blocks?.length ? b.blocks : DEFAULT_BLOCKS).map((x) => ({ key: x.key, start: x.start, end: x.end }));
  const saved: Booking = {
    blocks: (['am', 'pm', 'eve'] as BlockKey[]).map((k) => blocksSaved.find((x) => x.key === k) || DEFAULT_BLOCKS.find((x) => x.key === k)!),
    horizon_days: b.horizon_days, speed_kmh: b.speed_kmh, detour_pct: Math.round(((Number(b.detour) || 1.3) - 1) * 100), stop_min: b.stop_min,
    unknown_min: b.unknown_min, min_block_min: b.min_block_min, near_km: b.near_km,
    home: { label: b.home?.label || 'Centrale', address: b.home?.address || '', lat: b.home?.lat ?? null, lng: b.home?.lng ?? null },
    return_phone: b.return_phone || ''
  };
  const { draft: d, set, dirty, reset } = useSectionDraft<Booking>('booking', saved);
  const [err, setErr] = useState<Record<string, string | null>>({});
  const unit = (u: string) => (u === 'days' ? t('settings.booking.days') : u === 'kmh' ? 'km/h' : u === 'pct' ? '%' : u === 'km' ? 'km' : t('settings.booking.minutes'));
  const setBlock = (i: number, part: 'start' | 'end', v: number) => set((x) => ({ ...x, blocks: x.blocks.map((bl, k) => (k === i ? { ...bl, [part]: v } : bl)) }));
  const blockErr = (i: number): string | null => {
    const bl = d.blocks[i];
    if (bl.end <= bl.start) return t('settings.booking.badBlock');
    if (i > 0 && bl.start < d.blocks[i - 1].end) return t('settings.booking.overlap');
    return null;
  };

  const save = async () => {
    const e: Record<string, string | null> = {};
    for (const n of NUMS) e[n.k] = rangeError(d[n.k] as number | null, n.min, n.max);
    const bad = d.blocks.some((_, i) => blockErr(i));
    setErr(e);
    if (bad || Object.values(e).some(Boolean)) { toast(t('settings.fixErrors'), { kind: 'bad' }); return; }
    const home = { ...(settings.value.booking.home || {}), label: d.home.label.trim() || 'Centrale', address: d.home.address.trim(), lat: d.home.lat, lng: d.home.lng };
    const replan = planOf(d) !== planOf(saved);
    const moved = d.home.lat !== saved.home.lat || d.home.lng !== saved.home.lng;
    const ok = await attempt(() => saveSettings('booking', {
      ...settings.value.booking, blocks: d.blocks, horizon_days: Math.round(d.horizon_days!), speed_kmh: d.speed_kmh, detour: Math.round(100 + d.detour_pct!) / 100,
      stop_min: Math.round(d.stop_min!), unknown_min: Math.round(d.unknown_min!), min_block_min: Math.round(d.min_block_min!), near_km: d.near_km, home,
      return_phone: d.return_phone.trim() || null
    }), { ok: replan ? t(moved ? 'settings.booking.startMoved' : 'settings.booking.replanned') : t('settings.saved') });
    if (!ok) return;
    reset();
    // the server planned the coming appointments again: bring them now (realtime brings them too, a bit later)
    if (replan) void flush().then(() => pull('jobs')).catch(() => undefined);
  };

  const place: PlaceValue = { address: d.home.address, unit: null, postal_code: null, lat: d.home.lat, lng: d.home.lng };
  const hasPos = d.home.lat != null && d.home.lng != null;
  return (
    <Section testid="settings-booking" bar={<SaveBar dirty={dirty} onSave={save} onReset={() => { reset(); setErr({}); }} />}>
      <Panel title={t('settings.booking.start')} help={t('settings.booking.startHelp')} data-testid="booking-start">
        <div class="settings-centrale">
          <div class="stack">
            <div class="settings-address" data-testid="centrale-address">
              <AddressField value={place} label={t('settings.booking.startAddress')}
                onValue={(v) => set((x) => ({ ...x, home: { ...x.home, address: v.address, lat: v.lat, lng: v.lng } }))} />
            </div>
            {d.home.address && !hasPos && <Banner kind="warn">{t('settings.booking.noPos')}</Banner>}
            <Field label={t('settings.booking.label')} help={t('settings.booking.labelHelp')}>
              <Input value={d.home.label} onValue={(v) => set((x) => ({ ...x, home: { ...x.home, label: v } }))} maxLength={30} autoComplete="off" data-testid="booking-start-label" />
            </Field>
            <Field label={t('settings.booking.returnPhone')} help={t('settings.booking.returnPhoneHelp')}>
              <PhoneInput value={d.return_phone} onValue={(v) => set((x) => ({ ...x, return_phone: v }))} />
            </Field>
            {dirty && planOf(d) !== planOf(saved) && <p class="small muted settings-replan" data-testid="booking-replan-note">{t('settings.booking.replanNote')}</p>}
          </div>
          {hasPos && (
            <figure class="settings-minimap">
              <MapView height="220px" controls={false} label={t('settings.booking.mapLabel')}
                markers={[{ id: 'home', kind: 'home', lat: d.home.lat!, lng: d.home.lng!, label: d.home.label || 'Centrale', title: d.home.address }]} />
              {d.home.address && <figcaption class="small muted">{d.home.address}</figcaption>}
            </figure>
          )}
        </div>
      </Panel>
      <WebBooking />
      <Panel title={t('settings.booking.blocks')} help={t('settings.booking.blocksHelp')}>
        <div class="settings-blocks">
          {d.blocks.map((bl, i) => {
            const e = blockErr(i);
            const name = t(`common.blocks.${bl.key}`);
            return (
              <div key={bl.key} class="settings-block" data-testid={`block-${bl.key}`}>
                <b class="settings-block-name">{name}</b>
                <label class="settings-block-time"><span class="small muted">{t('settings.booking.from')}</span>
                  <TimeInput value={bl.start} onValue={(v) => setBlock(i, 'start', v)} invalid={!!e} aria-label={`${name}, ${t('settings.booking.from')}`} /></label>
                <label class="settings-block-time"><span class="small muted">{t('settings.booking.to')}</span>
                  <TimeInput value={bl.end} onValue={(v) => setBlock(i, 'end', v)} invalid={!!e} aria-label={`${name}, ${t('settings.booking.to')}`} /></label>
                {e && <span class="field-error settings-block-err" role="alert">{e}</span>}
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel title={t('settings.booking.plan')} help={t('settings.booking.planHelp')}>
        <div class="settings-grid-3">
          {NUMS.map((n) => (
            <Field key={n.k} label={t(`settings.booking.${LABEL[n.k]}`)} help={t(`settings.booking.${LABEL[n.k]}Help`)} error={err[n.k]}>
              <NumInput value={d[n.k] as number | null} onValue={(v) => { set((x) => ({ ...x, [n.k]: v })); if (err[n.k]) setErr({ ...err, [n.k]: null }); }}
                unit={unit(n.unit)} decimals={n.decimals} invalid={!!err[n.k]} aria-label={t(`settings.booking.${LABEL[n.k]}`)} data-testid={`booking-${n.k}`} />
            </Field>
          ))}
        </div>
      </Panel>
    </Section>
  );
}

/** « Réservation en ligne »: the public link where customers book themselves (the best moments for the routes). */
export function webLink(): string { return `${movedTo() || appBase()}client.html#reserver`; }
function WebBooking() {
  const on = settings.value.booking.web?.on === true;
  const link = webLink();
  const turn = (v: boolean) => attempt(() => saveSettings('booking', { ...settings.value.booking, web: { ...(settings.value.booking.web || {}), on: v } }),
    { ok: t(v ? 'settings.booking.webOnDone' : 'settings.booking.webOffDone') });
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast(t('settings.booking.webCopied')); }
    catch { toast(t('settings.booking.webCopyFail'), { kind: 'bad' }); }
  };
  const share = async () => {
    try { await navigator.share({ title: t('settings.booking.webShareTitle'), url: link }); } catch { /* closed */ }
  };
  return (
    <Panel title={t('settings.booking.web')} help={t('settings.booking.webHelp')} data-testid="booking-web">
      <div class="stack">
        <Switch checked={on} onChange={(v) => void turn(v)} label={t('settings.booking.webOn')} hint={t(on ? 'settings.booking.webOnHint' : 'settings.booking.webOffHint')} data-testid="booking-web-on" />
        {on && (
          <>
            <Field label={t('settings.booking.webLink')} hint={t('settings.booking.webLinkHint')}>
              <input class="input" value={link} readOnly onFocus={(e) => e.currentTarget.select()} aria-label={t('settings.booking.webLink')} data-testid="booking-web-link" />
            </Field>
            <div class="row-wrap">
              <Button variant="primary" icon={<Copy />} onClick={copy} data-testid="booking-web-copy">{t('settings.booking.webCopy')}</Button>
              {typeof navigator !== 'undefined' && 'share' in navigator && <Button icon={<Share2 />} onClick={share}>{t('settings.booking.webShare')}</Button>}
              <Button variant="ghost" icon={<ExternalLink />} href={link} target="_blank">{t('settings.booking.webOpen')}</Button>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
