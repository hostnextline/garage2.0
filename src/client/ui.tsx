/* Small pieces of the customer's page (the team app's kit is not used here: it brings the whole app with it). */
import type { ComponentChildren } from 'preact';
import { Phone, Info, CircleCheck, TriangleAlert, OctagonAlert, Languages, Mail, MapPin } from 'lucide-preact';
import { Button } from '../ui/Button';
import { ct, type CLang } from './i18n';
import { telHref, phoneText, cad } from './format';
import type { Garage } from './api';

export function garageName(g: Garage | null | undefined, l: CLang): string { return g?.name || ct(l, 'title'); }

/** the garage on top: logo, name, its phone, a call button */
export function Header(p: { garage: Garage | null; l: CLang }) {
  const name = garageName(p.garage, p.l);
  const tel = telHref(p.garage?.phone);
  return (
    <header class="cl-wrap cl-head">
      <img class="cl-logo" src="./logo-his.png" srcset="./icons/icon-192.png 192w, ./logo-his.png 320w" sizes="48px" alt="" width={48} height={48} />
      <div class="cl-brand">
        <span class="cl-name">{name}</span>
        {tel && <a class="cl-tagline" href={tel}>{phoneText(p.garage?.phone)}</a>}
      </div>
      {tel && <Button class="cl-call" href={tel} icon={<Phone />} label={ct(p.l, 'callLabel', { garage: name, phone: phoneText(p.garage?.phone) })}>{ct(p.l, 'call')}</Button>}
    </header>
  );
}

/** the garage at the bottom: who, where, how to reach, and the other language */
export function Footer(p: { garage: Garage | null; l: CLang; onLang: () => void }) {
  const g = p.garage;
  const tel = telHref(g?.phone);
  return (
    <footer class="cl-wrap cl-foot">
      <div class="cl-foot-id">
        <b>{garageName(g, p.l)}</b>
        {g?.address && <span>{g.address}</span>}
        {tel && <a href={tel}>{phoneText(g?.phone)}</a>}
        {g?.email && <a href={`mailto:${g.email}`}>{g.email}</a>}
      </div>
      <div class="cl-foot-links">
        <Button variant="ghost" icon={<Languages />} label={ct(p.l, 'otherLangLabel')} onClick={p.onLang} data-testid="client-lang">{ct(p.l, 'otherLang')}</Button>
      </div>
    </footer>
  );
}

export function Note(p: { kind?: 'info' | 'ok' | 'warn' | 'bad'; title?: ComponentChildren; children?: ComponentChildren; icon?: ComponentChildren; class?: string; 'data-testid'?: string }) {
  const kind = p.kind || 'info';
  const Icon = kind === 'ok' ? CircleCheck : kind === 'warn' ? TriangleAlert : kind === 'bad' ? OctagonAlert : Info;
  return (
    <div class={`cl-note cl-note-${kind} ${p.class || ''}`} role={kind === 'bad' ? 'alert' : 'status'} data-testid={p['data-testid']}>
      {p.icon ?? <Icon aria-hidden="true" />}
      <div>{p.title && <b>{p.title}</b>}{p.children}</div>
    </div>
  );
}

/** the PAYÉ stamp (the word is written in capitals by the stamp's style) */
export function Stamp(p: { l: CLang; animate?: boolean }) {
  const word = ct(p.l, 'invoice.stamp');
  return <span class={`stamp cl-stamp${p.animate ? ' stamp-land' : ''}`} role="img" aria-label={word} data-testid="client-stamp">{word}</span>;
}

/** « Appelez-nous au 438 901-6606. » with a call button, or how to reach the garage when its number is unknown */
export function CallUs(p: { garage: Garage | null; l: CLang; label?: string; primary?: boolean }) {
  const tel = telHref(p.garage?.phone);
  if (!tel) return <p class="cl-muted">{ct(p.l, 'callUsNoPhone')}</p>;
  return (
    <div class="cl-stack" style={{ width: '100%' }}>
      <p class="cl-muted" style={{ margin: 0 }}>{ct(p.l, 'callUs', { phone: phoneText(p.garage?.phone) })}</p>
      <Button variant={p.primary === false ? 'secondary' : 'primary'} block href={tel} icon={<Phone />} data-testid="client-call">{p.label || ct(p.l, 'call')}</Button>
    </div>
  );
}

/** a few amounts one under the other (subtotal, taxes…) */
export function Sums(p: { rows: ([string, number, boolean?] | false | null | undefined)[]; l: CLang; class?: string }) {
  return (
    <div class={`cl-sums ${p.class || ''}`}>
      {p.rows.filter(Boolean).map((r) => {
        const [label, cents, strong] = r as [string, number, boolean?];
        const amount = cents < 0 ? `−${cad(-cents, p.l)}` : cad(cents, p.l);
        return [<span key={`${label}-l`} class={strong ? 'cl-strong' : ''}>{label}</span>, <span key={`${label}-v`} class={strong ? 'cl-strong' : ''}>{amount}</span>];
      })}
    </div>
  );
}

export function Skeleton(p: { l: CLang }) {
  return (
    <div class="cl-skel" aria-busy="true">
      <span class="sr-only" role="status">{ct(p.l, 'loading')}</span>
      <div class="skel" style={{ height: '28px', width: '45%' }} />
      <div class="skel" style={{ height: '40px', width: '80%' }} />
      <div class="skel" style={{ height: '180px' }} />
      <div class="skel" style={{ height: '140px' }} />
    </div>
  );
}

/** the garage's address and numbers, only on paper (an invoice printed from the page) */
export function PrintIdentity(p: { garage: Garage | null; l: CLang }) {
  const g = p.garage;
  if (!g) return null;
  return (
    <div class="cl-printonly cl-small">
      {g.address && <div><MapPin size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> {g.address}</div>}
      {g.phone && <div><Phone size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> {phoneText(g.phone)}</div>}
      {g.email && <div><Mail size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> {g.email}</div>}
    </div>
  );
}
