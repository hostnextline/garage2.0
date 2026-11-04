/* Display pieces: page header, panels and rows, status, the job ticket, the PAYÉ stamp, money, avatars. */
import { Fragment, type ComponentChildren } from 'preact';
import { ChevronLeft, ChevronRight, Info, AlertTriangle, CircleCheck, OctagonAlert } from 'lucide-preact';
import { t, lang } from '../lib/i18n';
import { money } from '../lib/money';
import { initials } from '../lib/text';
import { goBack } from '../app/router';
import type { JobStatus } from '../data/types';
import { Help } from './Help';
import { IconButton } from './Button';

/* ---------- a screen ---------- */
export interface PageProps {
  title: ComponentChildren;
  sub?: ComponentChildren;
  /** where « Retour » goes when there is no history (the screen it came from) */
  back?: string;
  actions?: ComponentChildren;
  wide?: boolean;
  children?: ComponentChildren;
  help?: string;
  class?: string;
  'data-testid'?: string;
}
export function Page(p: PageProps) {
  return (
    <div class={`page${p.wide ? ' page-wide' : ''}${p.class ? ' ' + p.class : ''}`} data-testid={p['data-testid']}>
      <header class="page-head">
        {p.back != null && <IconButton class="page-back" icon={<ChevronLeft />} label={t('common.back')} onClick={() => goBack(p.back!)} />}
        <div class="grow page-titles">
          <h1>{p.title}{p.help && <> <Help text={p.help} /></>}</h1>
          {p.sub && <p class="page-sub">{p.sub}</p>}
        </div>
        {p.actions && <div class="page-actions">{p.actions}</div>}
      </header>
      {p.children}
    </div>
  );
}

/* ---------- panels (glass sections) and rows ---------- */
export interface PanelProps {
  title?: ComponentChildren; sub?: ComponentChildren; action?: ComponentChildren; help?: string;
  /** rows go edge to edge */
  flush?: boolean;
  /** a plain panel (no glass), for a panel inside a sheet */
  plain?: boolean;
  class?: string; id?: string; children?: ComponentChildren; 'data-tour'?: string; 'data-testid'?: string;
}
export function Panel(p: PanelProps) {
  const cls = ['panel', p.plain ? 'panel-plain' : 'glass', p.flush && 'panel-flush', p.class].filter(Boolean).join(' ');
  return (
    <section class={cls} id={p.id} data-tour={p['data-tour']} data-testid={p['data-testid']}>
      {(p.title || p.action) && (
        <div class="panel-head">
          <div class="grow">
            {p.title && <h2 class="panel-title">{p.title}{p.help && <> <Help text={p.help} /></>}</h2>}
            {p.sub && <p class="panel-sub">{p.sub}</p>}
          </div>
          {p.action}
        </div>
      )}
      {p.children}
    </section>
  );
}
export function Rows(p: { children?: ComponentChildren; class?: string; 'data-testid'?: string }) {
  return <div class={`rows ${p.class || ''}`} role="list" data-testid={p['data-testid']}>{p.children}</div>;
}
export interface RowItemProps {
  title: ComponentChildren; sub?: ComponentChildren; start?: ComponentChildren; end?: ComponentChildren;
  href?: string; onClick?: () => void; chevron?: boolean; class?: string; 'data-testid'?: string; 'data-tour'?: string;
}
export function RowItem(p: RowItemProps) {
  const inner = (
    <>
      {p.start}
      <span class="row-main">
        <span class="row-title">{p.title}</span>
        {p.sub && <span class="row-sub">{p.sub}</span>}
      </span>
      {(p.end || p.chevron) && <span class="row-end">{p.end}{p.chevron && <ChevronRight class="faint" size={18} aria-hidden="true" />}</span>}
    </>
  );
  const cls = `row-item ${p.class || ''}`;
  if (p.href) return <a class={cls} role="listitem" href={p.href} data-testid={p['data-testid']} data-tour={p['data-tour']}>{inner}</a>;
  if (p.onClick) return <button type="button" class={cls} role="listitem" onClick={p.onClick} data-testid={p['data-testid']} data-tour={p['data-tour']}>{inner}</button>;
  return <div class={cls} role="listitem" data-testid={p['data-testid']}>{inner}</div>;
}
export function Kv(p: { items: [ComponentChildren, ComponentChildren][]; class?: string }) {
  return (
    <dl class={`kv ${p.class || ''}`}>
      {p.items.filter(([, v]) => v != null && v !== '' && v !== false).map(([k, v], i) => <Fragment key={i}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
    </dl>
  );
}

/* ---------- empty, banners ---------- */
export function Empty(p: { title: ComponentChildren; text?: ComponentChildren; action?: ComponentChildren; icon?: ComponentChildren }) {
  return (
    <div class="empty">
      {p.icon && <span class="empty-icon" aria-hidden="true">{p.icon}</span>}
      <h3>{p.title}</h3>
      {p.text && <p style={{ margin: 0 }}>{p.text}</p>}
      {p.action}
    </div>
  );
}
export function Banner(p: { kind?: 'info' | 'warn' | 'bad' | 'ok'; title?: ComponentChildren; children?: ComponentChildren; action?: ComponentChildren; 'data-testid'?: string }) {
  const kind = p.kind || 'info';
  const Icon = kind === 'warn' ? AlertTriangle : kind === 'bad' ? OctagonAlert : kind === 'ok' ? CircleCheck : Info;
  return (
    <div class={`banner banner-${kind}`} role={kind === 'bad' ? 'alert' : 'status'} data-testid={p['data-testid']}>
      <Icon aria-hidden="true" />
      <div class="grow">{p.title && <b>{p.title}</b>}{p.children}</div>
      {p.action && <div class="banner-action">{p.action}</div>}
    </div>
  );
}

/* ---------- status ---------- */
export type Tone = 'booked' | 'en_route' | 'on_site' | 'done' | 'cancelled' | 'no_show' | 'paid' | 'unpaid' | 'draft' | 'void' | 'ok' | 'warn' | 'bad' | 'muted';
export function Pill(p: { tone: Tone; children: ComponentChildren; dot?: boolean; 'data-testid'?: string }) {
  const map: Record<string, string> = { ok: 'done', warn: 'en_route', bad: 'no_show', muted: 'cancelled' };
  return <span class={`pill pill-${map[p.tone] || p.tone}${p.dot === false ? ' pill-plain' : ''}`} data-testid={p['data-testid']}>{p.children}</span>;
}
const JOB_WORDS: Record<JobStatus, { fr: string; en: string }> = {
  booked: { fr: 'Réservé', en: 'Booked' }, en_route: { fr: 'En route', en: 'On the way' }, on_site: { fr: 'Sur place', en: 'On site' },
  done: { fr: 'Terminé', en: 'Done' }, cancelled: { fr: 'Annulé', en: 'Cancelled' }, no_show: { fr: 'Client absent', en: 'No-show' }
};
export function jobStatusWord(s: JobStatus, l = lang.value): string { return JOB_WORDS[s]?.[l === 'en' ? 'en' : 'fr'] || s; }
export function StatusPill(p: { status: JobStatus }) {
  return <Pill tone={p.status} data-testid="job-status">{jobStatusWord(p.status)}</Pill>;
}
const INV_WORDS = { draft: { fr: 'Brouillon', en: 'Draft' }, issued: { fr: 'À payer', en: 'Unpaid' }, partial: { fr: 'Payée en partie', en: 'Partly paid' }, paid: { fr: 'Payée', en: 'Paid' }, void: { fr: 'Annulée', en: 'Cancelled' } };
export function invoiceStatusWord(s: keyof typeof INV_WORDS, l = lang.value): string { return INV_WORDS[s]?.[l === 'en' ? 'en' : 'fr'] || s; }
export function InvoicePill(p: { status: 'draft' | 'issued' | 'paid' | 'void'; paidCents?: number }) {
  const key = p.status === 'issued' && (p.paidCents || 0) > 0 ? 'partial' : p.status;
  const tone: Tone = p.status === 'paid' ? 'paid' : p.status === 'void' ? 'void' : p.status === 'draft' ? 'draft' : 'unpaid';
  return <Pill tone={tone} data-testid="invoice-status">{invoiceStatusWord(key)}</Pill>;
}

/** the rubber stamp: PAYÉ on a paid invoice, ANNULÉ / ABSENT on a closed job */
export function Stamp(p: { kind?: 'paid' | 'cancelled' | 'no_show'; animate?: boolean; class?: string; word?: string }) {
  const kind = p.kind || 'paid';
  const word = p.word ? p.word : kind === 'paid' ? (lang.value === 'en' ? 'Paid' : 'Payé') : kind === 'cancelled' ? (lang.value === 'en' ? 'Cancelled' : 'Annulé') : (lang.value === 'en' ? 'No-show' : 'Absent');
  const cls = ['stamp', kind === 'cancelled' && 'stamp-muted', kind === 'no_show' && 'stamp-bad', p.animate && 'stamp-land', p.class].filter(Boolean).join(' ');
  return <span class={cls} role="img" aria-label={word} data-testid={`stamp-${kind}`}>{word}</span>;
}

/* ---------- the job ticket (a work order with its stub) ---------- */
export interface TicketProps {
  /** the stub: the stop number (big) and the block (small) */
  big: ComponentChildren; small: ComponentChildren;
  color?: string | null;
  title: ComponentChildren; sub?: ComponentChildren; meta?: ComponentChildren; status?: ComponentChildren;
  href?: string; onClick?: () => void; off?: boolean; class?: string; 'data-testid'?: string;
}
export function Ticket(p: TicketProps) {
  const inner = (
    <>
      <span class="ticket-stub" style={p.color ? { '--tc': p.color } : undefined}><b>{p.big}</b><span>{p.small}</span></span>
      <span class="ticket-body">
        <span class="ticket-top"><span class="ticket-name">{p.title}</span>{p.status}</span>
        {p.sub && <span class="ticket-sub">{p.sub}</span>}
        {p.meta && <span class="ticket-sub">{p.meta}</span>}
      </span>
    </>
  );
  const cls = `ticket${p.off ? ' is-off' : ''} ${p.class || ''}`;
  if (p.href) return <a class={cls} href={p.href} data-testid={p['data-testid']}>{inner}</a>;
  if (p.onClick) return <button type="button" class={cls} onClick={p.onClick} data-testid={p['data-testid']}>{inner}</button>;
  return <div class={cls} data-testid={p['data-testid']}>{inner}</div>;
}

/* ---------- people and numbers ---------- */
const AV = ['#D3000E', '#2F6FD0', '#1F8A53', '#B86E00', '#7347D1', '#0F7C82', '#C2185B', '#5D6B78'];
export function colorOf(name: string | null | undefined, color?: string | null): string {
  if (color) return color;
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AV[h % AV.length];
}
export function Avatar(p: { name: string | null | undefined; color?: string | null; size?: 'sm' | 'md' }) {
  return <span class={`avatar${p.size === 'sm' ? ' avatar-sm' : ''}`} style={{ '--av': colorOf(p.name, p.color) }} aria-hidden="true">{initials(p.name)}</span>;
}
export function Money(p: { cents: number | null | undefined; whole?: boolean; large?: boolean; class?: string; l?: string }) {
  return <span class={`money${p.large ? ' money-lg' : ''} ${p.class || ''}`}>{money(p.cents ?? 0, p.l || lang.value, { whole: p.whole })}</span>;
}
/** subtotal, TPS, TVQ, total (an invoice, an estimate) */
export function Totals(p: { subtotal: number; tps: number; tvq: number; total: number; paid?: number; l?: string; taxesOn?: boolean }) {
  const l = p.l || lang.value;
  const due = p.paid != null ? p.total - p.paid : null;
  return (
    <div class="totals" data-testid="totals">
      <span>{t('common.subtotal', undefined, l as 'fr' | 'en')}</span><span class="money">{money(p.subtotal, l)}</span>
      {p.taxesOn !== false && <><span>{t('common.tps', undefined, l as 'fr' | 'en')}</span><span class="money">{money(p.tps, l)}</span>
        <span>{t('common.tvq', undefined, l as 'fr' | 'en')}</span><span class="money">{money(p.tvq, l)}</span></>}
      <span class="total">{t('common.total', undefined, l as 'fr' | 'en')}</span><span class="total money" data-testid="total">{money(p.total, l)}</span>
      {p.paid != null && p.paid > 0 && <><span>{l === 'en' ? 'Paid' : 'Payé'}</span><span class="money">−{money(p.paid, l)}</span>
        <span class="total">{l === 'en' ? 'Balance' : 'Reste à payer'}</span><span class="total money" data-testid="balance">{money(Math.max(0, due || 0), l)}</span></>}
    </div>
  );
}

export function Tabs<V extends string>(p: { value: V; onValue: (v: V) => void; tabs: { value: V; label: ComponentChildren; count?: number }[]; label?: string }) {
  return (
    <div class="tabs" role="tablist" aria-label={p.label}>
      {p.tabs.map((x) => (
        <button key={x.value} type="button" role="tab" aria-selected={p.value === x.value} onClick={() => p.onValue(x.value)}>
          {x.label}{x.count != null && x.count > 0 && <span class="tab-count">{x.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Skeleton(p: { h?: number; w?: string; lines?: number }) {
  return <div aria-hidden="true" class="stack" style={{ gap: '10px' }}>{Array.from({ length: p.lines || 1 }, (_, i) => <div key={i} class="skel" style={{ height: `${p.h || 16}px`, width: i === (p.lines || 1) - 1 && (p.lines || 1) > 1 ? '60%' : p.w || '100%' }} />)}</div>;
}
export function Spinner(p: { label?: string }) {
  return <span class="row" role="status"><span class="spin" aria-hidden="true" style={{ width: '18px', height: '18px', borderRadius: '50%', border: '2px solid currentColor', borderRightColor: 'transparent', display: 'inline-block', animation: 'spin 700ms linear infinite' }} />{p.label && <span class="muted">{p.label}</span>}</span>;
}
