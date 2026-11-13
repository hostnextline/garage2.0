/* « Rappels d’huile » (#/oil): the cars due for an oil change, the one waiting the longest first, so the owner or the
   office calls their owner. « À appeler » (due today or before), « Bientôt » (the next 30 days), « Tous ». A line opens
   a sheet: call, text, book (the customer and the car already chosen), and what to note after the call (call back in a
   week / a month / 3 months, or stop calling for this car). The rule is due.ts; the note lives on the car. */
import { useState } from 'preact/hooks';
import { Phone, MessageSquareText, CalendarPlus, UserRound, Droplet, BellOff, RotateCcw, CalendarClock } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { may } from '../../app/routes';
import { setQuery } from '../../app/router';
import { t } from '../../lib/i18n';
import { addDays, addMonths, today, type Day } from '../../lib/dates';
import { e164 } from '../../lib/text';
import { customer, customerName, vehicle, staffName } from '../../data/select';
import { saveVehicle } from '../../data/api';
import { me } from '../../data/auth';
import { net } from '../../data/sync';
import type { OilMark } from '../../data/types';
import { Page, Panel, Rows, RowItem, Button, Seg, Empty, Skeleton, Pill, Sheet, Kv, Banner, Field, attempt } from '../../ui';
import { carName, dateShort, dayOfIso, nextLine, whenText } from '../customers/bits';
import type { OilRow } from './due';
import { oilList } from './select';
import './oil.css';

type Tab = 'call' | 'soon' | 'all';

/** « Dû depuis 12 jours », « Dû depuis 3 mois », « Dû le 4 déc. », « Rappeler le 20 juin » */
function dueWords(r: OilRow): string {
  if (r.state === 'stopped') return t('oil.row.stopped');
  if (r.late >= 0) return r.late > 60 ? t('oil.row.lateMonths', { n: Math.floor(r.late / 30) }) : t('oil.row.lateDays', { n: r.late });
  return r.callOn > r.due ? t('oil.row.againOn', { day: dateShort(r.callOn) }) : t('oil.row.dueOn', { day: dateShort(r.callOn) });
}
const tone = (r: OilRow) => (r.state === 'stopped' ? 'muted' : r.late > 30 ? 'bad' : r.late >= 0 ? 'warn' : r.state === 'soon' ? 'booked' : 'muted');
const carOf = (r: OilRow) => (r.vehicleId ? carName(vehicle(r.vehicleId)) : t('oil.row.noCar'));
const lastWords = (r: OilRow) => (r.lastOil && (!r.lastVisit || r.lastOil >= r.lastVisit) ? t('oil.row.lastOil', { day: dateShort(r.lastOil) }) : t('oil.row.lastVisit', { day: dateShort(r.lastVisit as Day) }));

export default function OilScreen({ query }: ScreenProps) {
  const all = oilList.value;
  const call = all.filter((r) => r.state === 'call');
  const soon = all.filter((r) => r.state === 'soon');
  const q = query.get('show');
  const tab: Tab = q === 'soon' || q === 'all' ? q : 'call';
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = all.find((r) => r.key === openKey) || null;
  // « Tous »: the ones to call, then the coming ones by date, the ones we no longer call last
  const list = tab === 'call' ? call : tab === 'soon' ? soon : [...all.filter((r) => r.state !== 'stopped'), ...all.filter((r) => r.state === 'stopped')];
  const ready = net.value.ready;
  const next = all.find((r) => r.state === 'soon' || r.state === 'later');

  let body;
  if (!all.length && !ready) {
    body = <Panel><div aria-busy="true" aria-label={t('oil.loading')}><Skeleton h={20} lines={5} /></div></Panel>;
  } else if (!list.length) {
    body = (
      <Panel>
        <Empty icon={<Droplet />} title={t(`oil.empty.${tab}Title`)}
          text={<>{t(`oil.empty.${tab}Text`)}{tab === 'call' && next && <> {t('oil.empty.callNext', { name: customerName(customer(next.customerId)), when: dueWords(next).toLowerCase() })}</>}</>}
          action={tab !== 'all' && all.length > 0 && <Button onClick={() => setQuery({ show: 'all' })} data-testid="oil-see-all">{t('oil.tabs.all')}</Button>} />
      </Panel>
    );
  } else {
    body = (
      <Panel flush data-testid="oil-list">
        <Rows>
          {list.map((r) => (
            <RowItem key={r.key} class="oil-row" onClick={() => setOpenKey(r.key)} chevron data-testid="oil-row"
              title={customerName(customer(r.customerId))}
              sub={<><span class="oil-car">{carOf(r)}</span><span>{lastWords(r)}</span>{r.next && <span class="oil-next"><CalendarClock size={14} aria-hidden="true" />{t('oil.row.next', { when: nextLine(r.next.day, r.next.block) })}</span>}</>}
              end={<Pill tone={tone(r)} dot={false}>{dueWords(r)}</Pill>} />
          ))}
        </Rows>
      </Panel>
    );
  }

  return (
    <Page title={t('oil.title')} help={t('oil.help')} sub={all.length ? t('oil.sub', { n: call.length }) : undefined} data-testid="oil-screen">
      <Seg value={tab} onValue={(v) => setQuery({ show: v === 'call' ? null : v })} label={t('oil.tabs.label')} class="oil-seg" data-testid="oil-tabs"
        options={[
          { value: 'call', label: call.length ? `${t('oil.tabs.call')} (${call.length})` : t('oil.tabs.call') },
          { value: 'soon', label: soon.length ? `${t('oil.tabs.soon')} (${soon.length})` : t('oil.tabs.soon') },
          { value: 'all', label: t('oil.tabs.all') }
        ]} />
      {!net.value.online && <Banner kind="info">{t('oil.empty.offline')}</Banner>}
      {body}
      <OilSheet row={open} onClose={() => setOpenKey(null)} />
    </Page>
  );
}

function OilSheet(p: { row: OilRow | null; onClose: () => void }) {
  const r = p.row;
  if (!r) return null;
  const c = customer(r.customerId);
  const tel = e164(c?.phone);
  const now = today();
  const note = async (mark: OilMark | null, ok: string) => {
    if (!r.vehicleId) return;
    const done = await attempt(() => saveVehicle({ id: r.vehicleId as string, oil_followup: mark }), { ok });
    if (done) p.onClose();
  };
  const again = (day: Day) => note({ at: new Date().toISOString(), by: me.value?.id || null, again_on: day }, t('oil.toast.again', { day: dateShort(day) }));
  const m = r.mark;
  const who = m ? staffName(m.by) : '';
  const said = !m ? null
    : m.stop ? t(who ? 'oil.sheet.saidStop' : 'oil.sheet.saidStopNoName', { at: dateShort(dayOfIso(m.at) || now), name: who })
      : m.again_on ? t(who ? 'oil.sheet.saidAgain' : 'oil.sheet.saidAgainNoName', { at: dateShort(dayOfIso(m.at) || now), name: who, day: dateShort(m.again_on) }) : null;
  const bookHref = `#/book?customer=${r.customerId}${r.vehicleId ? `&vehicle=${r.vehicleId}` : ''}`;
  return (
    <Sheet open onClose={p.onClose} title={customerName(c)} sub={carOf(r)} data-testid="oil-sheet">
      <div class="stack-lg">
        <Kv items={[
          [t('oil.sheet.phone'), c?.phone || <span class="muted">{t('oil.sheet.noPhone')}</span>],
          [t('oil.sheet.lastOil'), r.lastOil ? dateShort(r.lastOil) : t('oil.sheet.never')],
          [t('oil.sheet.lastVisit'), r.lastVisit && r.lastOil !== r.lastVisit ? dateShort(r.lastVisit) : null],
          [t('oil.sheet.due'), <Pill tone={tone(r)} dot={false}>{r.late >= 0 || r.state === 'stopped' ? `${dateShort(r.due)} (${dueWords(r).toLowerCase()})` : dateShort(r.due)}</Pill>],
          [t('oil.sheet.next'), r.next ? <a href={`#/job/${r.next.jobId}`}>{whenText(r.next.day, r.next.block)}</a> : null],
          [t('oil.sheet.said'), said]
        ]} />
        {r.next && <Banner kind="info">{t('oil.sheet.nextHint')}</Banner>}
        <div class="oil-actions">
          {tel && <Button variant="primary" icon={<Phone size={18} />} href={`tel:${tel}`} data-testid="oil-call">{t('oil.sheet.call')}</Button>}
          {tel && may.customers() && <Button icon={<MessageSquareText size={18} />} href={`#/customer/${r.customerId}?do=text`} data-testid="oil-text">{t('oil.sheet.text')}</Button>}
          {may.book() && <Button icon={<CalendarPlus size={18} />} href={r.next ? `#/job/${r.next.jobId}?do=edit` : bookHref} data-testid="oil-book">{t('oil.sheet.book')}</Button>}
          <Button variant="ghost" icon={<UserRound size={18} />} href={`#/customer/${r.customerId}`} data-testid="oil-file">{t('oil.sheet.file')}</Button>
        </div>
        {r.vehicleId ? (
          <Field label={t('oil.sheet.after')} hint={t('oil.sheet.afterHint')} group>
            <div class="oil-after">
              <Button onClick={() => again(addDays(now, 7))} data-testid="oil-in1w">{t('oil.sheet.in1w')}</Button>
              <Button onClick={() => again(addMonths(now, 1))} data-testid="oil-in1m">{t('oil.sheet.in1m')}</Button>
              <Button onClick={() => again(addMonths(now, 3))} data-testid="oil-in3m">{t('oil.sheet.in3m')}</Button>
              {r.state !== 'stopped' && <Button variant="ghost" icon={<BellOff size={18} />} confirm={t('oil.sheet.stopConfirm')}
                onClick={() => note({ at: new Date().toISOString(), by: me.value?.id || null, stop: true }, t('oil.toast.stop'))} data-testid="oil-stop">{t('oil.sheet.stop')}</Button>}
              {m && <Button variant="ghost" icon={<RotateCcw size={18} />} onClick={() => note(null, t('oil.toast.clear'))} data-testid="oil-clear">{t('oil.sheet.clear')}</Button>}
            </div>
          </Field>
        ) : <p class="muted small" style={{ margin: 0 }}>{t('oil.sheet.needCar')}</p>}
      </div>
    </Sheet>
  );
}
