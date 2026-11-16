/* Calm numbers and charts shared by the dashboard, the treasury and the inventory (DESIGN: the numbers are the heroes).
   - BigMoney: the key number, cents written smaller.
   - Meter: a goal bar with its words.
   - HBars: a ranked list with a thin bar under each label (the values are text, so it reads without the bars).
   - MonthBars: an inline SVG column chart drawn at the real width of its panel (text stays 13 px), one accent colour,
     the month shown in full and the others lighter, a dashed goal line, and the same numbers as a table below it. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Help } from '../../ui';
import './charts.css';

/* ---------- formats ---------- */
const nfs = new Map<string, Intl.NumberFormat>();
function nf(key: string, make: () => Intl.NumberFormat): Intl.NumberFormat {
  let f = nfs.get(key);
  if (!f) { f = make(); nfs.set(key, f); }
  return f;
}
const loc = (lang: string) => (lang === 'en' ? 'en-CA' : 'fr-CA');
/** 0.123 → "12 %" / "12%" */
export function pct(x: number | null | undefined, lang: string, digits = 0): string {
  if (x == null || !Number.isFinite(x)) return '';
  return nf(`p${lang}${digits}`, () => new Intl.NumberFormat(loc(lang), { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: 0 })).format(x);
}
/** 1234567 → "12,3 k $" / "$12.3K" (chart labels; the table below gives the exact amount) */
export function compactMoney(cents: number, lang: string, digits = 1): string {
  return nf(`c${lang}${digits}`, () => new Intl.NumberFormat(loc(lang), { style: 'currency', currency: 'CAD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: digits }))
    .format(cents / 100).replace(/CA\$/, '$');
}
export function decimal(x: number | null | undefined, lang: string, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '';
  return nf(`d${lang}${digits}`, () => new Intl.NumberFormat(loc(lang), { maximumFractionDigits: digits, minimumFractionDigits: 0 })).format(x);
}
/** "12 345" and ",67 $" (fr) / "$12,345" and ".67" (en) */
export function moneyParts(cents: number, lang: string): { main: string; minor: string } {
  const parts = nf(`m${lang}`, () => new Intl.NumberFormat(loc(lang), { style: 'currency', currency: 'CAD', minimumFractionDigits: 2, maximumFractionDigits: 2 })).formatToParts(cents / 100);
  let main = '', minor = '', inMinor = false;
  for (const p of parts) {
    if (p.type === 'decimal') inMinor = true;
    const v = p.type === 'currency' ? p.value.replace(/^CA\$$/, '$') : p.value;
    if (inMinor) minor += v; else main += v;
  }
  return { main: main.trim(), minor: minor.replace(/^\s+$/, '') };
}

/* ---------- pieces ---------- */
export function BigMoney(p: { cents: number; lang: string; size?: 'xl' | 'lg' | 'md'; class?: string; 'data-testid'?: string }) {
  const { main, minor } = moneyParts(p.cents, p.lang);
  return (
    <span class={`dash-big dash-big-${p.size || 'xl'} ${p.class || ''}`} data-testid={p['data-testid']}>
      {main}<span class="dash-big-minor">{minor}</span>
    </span>
  );
}

export function Meter(p: { value: number | null; label: string; 'data-testid'?: string }) {
  const v = Math.max(0, p.value ?? 0);
  return (
    <div class={`dash-meter${v >= 1 ? ' is-full' : ''}`} role="progressbar" aria-label={p.label} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(v, 9.99) * 100)} aria-valuetext={p.label} data-testid={p['data-testid']}>
      <span style={{ width: `${Math.min(100, v * 100)}%` }} />
    </div>
  );
}

export interface HBar { key: string; label: ComponentChildren; sub?: ComponentChildren; value: number; display: ComponentChildren; color?: string | null; href?: string }
export function HBars(p: { items: HBar[]; label: string; 'data-testid'?: string }) {
  const max = Math.max(1, ...p.items.map((i) => Math.abs(i.value)));
  return (
    <ul class="dash-hbars" aria-label={p.label} data-testid={p['data-testid']}>
      {p.items.map((i) => {
        const body = (
          <>
            <span class="dash-hbar-top">
              <span class="dash-hbar-label">{i.color && <span class="dash-dot" style={{ background: i.color }} aria-hidden="true" />}<span class="ellipsis">{i.label}</span></span>
              <span class="dash-hbar-value num">{i.display}</span>
            </span>
            {i.sub && <span class="dash-hbar-sub">{i.sub}</span>}
            <span class="dash-hbar-track" aria-hidden="true">
              <span style={{ width: `${Math.max(i.value > 0 ? 2 : 0, (Math.abs(i.value) / max) * 100)}%`, ...(i.color ? { background: i.color } : {}) }} />
            </span>
          </>
        );
        return <li key={i.key}>{i.href ? <a class="dash-hbar dash-hbar-link" href={i.href}>{body}</a> : <span class="dash-hbar">{body}</span>}</li>;
      })}
    </ul>
  );
}

/** the width of an element, followed as it changes */
function useWidth<T extends HTMLElement>(fallback = 340) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => { const x = Math.round(el.getBoundingClientRect().width); if (x > 0) setW(x); };
    read();
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', read); return () => window.removeEventListener('resize', read); }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

export interface MonthBar { key: string; label: string; long: string; value: number; display: string; short: string; exact: string; current?: boolean }
export function MonthBars(p: { items: MonthBar[]; title: string; goal?: { value: number; label: string } | null; tableLabel: string; colMonth: string; colValue: string; 'data-testid'?: string }) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const H = 220, top = 26, bottom = 30, left = 4, right = 4;
  const inner = H - top - bottom;
  const goal = p.goal && p.goal.value > 0 ? p.goal : null;
  const max = Math.max(1, ...p.items.map((i) => i.value), goal ? goal.value : 0) * 1.08;
  const slot = (w - left - right) / Math.max(1, p.items.length);
  const bw = Math.max(14, Math.min(56, slot * 0.58));
  const narrow = slot < 66;
  const y = (v: number) => top + inner - (Math.max(0, v) / max) * inner;
  const summary = p.items.map((i) => `${i.long} : ${i.exact}`).join(', ');
  return (
    <div class="dash-months" data-testid={p['data-testid']}>
      <div ref={ref} class="dash-months-chart">
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`${p.title}. ${summary}`}>
          <line x1={left} x2={w - right} y1={top + inner + 0.5} y2={top + inner + 0.5} class="dash-axis" />
          {p.items.map((i, k) => {
            const cx = left + slot * k + slot / 2;
            const yy = y(i.value);
            const h = Math.max(i.value > 0 ? 2 : 0, top + inner - yy);
            return (
              <g key={i.key} class={i.current ? 'is-current' : ''}>
                <rect x={cx - bw / 2} y={top + inner - h} width={bw} height={h} rx={Math.min(6, bw / 4)} class="dash-bar" />
                <text x={cx} y={Math.min(yy, top + inner) - 7} text-anchor="middle" class="dash-bar-value">{narrow ? i.short : i.display}</text>
                <text x={cx} y={H - 9} text-anchor="middle" class="dash-bar-label">{i.label}</text>
              </g>
            );
          })}
          {goal && (
            <g class="dash-goal">
              <line x1={left} x2={w - right} y1={y(goal.value)} y2={y(goal.value)} />
              <text x={w - right} y={y(goal.value) - 6} text-anchor="end">{goal.label}</text>
            </g>
          )}
        </svg>
      </div>
      <details class="dash-table">
        <summary>{p.tableLabel}</summary>
        <table>
          <thead><tr><th scope="col">{p.colMonth}</th><th scope="col" class="right">{p.colValue}</th></tr></thead>
          <tbody>{p.items.map((i) => <tr key={i.key}><th scope="row">{i.long}</th><td class="right num">{i.exact}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

/** one number of a grid of numbers (inside one panel, separated by hairlines: not a pile of cards) */
export function Stat(p: { label: ComponentChildren; value: ComponentChildren; sub?: ComponentChildren; help?: string; href?: string; linkLabel?: string; tone?: 'warn' | 'bad' | 'ok'; 'data-testid'?: string }) {
  const body = (
    <>
      <span class={`dash-stat-value num${p.tone ? ` is-${p.tone}` : ''}`}>{p.value}</span>
      {p.sub && <span class="dash-stat-sub">{p.sub}</span>}
    </>
  );
  // the « ? » stays outside the link (a button inside a link is not allowed)
  return (
    <div class={`dash-stat${p.href ? ' has-link' : ''}`} data-testid={p['data-testid']}>
      <span class="dash-stat-label">{p.label}{p.help && <Help text={p.help} />}</span>
      {p.href ? <a class="dash-stat-link" href={p.href} aria-label={p.linkLabel}>{body}</a> : body}
    </div>
  );
}
export function StatGrid(p: { children: ComponentChildren; class?: string }) {
  return <div class={`dash-stats ${p.class || ''}`}>{p.children}</div>;
}
