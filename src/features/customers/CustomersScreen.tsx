/* Clients: search as you type (name, company, phone digits, street, postal code, plate, VIN, car), most recent
   activity first or A to Z. Each line: CustomerRow.tsx. Entrée opens the first customer found. 60 lines, more as the
   list scrolls; « Retour » from a file comes back to the same search and the same lines. A mechanic only receives his
   own customers (the database decides). */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { UserPlus, Users, SearchX } from 'lucide-preact';
import { navigate, setQuery, type ScreenProps } from '../../platform/router';
import { touch } from '../../platform/media';
import { t } from '../../lib/i18n';
import { customersList } from '../../data/select';
import { can } from '../../data/auth';
import { net } from '../../data/sync';
import { Page, Panel, Rows, Button, SearchInput, Seg, Empty, Skeleton } from '../../ui';
import { factsOf, searchIndex, recentFirst, nameOrder } from '../../shared/customers/facts';
import { useSettled, useFocusOnMount } from '../../ui/hooks';
import { searchList, draftFromQuery } from '../../shared/customers/search';
import { mayCreateCustomer } from '../../shared/customers/create';
import { usePaged } from '../../shared/customers/usePaged';
import { currentDay } from '../../domain/oil/clock';
import { CustomerRow } from './CustomerRow';
import { setQueryQuietly } from './quietQuery';
import '../../shared/places/customers.css';

export default function CustomersScreen({ query }: ScreenProps) {
  const [q, setQ] = useState(() => query.get('q') || '');
  const sort: 'recent' | 'az' = query.get('sort') === 'az' ? 'az' : 'recent';
  const all = customersList.value;
  const index = searchIndex.value;
  const ordered = sort === 'az' ? nameOrder.value : recentFirst.value;
  const day = currentDay.value;
  // a very long list is searched a moment after the last key, so typing stays smooth
  const typed = useSettled(q.trim(), all.length > 800 ? 120 : 0);
  const list = useMemo(() => searchList(ordered, typed, (c) => index.get(c.id), undefined, sort === 'recent'), [ordered, index, typed, sort]);
  const paged = usePaged(`customers|${sort}|${typed}`, list.length);
  useFocusOnMount(!touch.value, () => document.querySelector<HTMLInputElement>('[data-tour="customers-search"] input'));
  // the search stays in the address (without moving the page), so « Retour » from a file comes back to it; a tap that
  // leaves the list before it is written (Entrée, a line, a shortcut) writes it first
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const keep = () => { if (pending.current == null) return; const v = pending.current; pending.current = null; setQueryQuietly({ q: v || null }); };
    pending.current = typed;
    const tm = setTimeout(keep, 600);
    document.addEventListener('click', keep, true);
    return () => { clearTimeout(tm); document.removeEventListener('click', keep, true); pending.current = null; };
  }, [typed]);
  const flush = () => { if (pending.current != null) { const v = pending.current; pending.current = null; setQueryQuietly({ q: v || null }); } };

  const ready = net.value.ready;
  const mayCreate = mayCreateCustomer();
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // the very long list searches a moment after the keys: Entrée uses what is typed now
    const now = q.trim();
    const first = now === typed ? list[0] : searchList(ordered, now, (c) => index.get(c.id), undefined, sort === 'recent')[0];
    if (now && first) { e.preventDefault(); if (now === typed) flush(); else setQueryQuietly({ q: now }); navigate(`/customer/${first.id}`); }
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
          action={mayCreate && <Button variant="primary" icon={<UserPlus size={18} />} href="#/customer/new">{t('customers.newCustomer')}</Button>} />
      </Panel>
    );
  } else if (typed && !list.length) {
    body = (
      <Panel>
        <Empty icon={<SearchX />} title={t('customers.noMatch.title', { q: typed })} text={t('customers.noMatch.text')}
          action={mayCreate && <Button variant="primary" icon={<UserPlus size={18} />} href={create(typed)} data-testid="create-from-search">{t('customers.noMatch.create', { q: typed })}</Button>} />
      </Panel>
    );
  } else {
    body = (
      <Panel flush class="customers-list" data-testid="customers-list">
        <div class="customers-head" aria-hidden="true">
          <span /><span>{t('customers.columns.name')}</span><span>{t('customers.columns.phone')}</span><span>{t('customers.columns.car')}</span><span>{t('customers.columns.when')}</span>
        </div>
        <Rows>{list.slice(0, paged.limit).map((c) => <CustomerRow key={c.id} c={c} f={factsOf(c.id)} day={day} />)}</Rows>
        {paged.hasMore && (
          <div ref={paged.sentinel} class="customers-more">
            <Button onClick={paged.more}>{t('customers.more', { n: paged.left })}</Button>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <Page class="customers-page" title={t('customers.title')} data-testid="customers-screen"
      sub={all.length ? (typed ? t('customers.found', { n: list.length }) : t('customers.count', { n: all.length })) : undefined}
      actions={mayCreate && all.length > 0 && <Button variant="primary" icon={<UserPlus size={18} />} href="#/customer/new" data-testid="new-customer">{t('customers.newCustomer')}</Button>}>
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
