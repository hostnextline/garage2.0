/* « Coffre » (#/coffre, the owner and the « Trésorerie » right): the jobs of family and friends, apart from the
   revenue and the taxes. For a period: each entry (day, who, which jobs, what the work was worth, what was given),
   the totals, and the report the accountant exports apart (Excel, CSV). The owner can take money received back out.
   The report goes through the same hook as the treasury: the last answer is kept on the phone and shown with no
   signal, « Réessayer » on a failure, a new try when the signal comes back; the period is in the address
   (?p=…&from=…&to=…, like #/treasury), so it survives a reload and « Retour ». */
import { FileSpreadsheet, FileText, Undo2 } from 'lucide-preact';
import { setQuery, type ScreenProps } from '../../platform/router';
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { today, longDay, stamp } from '../../lib/dates';
import { may } from '../../domain/rights';
import { rpcNow, coffreRemove } from '../../data/api';
import { isOwner, me } from '../../data/auth';
import { garageName } from '../../data/select';
import { Page, Panel, Rows, RowItem, Button, Chips, Field, DateInput, Empty, Banner, Skeleton, run } from '../../ui';
import { useReport } from '../../shared/charts/useReport';
import { PERIODS, isPeriod, periodRange, rangeLabel, type PeriodKey } from '../../domain/money/period';
import { XLSX_MIME } from '../../shared/export/xlsx';
import { CSV_MIME, saveFile } from '../../shared/export/download';
import { normalizeCoffre, coffreWorkbook, coffreCsv, mayRemoveEntry, type CoffreEntry, type CoffreLabels, type CoffreReport } from './logic';
import '../../shared/invoices/coffre.css';

function labels(): CoffreLabels {
  const c = (k: string) => t(`coffre.export.${k}`);
  return { sheet: c('sheet'), title: `${c('title')}, ${garageName.value}`, period: c('period'), day: c('day'), customer: c('customer'), jobs: c('jobs'), work: c('work'),
    value: c('value'), amount: c('amount'), note: c('note'), by: c('by'), total: c('total') };
}

export default function CoffreScreen({ query }: ScreenProps) {
  const l = lang.value;
  const p = query.get('p');
  const key: PeriodKey = isPeriod(p) ? p : 'month';
  const range = periodRange(key, today(), { from: query.get('from') || undefined, to: query.get('to') || undefined });
  const r = useReport<CoffreReport>(`his.report.${me.value?.id || 'x'}.coffre.${range.from}.${range.to}`,
    async () => normalizeCoffre(await rpcNow<unknown>('coffre_report', { p_from: range.from, p_to: range.to }), range.from, range.to));
  const data = r.data;
  const choose = (k: PeriodKey) => setQuery({ p: k === 'month' ? null : k, from: k === 'custom' ? range.from : null, to: k === 'custom' ? range.to : null });
  const file = `${t('coffre.export.file')}-${range.from}-${range.to}`;
  const remove = async (id: string) => { const ok = await run(() => coffreRemove(id), { ok: t('coffre.removed') }); if (ok) r.reload(); };
  const retry = <Button size="sm" onClick={r.reload}>{t('treasury.retry')}</Button>;
  return (
    <Page title={t('coffre.title')} sub={rangeLabel(range, l)} help={t('coffre.help')} back="/treasury" wide data-testid="coffre-screen">
      <Chips label={t('treasury.period.label')} value={[key]} data-testid="coffre-period"
        options={PERIODS.map((k) => ({ value: k, label: t(`treasury.period.${k}`) }))} onValue={(v) => { if (v[0]) choose(v[0]); }} />
      {key === 'custom' && (
        <div class="row-wrap">
          <Field label={t('treasury.period.from')}><DateInput value={range.from} onValue={(v) => v && setQuery({ from: v })} /></Field>
          <Field label={t('treasury.period.to')}><DateInput value={range.to} onValue={(v) => v && setQuery({ to: v })} /></Field>
        </div>
      )}
      <Banner kind="info">{t('coffre.apart')}</Banner>
      {r.offline && <Banner kind="warn" title={data ? t('coffre.offlineCached', { when: stamp(r.at, l) }) : t('coffre.offline')} action={retry} />}
      {r.error && <Banner kind="bad" title={t('coffre.error')} action={retry}><span>{r.error}</span></Banner>}
      {!data && r.loading && <Panel><Skeleton h={48} lines={3} /></Panel>}
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
              <Button icon={<FileSpreadsheet />} onClick={() => saveFile(coffreWorkbook(data, labels()), `${file}.xlsx`, XLSX_MIME)} data-testid="coffre-xlsx">{t('coffre.export.xlsx')}</Button>
              <Button variant="ghost" icon={<FileText />} onClick={() => saveFile(coffreCsv(data, labels(), l), `${file}.csv`, CSV_MIME)} data-testid="coffre-csv">{t('coffre.export.csv')}</Button>
            </div>
          </Panel>
          {!data.rows.length ? <Panel><Empty title={t('coffre.empty')} text={t('coffre.emptyText')} /></Panel> : (
            <Panel title={t('coffre.list')} flush>
              <Rows>
                {data.rows.slice().reverse().map((e) => <EntryRow key={e.id} e={e} l={l} owner={isOwner()} onRemove={remove} />)}
              </Rows>
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}

function EntryRow(p: { e: CoffreEntry; l: string; owner: boolean; onRemove: (id: string) => Promise<void> }) {
  const { e, l } = p;
  const purchase = e.kind === 'purchase';
  return (
    <RowItem href={e.job_ids[0] ? `#/job/${e.job_ids[0]}` : undefined} data-testid={`coffre-row-${e.id}`}
      title={<>{purchase ? t('coffre.purchase', { what: e.work }) : e.customer} <span class="muted small">{longDay(e.day, l)}</span></>}
      sub={(purchase ? [e.note] : [t('coffre.jobs', { n: e.job_numbers.map((x) => `#${x}`).join(', ') }), e.work, e.note]).filter(Boolean).join('. ')}
      end={<span class="stack" style={{ alignItems: 'flex-end', gap: 0 }}>
        <b class={`num${purchase ? ' coffre-out' : ''}`}>{purchase ? `−${money(e.amount_cents, l)}` : money(e.amount_cents, l)}</b>
        {!purchase && <span class="muted small">{t('coffre.worthShort', { value: money(e.value_cents, l) })}</span>}
        {/* the button sits in the row's link to the job: its second tap must not also open the job */}
        {mayRemoveEntry(e, p.owner) && (
          <span onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); }}>
            <Button size="sm" variant="ghost" icon={<Undo2 />} confirm={t('coffre.removeConfirm')} onClick={() => p.onRemove(e.id)}>{t('coffre.remove')}</Button>
          </span>
        )}
      </span>} />
  );
}
