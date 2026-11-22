/* « Plages d'arrivée »: the owner's switch (behind a question), and once on: the minutes before / after the estimated
   arrival with a live example, the hours of the day (instead of the blocks), « Fixer les plages de demain », which then
   opens tomorrow's send list (Part 28, REARRANGE.md §3.6, days F19: the one rule and the one lease of « Envoyer les
   heures aux clients »; no window text job by job any more; today's customers due are on Aujourd'hui's line). After the
   switch, what the server says to do by hand (R87): the customers told a window that is no longer inside their block
   (call / text), and the days left as they were; kept for the visit until « Fermer », so leaving Réglages does not lose
   whom to call (settings-team-r2-4). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { CalendarCheck, MessageSquare, Phone } from 'lucide-preact';
import { t, lang } from '../../../lib/i18n';
import { addDays, clock, today } from '../../../lib/dates';
import { windowsOn, job as jobOf, customer, customerName } from '../../../data/select';
import { windowsSwitch, lockWindows } from '../../../data/api';
import { pull } from '../../../data/sync';
import { access, isOwner, hasRole } from '../../../data/auth';
import { Panel, Field, Button, Banner, Switch, Seg, ask, attempt, toast } from '../../../ui';
import { smsHref } from '../../../shared/invoices/share';
import { e164 } from '../../../lib/text';
import { NumInput, TimeInput } from '../fields';
import { spanOf, withDaySpan, exampleWindow, winRound } from './windows';
import { openTell } from '../../../shared/jobs/TellHost';
import { backOutcome, blockNow, toldWindow, toCallText, keptWords, type BackOutcome } from './backToBlocks';
import type { PartProps } from './BookingSection';

/** what the last switch said to do by hand, for the visit only (no storage key: a reload forgets it), per person (another
    account signed in on this device never sees it): Réservations opened again shows it again (settings-team-r2-4) */
export const lastBack = signal<{ who: string; out: BackOutcome } | null>(null);

export function WindowsPanel({ d, set, err, clear, flag }: PartProps) {
  const winOn = windowsOn.value;
  const [busy, setBusy] = useState(false);
  const who = access.value?.id || '';
  const last = lastBack.value;
  const back = last && last.who === who ? last.out : null;
  const setBack = (out: BackOutcome | null) => { lastBack.value = out && (out.toCall.length || out.kept.length) ? { who, out } : null; };
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
    setBack(null);
    try {
      let n = 0;
      let answer: unknown = null;
      const ok = await attempt(async () => { answer = await windowsSwitch(on); n = (answer as { converted?: number } | null)?.converted ?? 0; });
      if (!ok) return;
      // a newer server lists whom to call (back to the blocks only) and the days it left as they were; an older one neither
      // kept even when the owner has left Réglages meanwhile: it shows when Réservations opens again
      const out = backOutcome(answer);
      setBack(on ? { toCall: [], kept: out.kept } : out);
      // the server changed the setting and the coming appointments: bring both now (realtime brings them too, later)
      await Promise.all([pull('settings'), pull('jobs')]).catch(() => undefined);
      toast(t(on ? 'settings.booking.win.onDone' : 'settings.booking.win.offDone', { n }), { kind: 'ok' });
    } finally { if (alive.current) setBusy(false); }
  };

  const lock = async () => {
    if (busy) return;
    setBusy(true);
    try {
      let n = 0;
      const tomorrow = addDays(today(), 1);
      const ok = await attempt(async () => {
        const r = await lockWindows(tomorrow);
        n = r?.fixed ?? 0;
      });
      if (!ok) return;
      await pull('jobs').catch(() => undefined);
      toast(n ? t('settings.booking.win.locked', { n }) : t('settings.booking.win.lockedNone'), { kind: 'ok' });
      // the customers given their window (and any other of tomorrow not told their hours) get it with the day's button:
      // its list says who, nothing goes before « Envoyer à N clients »
      openTell(tomorrow);
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
        {back && back.toCall.length > 0 && <ToCallList list={back.toCall} onClose={() => setBack({ ...back, toCall: [] })} />}
        {back && back.kept.length > 0 && <KeptList list={back.kept} onClose={() => setBack({ ...back, kept: [] })} />}
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
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/** after « Revenir aux blocs »: the customers told a window that is not inside their block now, to call or text by hand */
function ToCallList(p: { list: BackOutcome['toCall']; onClose: () => void }) {
  const l = lang.value;
  return (
    <Banner kind="warn" title={t('settings.booking.win.backTitle', { n: p.list.length })} data-testid="windows-back"
      action={<Button size="sm" variant="ghost" onClick={p.onClose} data-testid="windows-back-close">{t('common.close')}</Button>}>
      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none' }}>
        {p.list.map((c) => {
          const j = jobOf(c.job_id);
          const who = customer(c.customer_id ?? j?.customer_id);
          const name = customerName(who) || `#${j?.number ?? ''}`;
          const tel = who?.phone ? e164(who.phone) || who.phone : '';
          const told = toldWindow(c, l);
          return (
            <li key={c.job_id} class="row-wrap" data-testid="windows-back-row">
              <span class="grow"><b>{name}</b><br />
                <span class="small muted">{told && <>{t('settings.booking.win.backTold', { told })} · </>}{t('settings.booking.win.backNow', { when: blockNow(c.day, c.block, l) })}</span></span>
              {tel
                ? <>
                    <Button size="sm" icon={<Phone size={16} />} href={`tel:${tel}`}>{t('common.call')}</Button>
                    <Button size="sm" icon={<MessageSquare size={16} />} href={smsHref(who?.phone, toCallText(c, who?.first_name ?? null, who?.lang === 'en' ? 'en' : 'fr'))}>{t('settings.booking.win.untoldText')}</Button>
                  </>
                : <span class="small muted">{t('settings.booking.win.untoldNoPhone')}</span>}
            </li>
          );
        })}
      </ul>
    </Banner>
  );
}

/** the days and blocks the server did not plan again (an appointment would have gone to « À placer ») */
function KeptList(p: { list: BackOutcome['kept']; onClose: () => void }) {
  const l = lang.value;
  return (
    <Banner kind="warn" title={t('settings.booking.win.keptTitle', { n: p.list.length })} data-testid="windows-kept"
      action={<Button size="sm" variant="ghost" onClick={p.onClose} data-testid="windows-kept-close">{t('common.close')}</Button>}>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {p.list.map((k) => <li key={`${k.day}-${k.block}`}>{keptWords(k, l)}</li>)}
      </ul>
    </Banner>
  );
}
