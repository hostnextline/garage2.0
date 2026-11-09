/* Clients: search as you type (name, company, phone digits, street, postal code, plate, VIN, car), most recent
   activity first or A to Z. Each line: the name, the phone, the car, the next appointment or the last visit, and
   what to know in words (client absent, carte au dossier, English, doit…). Entrée opens the first customer found.
   A mechanic only receives his own customers (the database decides). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { UserPlus, Phone, Car, Users, SearchX } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { may } from '../../app/routes';
import { navigate, setQuery, route } from '../../app/router';
import { touch } from '../../app/media';
import { t } from '../../lib/i18n';
import { customersList, customerName } from '../../data/select';
import { can } from '../../data/auth';
import { net } from '../../data/sync';
import type { Customer } from '../../data/types';
import { Page, Panel, Rows, RowItem, Button, SearchInput, Seg, Empty, Skeleton, Avatar, Pill } from '../../ui';
import { openMenu, openMenuAt, pressProps } from '../agenda/ContextMenu';
import { customerActions } from './shortcuts';
import { factsOf, searchIndex, recentFirst, nameOrder, type CustomerFacts } from './facts';
import { useSettled, useFocusOnMount } from './hooks';
import { searchList, draftFromQuery } from './search';
import { Flags, Bit, carName, whenText, dayWord, nextLine, lastLine } from './bits';
import './customers.css';

const PAGE = 60;

export default function CustomersScreen({ query }: ScreenProps) {
  const [q, setQ] = useState(() => query.get('q') || '');
  const sort: 'recent' | 'az' = query.get('sort') === 'az' ? 'az' : 'recent';
  const [limit, setLimit] = useState(PAGE);
  const all = customersList.value;
  const index = searchIndex.value;
  const ordered = sort === 'az' ? nameOrder.value : recentFirst.value;
  // a very long list is searched a moment after the last key, so typing stays smooth
  const typed = useSettled(q.trim(), all.length > 800 ? 120 : 0);
  const list = useMemo(() => searchList(ordered, typed, (c) => index.get(c.id), undefined, sort === 'recent'), [ordered, index, typed, sort]);
  useFocusOnMount(!touch.value, () => document.querySelector<HTMLInputElement>('[data-tour="customers-search"] input'));
  useEffect(() => setLimit(PAGE), [typed, sort]);
  // the search stays in the address, so « Retour » from a file comes back to it
  useEffect(() => {
    const tm = setTimeout(() => { if ((route.value.query.get('q') || '') !== typed) setQuery({ q: typed || null }); }, 600);
    return () => clearTimeout(tm);
  }, [typed]);
  // more lines as the list scrolls
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length > limit]);

  const ready = net.value.ready;
  const shown = list.slice(0, limit);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // the very long list searches a moment after the keys: Entrée uses what is typed now
    const now = q.trim();
    const first = now === typed ? list[0] : searchList(ordered, now, (c) => index.get(c.id), undefined, sort === 'recent')[0];
    if (now && first) { e.preventDefault(); navigate(`/customer/${first.id}`); }
  };
  const create = (txt: string) => {
    const d = draftFromQuery(txt);
    const name = [d.first_name, d.last_name].filter(Boolean).join(' ');
    return `#/customer/new${name || d.phone ? '?' + new URLSearchParams({ ...(name ? { name } : {}), ...(d.phone ? { phone: d.phone } : {}) }).toString() : ''}`;
  };

  let body;
  if (!all.length && !ready) {
    body = <Panel><div aria-busy="true" aria-label={t('customers.loading')}><Skeleton h={20} lines={6} /></div></Panel>;
  } else if (!all.length) {
    const mine = !can('clients');
    body = (
      <Panel>
        <Empty icon={<Users />} title={mine ? t('customers.empty.mineTitle') : t('customers.empty.title')} text={mine ? t('customers.empty.mineText') : t('customers.empty.text')}
          action={may.newCustomer() && <Button variant="primary" icon={<UserPlus size={18} />} href="#/customer/new">{t('customers.newCustomer')}</Button>} />
      </Panel>
    );
  } else if (typed && !list.length) {
    body = (
      <Panel>
        <Empty icon={<SearchX />} title={t('customers.noMatch.title', { q: typed })} text={t('customers.noMatch.text')}
          action={may.newCustomer() && <Button variant="primary" icon={<UserPlus size={18} />} href={create(typed)} data-testid="create-from-search">{t('customers.noMatch.create', { q: typed })}</Button>} />
      </Panel>
    );
  } else {
    body = (
      <Panel flush class="customers-list" data-testid="customers-list">
        <div class="customers-head" aria-hidden="true">
          <span /><span>{t('customers.columns.name')}</span><span>{t('customers.columns.phone')}</span><span>{t('customers.columns.car')}</span><span>{t('customers.columns.when')}</span>
        </div>
        <Rows>{shown.map((c) => <CustomerRow key={c.id} c={c} f={factsOf(c.id)} />)}</Rows>
        {list.length > limit && (
          <div ref={sentinel} class="customers-more">
            <Button onClick={() => setLimit((l) => l + PAGE)}>{t('customers.more', { n: list.length - limit })}</Button>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Page class="customers-page" title={t('customers.title')} data-testid="customers-screen"
      sub={all.length ? (typed ? t('customers.found', { n: list.length }) : t('customers.count', { n: all.length })) : undefined}
      actions={may.newCustomer() && all.length > 0 && <Button variant="primary" icon={<UserPlus size={18} />} href="#/customer/new" data-testid="new-customer">{t('customers.newCustomer')}</Button>}>
      {all.length > 0 && <div class="customers-tools">
        <div class="grow" onKeyDown={onKey}>
          <SearchInput value={q} onValue={setQ} placeholder={t('customers.searchPlaceholder')} data-tour="customers-search" />
        </div>
        <Seg value={sort} onValue={(v) => setQuery({ sort: v === 'az' ? 'az' : null })} label={t('customers.sort.label')} class="customers-seg" data-testid="customers-sort"
          options={[{ value: 'recent', label: t('customers.sort.recent') }, { value: 'az', label: t('customers.sort.az') }]} />
      </div>}
      {body}
    </Page>
  );
}

/** right-click (computer) or long press (phone) on a customer: the shortcut menu */
function rowMenu(c: Customer) {
  const actions = () => customerActions(c, { edit: true });
  return {
    onContextMenu: (e: MouseEvent) => openMenu(e, actions(), customerName(c)),
    ...pressProps((x, y) => { const a = actions(); if (!a.length) return false; openMenuAt(x, y, a, customerName(c)); })
  };
}

function CustomerRow(p: { c: Customer; f: CustomerFacts }) {
  const { c, f } = p;
  const name = customerName(c);
  const company = c.company && (c.first_name || c.last_name) ? c.company : null;
  return (
    <RowItem href={`#/customer/${c.id}`} class="customers-row" data-testid="customer-row" chevron events={rowMenu(c) as never}
      start={<Avatar name={name} />}
      title={<>{name}{company && <span class="customers-row-company">{company}</span>}</>}
      sub={<>
        <span class="customers-col">{c.phone ? <Bit icon={<Phone size={14} aria-hidden="true" />}>{c.phone}</Bit> : <span class="faint">{t('customers.noPhone')}</span>}</span>
        <span class="customers-col">{f.cars.length > 0 && <Bit icon={<Car size={14} aria-hidden="true" />}>{carName(f.cars[0])}{f.cars.length > 1 ? ` ${t('customers.carMore', { n: f.cars.length - 1 })}` : ''}</Bit>}</span>
        <span class="customers-col-flags">
          {f.next ? <span class="customers-when-inline"><Pill tone="booked">{nextLine(f.next.day, f.next.block)}</Pill></span>
            : f.last ? <span class="customers-when-inline faint">{lastLine(f.last.day)}</span> : null}
          <Flags c={c} owed={f.owed} />
        </span>
      </>}
      end={<When f={f} />} />
  );
}

export function When(p: { f: CustomerFacts }) {
  const { next, last } = p.f;
  if (next) return <span class="customers-when is-next"><span>{t('customers.when.next')}</span><b>{whenText(next.day, next.block)}</b></span>;
  if (last) return <span class="customers-when"><span>{t('customers.when.last')}</span><b>{dayWord(last.day)}</b></span>;
  return <span class="customers-when" />;
}
