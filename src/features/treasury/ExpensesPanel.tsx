/* « Dépenses de la période »: the phone's copy (it works with no signal), newest first, with a search and a category
   filter; a tap opens the expense. */
import { memo } from 'preact/compat';
import { useMemo, useState } from 'preact/hooks';
import { Paperclip } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { money } from '../../lib/money';
import { parseDay } from '../../lib/dates';
import type { Expense } from '../../data/types';
import { Panel, Rows, RowItem, Button, Empty, SearchInput, Select } from '../../ui';
import { categories, expenseMatches, filterCategories } from './select';
import { receiptQueue } from './receipts';

const dayFmt = new Map<string, Intl.DateTimeFormat>();
function DateStub(p: { day: string; l: string }) {
  let f = dayFmt.get(p.l);
  if (!f) { f = new Intl.DateTimeFormat(p.l === 'en' ? 'en-CA' : 'fr-CA', { month: 'short' }); dayFmt.set(p.l, f); }
  const d = parseDay(p.day);
  return <span class="tre-date" aria-hidden="true"><b>{d.getDate()}</b><span>{f.format(d)}</span></span>;
}

/** one row; redrawn only when its expense changes (a year of expenses stays quick to type a search in) */
const ExpenseRow = memo(function ExpenseRow(p: { e: Expense; l: string; onOpen: (e: Expense) => void }) {
  const { e, l } = p;
  return (
    <RowItem onClick={() => p.onOpen(e)} data-testid="expense-row"
      start={<DateStub day={e.day} l={l} />}
      title={e.vendor || <span class="muted">{t('treasury.list.noVendor')}</span>}
      sub={e.category}
      end={<>
        <span class="money">{money(e.total_cents, l)}</span>
        {/* a photo still waiting on the phone counts: it is the expense's receipt, on its way */}
        {e.receipt_id || receiptQueue.waitingFor(e.id) ? <span class="tre-clip" role="img" aria-label={t('treasury.list.receipt')} title={t('treasury.list.receipt')}><Paperclip size={16} /></span> : <span class="tre-clip" aria-hidden="true" />}
      </>} chevron />
  );
});

/** `rows`: the period's expenses, newest first */
export function ExpensesPanel(p: { rows: Expense[]; l: string; onOpen: (e: Expense) => void }) {
  const { l } = p;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const cats = useMemo(() => filterCategories(categories.value, p.rows), [categories.value, p.rows]);
  const rows = useMemo(() => p.rows.filter((e) => (!cat || e.category === cat) && expenseMatches(e, q)), [p.rows, cat, q]);
  const sum = rows.reduce((n, e) => n + e.total_cents, 0);
  const filtered = !!q.trim() || !!cat;
  return (
    <Panel flush title={t('treasury.list.title')} sub={t('treasury.list.summary', { n: rows.length, amount: money(sum, l) })} class="tre-o2" data-testid="treasury-expenses">
      {p.rows.length > 0 && (
        <div class="tre-filters">
          <SearchInput value={q} onValue={setQ} placeholder={t('treasury.list.search')} />
          <Select value={cat} aria-label={t('treasury.list.category')} onValue={setCat}
            options={[{ value: '', label: t('treasury.list.allCategories') }, ...cats.map((c) => ({ value: c, label: c }))]} />
        </div>
      )}
      {rows.length ? (
        <Rows data-testid="expense-rows">
          {rows.map((e) => <ExpenseRow key={e.id} e={e} l={l} onOpen={p.onOpen} />)}
        </Rows>
      ) : filtered ? (
        <Empty title={t('treasury.list.noMatch')} text={t('treasury.list.noMatchText')} action={<Button onClick={() => { setQ(''); setCat(''); }}>{t('treasury.list.clear')}</Button>} />
      ) : (
        <Empty title={t('treasury.list.empty')} text={t('treasury.list.emptyText')} />
      )}
    </Panel>
  );
}
