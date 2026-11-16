/* « Plages d'arrivée »: the owner's switch (behind a question), and once on: the minutes before / after the estimated
   arrival with a live example, the hours of the day (instead of the blocks), « Fixer les plages de demain » with the
   customers who could not be texted their window. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CalendarCheck, MessageSquare } from 'lucide-preact';
import { t, lang } from '../../../lib/i18n';
import { addDays, clock, today } from '../../../lib/dates';
import { settings, windowsOn, jobsOn, job as jobOf, customer, customerName } from '../../../data/select';
import { windowsSwitch, lockWindows, notify } from '../../../data/api';
import { pull } from '../../../data/sync';
import { isOwner, hasRole } from '../../../data/auth';
import { Panel, Field, Button, Banner, Switch, Seg, ask, attempt, toast } from '../../../ui';
import { smsHref } from '../../../shared/invoices/share';
import { NumInput, TimeInput } from '../fields';
import { spanOf, withDaySpan, exampleWindow, winRound } from './windows';
import { flexibleWithWindow, tellOutcome, type TellAnswer, type Untold } from './windowTexts';
import type { PartProps } from './BookingSection';

export function WindowsPanel({ d, set, err, clear, flag }: PartProps) {
  const winOn = windowsOn.value;
  const [busy, setBusy] = useState(false);
  const [untold, setUntold] = useState<Untold[]>([]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const mayLock = isOwner() || hasRole('office');
  const win = { before: d.win_before_min, after: d.win_after_min, round: d.win_round_min };
  const span = spanOf(d.blocks);
  const example = exampleWindow(15 * 60, win, span);

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
      // the server changed the setting and the coming appointments: bring both now (realtime brings them too, later)
      await Promise.all([pull('settings'), pull('jobs')]).catch(() => undefined);
      toast(t(on ? 'settings.booking.win.onDone' : 'settings.booking.win.offDone', { n }), { kind: 'ok' });
    } finally { if (alive.current) setBusy(false); }
  };

  const lock = async () => {
    if (busy) return;
    setBusy(true);
    setUntold([]);
    try {
      let n = 0;
      let ids: string[] = [];
      const ok = await attempt(async () => {
        const r = await lockWindows(addDays(today(), 1));
        n = r?.fixed ?? 0;
        // a newer server also fixes today's and lists the windows never told (`untold`); an older one answers `jobs` only
        ids = [...(r?.jobs ?? []), ...((r as { untold?: string[] } | undefined)?.untold ?? [])];
      });
      if (!ok) return;
      await pull('jobs').catch(() => undefined);
      // every flexible customer of today and tomorrow whose window is fixed is told (the server never texts the same
      // window twice): the ones just fixed, and the ones the server fixed by itself
      const tell = new Set([...ids, ...flexibleWithWindow(jobsOn(today())), ...flexibleWithWindow(jobsOn(addDays(today(), 1)))]);
      const answers: TellAnswer[] = await Promise.all([...tell].map((id) => notify('window', id)
        .then((a) => ({ id, ok: a.ok, status: a.status, code: a.code, message: a.message, phone: a.phone }), () => ({ id, failed: true }))));
      const r = tellOutcome(answers, settings.value.messages?.on?.window === false);
      if (alive.current) setUntold(r.untold);
      toast(n ? t('settings.booking.win.locked', { n }) : t('settings.booking.win.lockedNone'), { kind: r.untold.length ? 'bad' : 'ok' });
    } finally { if (alive.current) setBusy(false); }
  };

  /** « Heures de la journée »: a start after the end is said, not silently dropped */
  const daySpan = (start: number, end: number) => {
    if (end <= start) { flag('day', t('settings.booking.badBlock')); return; }
    set((x) => ({ ...x, blocks: withDaySpan(x.blocks, start, end) }));
    clear('day');
  };

  return (
    <Panel title={t('settings.booking.win.title')} help={t('settings.booking.win.help')} data-testid="booking-windows">
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>{t('settings.booking.win.lead')}</p>
        <Switch checked={winOn} disabled={!isOwner() || busy} onChange={(v) => void turn(v)} label={t('settings.booking.win.switch')}
          hint={t(!isOwner() ? 'settings.booking.win.ownerOnly' : winOn ? 'settings.booking.win.onHint' : 'settings.booking.win.offHint')} data-testid="windows-switch" />
        {winOn && (
          <>
            <div class="settings-grid-3">
              <Field label={t('settings.booking.win.before')} help={t('settings.booking.win.beforeHelp')} error={err.win_before_min}>
                <NumInput value={d.win_before_min} onValue={(v) => { set((x) => ({ ...x, win_before_min: v })); clear('win_before_min'); }}
                  unit={t('settings.booking.minutes')} invalid={!!err.win_before_min} aria-label={t('settings.booking.win.before')} data-testid="windows-before" />
              </Field>
              <Field label={t('settings.booking.win.after')} help={t('settings.booking.win.afterHelp')} error={err.win_after_min}>
                <NumInput value={d.win_after_min} onValue={(v) => { set((x) => ({ ...x, win_after_min: v })); clear('win_after_min'); }}
                  unit={t('settings.booking.minutes')} invalid={!!err.win_after_min} aria-label={t('settings.booking.win.after')} data-testid="windows-after" />
              </Field>
              <Field label={t('settings.booking.win.round')} help={t('settings.booking.win.roundHelp')}>
                <Seg value={String(winRound(d.win_round_min))} onValue={(v) => set((x) => ({ ...x, win_round_min: Number(v) }))} label={t('settings.booking.win.round')} data-testid="windows-round"
                  options={[{ value: '60', label: t('settings.booking.win.round60') }, { value: '30', label: t('settings.booking.win.round30') }, { value: '15', label: t('settings.booking.win.round15') }]} />
              </Field>
            </div>
            <p class="settings-example" data-testid="windows-example" aria-live="polite">
              {t('settings.booking.win.example', { eta: clock(15 * 60, lang.value), from: clock(example[0], lang.value), to: clock(example[1], lang.value) })}
            </p>
            <div class="settings-block" data-testid="windows-day">
              <b class="settings-block-name">{t('settings.booking.win.day')}</b>
              <label class="settings-block-time"><span class="small muted">{t('settings.booking.from')}</span>
                <TimeInput value={span[0]} onValue={(v) => daySpan(v, span[1])}
                  invalid={!!err.day} aria-label={`${t('settings.booking.win.day')}, ${t('settings.booking.from')}`} data-testid="windows-day-start" /></label>
              <label class="settings-block-time"><span class="small muted">{t('settings.booking.to')}</span>
                <TimeInput value={span[1]} onValue={(v) => daySpan(span[0], v)}
                  invalid={!!err.day} aria-label={`${t('settings.booking.win.day')}, ${t('settings.booking.to')}`} data-testid="windows-day-end" /></label>
              {err.day && <span class="field-error settings-block-err" role="alert">{err.day}</span>}
            </div>
            <p class="small muted" style={{ margin: 0 }}>{t('settings.booking.win.dayHelp')}</p>
            <div class="stack" data-testid="windows-flex">
              <p class="small muted" style={{ margin: 0 }}>{t('settings.booking.win.flexHelp')}</p>
              {mayLock && <div class="row-wrap"><Button icon={<CalendarCheck />} disabled={busy} onClick={() => lock()} data-testid="windows-lock">{t('settings.booking.win.lock')}</Button></div>}
              {untold.length > 0 && <UntoldList list={untold} />}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/** the customers whose window could not be texted (texts not plugged, no phone, refused…): to tell by hand */
function UntoldList(p: { list: Untold[] }) {
  return (
    <Banner kind="warn" title={t('settings.booking.win.untoldTitle', { n: p.list.length })} data-testid="windows-untold">
      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
        {p.list.map((u) => {
          const j = jobOf(u.id);
          const name = customerName(customer(j?.customer_id)) || `#${j?.number ?? ''}`;
          return (
            <li key={u.id} class="row-wrap">
              <span class="grow">{name}</span>
              {u.phone
                ? <Button size="sm" icon={<MessageSquare size={16} />} href={smsHref(u.phone, u.message || '')}>{t('settings.booking.win.untoldText')}</Button>
                : <span class="small muted">{t('settings.booking.win.untoldNoPhone')}</span>}
            </li>
          );
        })}
      </ul>
    </Banner>
  );
}
