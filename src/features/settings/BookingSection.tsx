/* Réservations: « Départ des camions » first (where the trucks leave from: every route and arrival time is counted
   from there, it is shown on every map), then the times of the 3 blocks, how far ahead one can book and the numbers
   of the route estimate. Moving the start, or changing a number of the estimate, re-plans the coming appointments
   on the server (Part 17); the phone brings them back at once. */
import { useState } from 'preact/hooks';
import { t, lang } from '../../lib/i18n';
import { DEFAULT_BLOCKS, addDays, clock, today, type BlockKey } from '../../lib/dates';
import { settings, windowsOn } from '../../data/select';
import { saveSettings, windowsSwitch, lockWindows, notify } from '../../data/api';
import { flush, pull } from '../../data/sync';
import { isOwner, hasRole } from '../../data/auth';
import { Panel, Field, Input, PhoneInput, Banner, Button, Switch, Seg, ask, attempt, toast } from '../../ui';
import { Copy, Share2, ExternalLink, CalendarCheck } from 'lucide-preact';
import { appBase, movedTo } from '../../lib/config';
import { AddressField, type PlaceValue } from '../customers/AddressField';
import { MapView } from '../map/MapView';
import { useSectionDraft, SaveBar, Section, NumInput, TimeInput, rangeError } from './SectionFrame';
import { WIN_DEFAULTS, WIN_LIMITS, spanOf, withDaySpan, exampleWindow, spanTooShort } from './windows';

interface Booking {
  blocks: { key: BlockKey; start: number; end: number }[];
  horizon_days: number | null; speed_kmh: number | null; detour_pct: number | null; stop_min: number | null; unknown_min: number | null;
  min_block_min: number | null; near_km: number | null;
  home: { label: string; address: string; lat: number | null; lng: number | null };
  /** the number texted when a mechanic heads back after the last job (arrival time, live map) */
  return_phone: string;
  /** every mechanic sees every route and may do any of its jobs (the vehicles are nobody's own) */
  shared_routes: boolean;
  /** « Plages d'arrivée »: minutes before / after the estimated arrival, and the rounding (30 or 60) */
  win_before_min: number | null; win_after_min: number | null; win_round_min: number | null;
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
    return_phone: b.return_phone || '',
    shared_routes: !!(b as { shared_routes?: boolean }).shared_routes,
    win_before_min: b.win_before_min ?? WIN_DEFAULTS.before, win_after_min: b.win_after_min ?? WIN_DEFAULTS.after, win_round_min: b.win_round_min === 30 ? 30 : WIN_DEFAULTS.round
  };
  const winOn = windowsOn.value;
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
    if (winOn) {
      e.win_before_min = rangeError(d.win_before_min, WIN_LIMITS.before[0], WIN_LIMITS.before[1]);
      e.win_after_min = rangeError(d.win_after_min, WIN_LIMITS.after[0], WIN_LIMITS.after[1]);
      if (!e.win_before_min && !e.win_after_min && spanTooShort(spanOf(d.blocks), win)) e.day = t('settings.booking.win.dayShort');
    }
    const bad = d.blocks.some((_, i) => blockErr(i));
    setErr(e);
    if (bad || Object.values(e).some(Boolean)) { toast(t('settings.fixErrors'), { kind: 'bad' }); return; }
    const home = { ...(settings.value.booking.home || {}), label: d.home.label.trim() || 'Centrale', address: d.home.address.trim(), lat: d.home.lat, lng: d.home.lng };
    const replan = planOf(d) !== planOf(saved);
    const moved = d.home.lat !== saved.home.lat || d.home.lng !== saved.home.lng;
    const ok = await attempt(() => saveSettings('booking', {
      ...settings.value.booking, blocks: d.blocks, horizon_days: Math.round(d.horizon_days!), speed_kmh: d.speed_kmh, detour: Math.round(100 + d.detour_pct!) / 100,
      stop_min: Math.round(d.stop_min!), unknown_min: Math.round(d.unknown_min!), min_block_min: Math.round(d.min_block_min!), near_km: d.near_km, home,
      return_phone: d.return_phone.trim() || null, shared_routes: d.shared_routes,
      // the numbers of the windows are written only once the garage books by windows (nothing new in the settings before)
      ...(winOn ? { win_before_min: Math.round(d.win_before_min!), win_after_min: Math.round(d.win_after_min!), win_round_min: d.win_round_min === 30 ? 30 : 60 } : {})
    }), { ok: replan ? t(moved ? 'settings.booking.startMoved' : 'settings.booking.replanned') : t('settings.saved') });
    if (!ok) return;
    reset();
    // the server planned the coming appointments again: bring them now (realtime brings them too, a bit later)
    if (replan) void flush().then(() => pull('jobs')).catch(() => undefined);
  };

  /* ---------- « Plages d'arrivée » ---------- */
  const win = { before: d.win_before_min, after: d.win_after_min, round: d.win_round_min };
  const span = spanOf(d.blocks);
  const example = exampleWindow(15 * 60, win, span);
  const [busy, setBusy] = useState(false);
  const mayLock = isOwner() || hasRole('office');
  const turn = async (on: boolean) => {
    if (busy) return;
    const yes = await ask({ title: t(on ? 'settings.booking.win.askOn' : 'settings.booking.win.askOff'), text: t(on ? 'settings.booking.win.askOnText' : 'settings.booking.win.askOffText'),
      ok: t(on ? 'settings.booking.win.askOnOk' : 'settings.booking.win.askOffOk') });
    if (!yes) return;
    setBusy(true);
    try {
      let n = 0;
      const ok = await attempt(async () => { n = (await windowsSwitch(on))?.converted ?? 0; });
      if (!ok) return;
      // the server changed the setting and the coming appointments: bring both now
      await Promise.all([pull('settings'), pull('jobs')]).catch(() => undefined);
      toast(t(on ? 'settings.booking.win.onDone' : 'settings.booking.win.offDone', { n }), { kind: 'ok' });
    } finally { setBusy(false); }
  };
  const lock = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let n = 0;
      let ids: string[] = [];
      const ok = await attempt(async () => { const r = await lockWindows(addDays(today(), 1)); n = r?.fixed ?? 0; ids = r?.jobs ?? []; });
      if (!ok) return;
      // each customer whose window was just fixed is told (the text « Plage confirmée », if it is switched on)
      await Promise.all(ids.map((id) => notify('window', id).catch(() => undefined)));
      await pull('jobs').catch(() => undefined);
      toast(n ? t('settings.booking.win.locked', { n }) : t('settings.booking.win.lockedNone'), { kind: 'ok' });
    } finally { setBusy(false); }
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
            <Switch checked={d.shared_routes} onChange={(v) => set((x) => ({ ...x, shared_routes: v }))} label={t('settings.booking.shared')} hint={t('settings.booking.sharedHint')} data-testid="booking-shared" />
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
      {/* « Réservation en ligne »: put aside on 2026-11-09 (switched off on the server, booking.web.on = false) until it is reworked */}
      {false && <WebBooking />}
      <Panel title={t('settings.booking.win.title')} help={t('settings.booking.win.help')} data-testid="booking-windows">
        <div class="stack">
          <p class="muted" style={{ margin: 0 }}>{t('settings.booking.win.lead')}</p>
          <Switch checked={winOn} disabled={!isOwner() || busy} onChange={(v) => void turn(v)} label={t('settings.booking.win.switch')}
            hint={t(!isOwner() ? 'settings.booking.win.ownerOnly' : winOn ? 'settings.booking.win.onHint' : 'settings.booking.win.offHint')} data-testid="windows-switch" />
          {winOn && (
            <>
              <div class="settings-grid-3">
                <Field label={t('settings.booking.win.before')} help={t('settings.booking.win.beforeHelp')} error={err.win_before_min}>
                  <NumInput value={d.win_before_min} onValue={(v) => { set((x) => ({ ...x, win_before_min: v })); if (err.win_before_min) setErr({ ...err, win_before_min: null }); }}
                    unit={t('settings.booking.minutes')} invalid={!!err.win_before_min} aria-label={t('settings.booking.win.before')} data-testid="windows-before" />
                </Field>
                <Field label={t('settings.booking.win.after')} help={t('settings.booking.win.afterHelp')} error={err.win_after_min}>
                  <NumInput value={d.win_after_min} onValue={(v) => { set((x) => ({ ...x, win_after_min: v })); if (err.win_after_min) setErr({ ...err, win_after_min: null }); }}
                    unit={t('settings.booking.minutes')} invalid={!!err.win_after_min} aria-label={t('settings.booking.win.after')} data-testid="windows-after" />
                </Field>
                <Field label={t('settings.booking.win.round')} help={t('settings.booking.win.roundHelp')}>
                  <Seg value={d.win_round_min === 30 ? '30' : '60'} onValue={(v) => set((x) => ({ ...x, win_round_min: Number(v) }))} label={t('settings.booking.win.round')} data-testid="windows-round"
                    options={[{ value: '60', label: t('settings.booking.win.round60') }, { value: '30', label: t('settings.booking.win.round30') }]} />
                </Field>
              </div>
              <p class="settings-example" data-testid="windows-example" aria-live="polite">
                {t('settings.booking.win.example', { eta: clock(15 * 60, lang.value), from: clock(example[0], lang.value), to: clock(example[1], lang.value) })}
              </p>
              <div class="settings-block" data-testid="windows-day">
                <b class="settings-block-name">{t('settings.booking.win.day')}</b>
                <label class="settings-block-time"><span class="small muted">{t('settings.booking.from')}</span>
                  <TimeInput value={span[0]} onValue={(v) => { set((x) => ({ ...x, blocks: withDaySpan(x.blocks, v, spanOf(x.blocks)[1]) })); if (err.day) setErr({ ...err, day: null }); }}
                    invalid={!!err.day} aria-label={`${t('settings.booking.win.day')}, ${t('settings.booking.from')}`} data-testid="windows-day-start" /></label>
                <label class="settings-block-time"><span class="small muted">{t('settings.booking.to')}</span>
                  <TimeInput value={span[1]} onValue={(v) => { set((x) => ({ ...x, blocks: withDaySpan(x.blocks, spanOf(x.blocks)[0], v) })); if (err.day) setErr({ ...err, day: null }); }}
                    invalid={!!err.day} aria-label={`${t('settings.booking.win.day')}, ${t('settings.booking.to')}`} data-testid="windows-day-end" /></label>
                {err.day && <span class="field-error settings-block-err" role="alert">{err.day}</span>}
              </div>
              <p class="small muted" style={{ margin: 0 }}>{t('settings.booking.win.dayHelp')}</p>
              <div class="stack" data-testid="windows-flex">
                <p class="small muted" style={{ margin: 0 }}>{t('settings.booking.win.flexHelp')}</p>
                {mayLock && <div class="row-wrap"><Button icon={<CalendarCheck />} disabled={busy} onClick={() => void lock()} data-testid="windows-lock">{t('settings.booking.win.lock')}</Button></div>}
              </div>
            </>
          )}
        </div>
      </Panel>
      {!winOn && <Panel title={t('settings.booking.blocks')} help={t('settings.booking.blocksHelp')}>
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
      </Panel>}
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
