/* « Coffre » (#/coffre, the owner and the « Trésorerie » right): the jobs of family and friends, apart from the
   revenue and the taxes. For a period: each entry (day, who, which jobs, what the work was worth, what was given),
   the totals, and the report the accountant exports apart (Excel, CSV). The owner can take an entry back out. */
import { useEffect, useState } from 'preact/hooks';
import { FileSpreadsheet, FileText, Undo2 } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { t, lang } from '../../lib/i18n';
import { may } from '../../app/routes';
import { money } from '../../lib/money';
import { today, longDay } from '../../lib/dates';
import { rpcNow, coffreRemove, errorMessage } from '../../data/api';
import { isOwner } from '../../data/auth';
import { garageName } from '../../data/select';
import { Page, Panel, Rows, RowItem, Button, Chips, Field, DateInput, Empty, Banner, Skeleton, run } from '../../ui';
import { PERIODS, periodRange, rangeLabel, type PeriodKey } from '../treasury/period';
import { XLSX_MIME } from '../treasury/xlsx';
import { normalizeCoffre, coffreWorkbook, coffreCsv, type CoffreReport, type CoffreLabels } from './logic';
import './coffre.css';

export default function CoffreScreen(_p: ScreenProps) {
  const l = lang.value;
  const [key, setKey] = useState<PeriodKey>('month');
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const range = periodRange(key, today(), custom);
  const [data, setData] = useState<CoffreReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null); setError(null);
    rpcNow<unknown>('coffre_report', { p_from: range.from, p_to: range.to })
      .then((r) => { if (alive) setData(normalizeCoffre(r, range.from, range.to)); }, (e) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [range.from, range.to, n]);

  const L = labels();
  const file = `${t('coffre.export.file')}-${range.from}-${range.to}`;
  const remove = async (id: string) => { const ok = await run(() => coffreRemove(id), { ok: t('coffre.removed') }); if (ok) setN((x) => x + 1); };
  return (
    <Page title={t('coffre.title')} sub={rangeLabel(range, l)} help={t('coffre.help')} back="/treasury" wide data-testid="coffre-screen">
      <Chips label={t('treasury.period.label')} value={[key]} data-testid="coffre-period"
        options={PERIODS.map((k) => ({ value: k, label: t(`treasury.period.${k}`) }))} onValue={(v) => v[0] && setKey(v[0] as PeriodKey)} />
      {key === 'custom' && (
        <div class="row-wrap">
          <Field label={t('treasury.period.from')}><DateInput value={range.from} onValue={(v) => setCustom((c) => ({ ...c, from: v }))} /></Field>
          <Field label={t('treasury.period.to')}><DateInput value={range.to} onValue={(v) => setCustom((c) => ({ ...c, to: v }))} /></Field>
        </div>
      )}
      <Banner kind="info">{t('coffre.apart')}</Banner>
      {error && <Banner kind="bad">{error}</Banner>}
      {!data && !error && <Panel><Skeleton h={48} lines={3} /></Panel>}
      {data && (
        <>
          <Panel title={t('coffre.totals')} data-testid="coffre-totals">
            <div class="coffre-totals">
              <div class="coffre-total"><span class="muted small">{t('coffre.count')}</span><b class="num">{data.count}</b></div>
              <div class="coffre-total"><span class="muted small">{t('coffre.given')}</span><b class="num" data-testid="coffre-amount">{money(data.amount_cents, l)}</b></div>
              <div class="coffre-total"><span class="muted small">{t('coffre.spent')}</span><b class="num" data-testid="coffre-spent">{money(data.spent_cents, l)}</b></div>
              <div class="coffre-total"><span class="muted small">{t('coffre.balance')}</span><b class="num" data-testid="coffre-balance">{money(data.balance_cents, l)}</b></div>
              <div class="coffre-total"><span class="muted small">{t('coffre.stock')}</span><b class="num" data-testid="coffre-stock">{money(data.stock_cents, l)}</b>
                {may.inventory() && <a class="small" href="#/inventory?pool=coffre" data-testid="coffre-stock-link">{t('coffre.stockLink')}</a>}</div>
              <div class="coffre-total"><span class="muted small">{t('coffre.worth')}</span><b class="num">{money(data.value_cents, l)}</b></div>
            </div>
            <div class="coffre-actions" style={{ marginTop: 'var(--sp-3)' }}>
              <Button icon={<FileSpreadsheet />} onClick={() => save(coffreWorkbook(data, L), `${file}.xlsx`, XLSX_MIME)} data-testid="coffre-xlsx">{t('coffre.export.xlsx')}</Button>
              <Button variant="ghost" icon={<FileText />} onClick={() => save(coffreCsv(data, L, l), `${file}.csv`, 'text/csv;charset=utf-8')} data-testid="coffre-csv">{t('coffre.export.csv')}</Button>
            </div>
          </Panel>
          {!data.rows.length ? <Panel><Empty title={t('coffre.empty')} text={t('coffre.emptyText')} /></Panel> : (
            <Panel title={t('coffre.list')} flush>
              <Rows>
                {data.rows.slice().reverse().map((r) => (
                  <RowItem key={r.id} href={r.job_ids[0] ? `#/job/${r.job_ids[0]}` : undefined} data-testid={`coffre-row-${r.id}`}
                    title={<>{r.kind === 'purchase' ? t('coffre.purchase', { what: r.work }) : r.customer} <span class="muted small">{longDay(r.day, l)}</span></>}
                    sub={(r.kind === 'purchase' ? [r.note] : [t('coffre.jobs', { n: r.job_numbers.map((x) => `#${x}`).join(', ') }), r.work, r.note]).filter(Boolean).join('. ')}
                    end={<span class="stack" style={{ alignItems: 'flex-end', gap: 0 }}>
                      <b class={`num${r.kind === 'purchase' ? ' coffre-out' : ''}`}>{r.kind === 'purchase' ? `−${money(r.amount_cents, l)}` : money(r.amount_cents, l)}</b>
                      {r.kind === 'received' && <span class="muted small">{t('coffre.worthShort', { value: money(r.value_cents, l) })}</span>}
                      {isOwner() && <Button size="sm" variant="ghost" icon={<Undo2 />} confirm={t('coffre.removeConfirm')} onClick={() => remove(r.id)}>{t('coffre.remove')}</Button>}
                    </span>} />
                ))}
              </Rows>
            </Panel>
          )}
        </>
      )}
    </Page>
  );
  function labels(): CoffreLabels {
    const c = (k: string) => t(`coffre.export.${k}`);
    return { sheet: c('sheet'), title: `${c('title')}, ${garageName.value}`, period: c('period'), day: c('day'), customer: c('customer'), jobs: c('jobs'), work: c('work'),
      value: c('value'), amount: c('amount'), note: c('note'), by: c('by'), total: c('total') };
  }
}

function save(data: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
