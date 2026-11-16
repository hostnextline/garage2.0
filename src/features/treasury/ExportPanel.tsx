/* « Pour le comptable »: the Excel workbook (Revenus, Dépenses, Taxes), the CSV journal and, on a phone, « Envoyer le
   fichier Excel ». Made on the phone from its copy, so a warning says when that copy does not hold what the server's
   report counted, and when there is no signal to check it. */
import { useMemo } from 'preact/hooks';
import { FileSpreadsheet, FileText, Share2 } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { settings, garageName } from '../../data/select';
import { Panel, Button, Banner, toast } from '../../ui';
import { buildWorkbook, buildCsv, type ExportInput, type ExportLabels, type ExpenseLine, type RevenueLine } from '../../shared/export/exports';
import { XLSX_MIME } from '../../shared/export/xlsx';
import { CSV_MIME, canShareFiles, saveFile, shareOrSave } from '../../shared/export/download';
import type { DayRange } from '../../domain/money/period';
import type { TreasuryReport } from './report';
import { exportMismatch } from './exportRows';

function exportLabels(): ExportLabels {
  const c = (k: string) => t(`treasury.export.cols.${k}`);
  const x = (k: string) => t(`treasury.export.taxSheet.${k}`);
  return {
    sheets: { revenue: t('treasury.export.sheets.revenue'), expenses: t('treasury.export.sheets.expenses'), taxes: t('treasury.export.sheets.taxes') },
    revenue: { day: c('day'), number: c('number'), customer: c('customer'), subtotal: c('subtotal'), tps: c('tps'), tvq: c('tvq'), total: c('total'), paid: c('paid'), status: c('status') },
    expenses: { day: c('day'), vendor: c('vendor'), category: c('category'), description: c('description'), subtotal: c('subtotal'), tps: c('tps'), tvq: c('tvq'), total: c('total'), method: c('method'), truck: c('truck'), receipt: c('receipt') },
    taxes: {
      title: x('title'), period: x('period'), from: t('treasury.period.from'), to: t('treasury.period.to'), company: x('company'), tpsNo: x('tpsNo'), tvqNo: x('tvqNo'),
      tax: t('treasury.taxes.tax'), collected: t('treasury.taxes.collected'), paid: t('treasury.taxes.paid'), remit: t('treasury.taxes.remit'),
      tps: t('treasury.taxes.tps'), tvq: t('treasury.taxes.tvq'), both: t('treasury.taxes.both'), revenue: x('revenue'), expenses: x('expenses'), profit: x('profit'), note: x('note')
    },
    totalRow: t('treasury.export.totalRow'), yes: t('treasury.export.yes'), no: t('treasury.export.no'),
    csv: { day: c('day'), type: c('type'), number: c('number'), name: c('name'), category: c('category'), description: c('description'), subtotal: c('subtotal'), tps: c('tps'), tvq: c('tvq'), total: c('total'), method: c('method'), revenue: t('treasury.export.revenueType'), expense: t('treasury.export.expenseType') }
  };
}

export function ExportPanel(p: {
  range: DayRange; rev: RevenueLine[]; exp: ExpenseLine[]; seesInvoices: boolean; l: string;
  /** the report and whether it can be compared with the phone's lines right now (fresh, nothing waiting to be sent) */
  report: TreasuryReport | null; comparable: boolean; offline: boolean;
}) {
  const { range, l } = p;
  const mismatch = !!p.report && p.comparable && exportMismatch(p.report, p.rev, p.exp, p.seesInvoices);
  const share = useMemo(canShareFiles, []);
  const input = (): ExportInput => {
    const company = settings.value.company || {};
    return { from: range.from, to: range.to, revenue: p.rev, expenses: p.exp, expensesOnly: !p.seesInvoices, labels: exportLabels(),
      company: { name: company.legal_name || company.name || garageName.value, tps_no: company.tps_no, tvq_no: company.tvq_no } };
  };
  const base = t('treasury.export.file', { from: range.from, to: range.to });
  const done = (name: string) => toast(t('treasury.export.ready', { name }), { kind: 'ok' });
  const xlsx = () => { const name = `${base}.xlsx`; saveFile(buildWorkbook(input()), name, XLSX_MIME); done(name); };
  const csv = () => { const name = `${base}.csv`; saveFile(buildCsv(input(), l), name, CSV_MIME); done(name); };
  const send = () => shareOrSave(buildWorkbook(input()), `${base}.xlsx`);
  return (
    <Panel title={t('treasury.export.title')} sub={t('treasury.export.sub')} help={t('treasury.export.help')} class="tre-o6" data-testid="treasury-export">
      <div class="stack">
        {mismatch && <Banner kind="warn" data-testid="export-mismatch">{t('treasury.export.mismatch')}</Banner>}
        {p.offline && <Banner kind="warn">{t('treasury.export.offline')}</Banner>}
        {!p.seesInvoices && <Banner kind="info">{t('treasury.export.noInvoices')}</Banner>}
        <div class="tre-export-buttons">
          <Button icon={<FileSpreadsheet size={18} />} onClick={xlsx} data-testid="export-xlsx">{t('treasury.export.xlsx')}</Button>
          <Button icon={<FileText size={18} />} onClick={csv} data-testid="export-csv">{t('treasury.export.csv')}</Button>
          {share && <Button variant="ghost" icon={<Share2 size={18} />} onClick={send} data-testid="export-share">{t('treasury.export.share')}</Button>}
        </div>
      </div>
    </Panel>
  );
}
