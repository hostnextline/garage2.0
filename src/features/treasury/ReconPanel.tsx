/* « Rapprochement d'hier » (owner and the « Trésorerie » right): what the night's check of the books found.
   « Tout balance » with the day's sheet, or each difference in plain words (a tap opens the invoice, job or expense
   it is about), « Vu » for whoever may note it, and « Vérifier maintenant ».
   The panel never breaks the screen: a server without the reconciliation yet keeps it hidden, and with no signal it
   shows the last answer kept on the phone, or nothing. */
import { t, lang } from '../../lib/i18n';
import { money } from '../../lib/money';
import { longDay, stamp } from '../../lib/dates';
import { Refused } from '../../lib/errors';
import { rpcNow } from '../../data/api';
import { me, preview } from '../../data/auth';
import { getRow } from '../../data/store';
import type { Payment } from '../../data/types';
import { Panel, Rows, RowItem, Button, Banner, Pill, attempt } from '../../ui';
import { useReport } from '../../shared/charts/useReport';
import { normalizeRecon, isMissingFunction, shownFindings, allBalanced, findingText, findingTarget, type ReconAnswer, type ReconFinding, type ReconSheet } from './recon';
import { methodLabel } from './select';

async function loadRecon(): Promise<ReconAnswer> {
  try {
    return normalizeRecon(await rpcNow('recon_summary', { p_days: 14 }));
  } catch (e) {
    // an app newer than its database: nothing to show, nothing to say
    if (isMissingFunction(e)) return { available: false };
    throw e;
  }
}
/** a change asked to the server: refused while « Voir l'app comme… », like every other change */
function change(name: string, args: Record<string, unknown>, ms?: number) {
  if (preview.value) throw new Refused('preview', t('errors.preview'));
  return rpcNow(name, args, ms);
}
const paymentOf = (id: string) => getRow<Payment>('payments', id);

export function ReconPanel(p: { onOpenExpense: (id: string) => void }) {
  const l = lang.value;
  const r = useReport<ReconAnswer>(`his.report.${me.value?.id || 'x'}.recon`, loadRecon);
  const answer = r.data;
  if (!answer || !answer.available) return null;
  const s = answer.summary;
  const run = s.last_run;
  const findings = shownFindings(s);
  const balanced = allBalanced(s);
  const open = findings.filter((f) => f.state === 'open').length;
  const ack = (f: ReconFinding) => attempt(() => change('recon_ack', { p_finding: f.id, p_note: null }), { ok: t('treasury.recon.seenDone') }).then((ok) => { if (ok) r.reload(); });
  // the whole check can take a while on the server
  const checkNow = () => attempt(() => change('recon_now', {}, 60000), { ok: t('treasury.recon.checkDone') }).then((ok) => { if (ok) r.reload(); });
  return (
    <Panel title={t('treasury.recon.title')} help={t('treasury.recon.help')} class="tre-o1" data-testid="treasury-recon"
      sub={run ? (run.finished_at ? t('treasury.recon.checked', { when: stamp(run.finished_at, l) }) : t('treasury.recon.day', { day: longDay(run.day, l) })) : undefined}>
      <div class="stack">
        {r.offline && <p class="muted small" style={{ margin: 0 }}>{t('treasury.recon.offline', { when: stamp(r.at, l) })}</p>}
        {r.error && <p class="small tre-warn" style={{ margin: 0 }} role="status">{t('treasury.recon.error')}</p>}
        {!run ? <p class="muted" style={{ margin: 0 }}>{t('treasury.recon.never')}</p>
          : balanced ? (
            <>
              <Banner kind="ok" title={t('treasury.recon.allGood')} data-testid="recon-ok"><span>{t('treasury.recon.allGoodText')}</span></Banner>
              {run.sheet && <SheetLines s={run.sheet} l={l} />}
            </>
          ) : open > 0 && <p class="small" style={{ margin: 0 }}><b>{t('treasury.recon.toLook', { n: open })}</b></p>}
        {findings.length > 0 && !balanced && (
          <Rows data-testid="recon-findings">
            {findings.map((f) => <FindingRow key={f.id} f={f} l={l} canAck={s.can_ack} onAck={ack} onOpenExpense={p.onOpenExpense} />)}
          </Rows>
        )}
        <div class="row-wrap">
          <Button size="sm" variant="secondary" onClick={checkNow} data-testid="recon-check">{t('treasury.recon.check')}</Button>
        </div>
      </div>
    </Panel>
  );
}

function FindingRow(p: { f: ReconFinding; l: string; canAck: boolean; onAck: (f: ReconFinding) => Promise<void>; onOpenExpense: (id: string) => void }) {
  const { f, l } = p;
  const target = findingTarget(f, paymentOf);
  const tone = f.state === 'acked' ? 'muted' : f.severity === 'bad' ? 'bad' : f.severity === 'warn' ? 'warn' : 'muted';
  const since = f.first_day ? t('treasury.recon.since', { day: longDay(f.first_day, l) }) : null;
  // an expense has no screen of its own: it opens in its sheet, here
  const href = target && 'href' in target ? target.href : target ? '#/treasury' : undefined;
  const events = target && 'expense' in target ? { onClick: (e: MouseEvent) => { e.preventDefault(); p.onOpenExpense(target.expense); } } : undefined;
  return (
    <RowItem href={href} events={events} chevron={!!target} data-testid="recon-finding"
      title={findingText(f, l)}
      sub={[f.note, since].filter(Boolean).join('. ') || undefined}
      end={<span class="stack" style={{ alignItems: 'flex-end', gap: '4px' }}>
        <Pill tone={tone}>{f.state === 'acked' ? t('treasury.recon.seen') : t(`treasury.recon.severity.${f.severity}`)}</Pill>
        {/* the button sits in the row's link: its tap must not also follow the link */}
        {p.canAck && f.state === 'open' && (
          <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            <Button size="sm" variant="ghost" onClick={() => p.onAck(f)} data-testid="recon-ack">{t('treasury.recon.seen')}</Button>
          </span>
        )}
      </span>} />
  );
}

/** the day's sheet: what was invoiced, received (by method and by whom), refunded, spent, the Coffre, still to receive */
function SheetLines(p: { s: ReconSheet; l: string }) {
  const { s, l } = p;
  const lines: [string, number][] = [
    [t('treasury.recon.sheet.invoiced'), s.invoiced_cents],
    ...s.received.map((x): [string, number] => [t('treasury.recon.sheet.received', { what: x.by_name ? t('treasury.recon.sheet.by', { method: methodLabel(x.method), name: x.by_name }) : methodLabel(x.method) }), x.cents]),
    ...(s.refunded_cents ? [[t('treasury.recon.sheet.refunded'), s.refunded_cents] as [string, number]] : []),
    ...s.expenses.map((x): [string, number] => [t('treasury.recon.sheet.expenses', { what: x.category || '—' }), x.cents]),
    ...(s.coffre_in_cents ? [[t('treasury.recon.sheet.coffreIn'), s.coffre_in_cents] as [string, number]] : []),
    ...(s.coffre_out_cents ? [[t('treasury.recon.sheet.coffreOut'), s.coffre_out_cents] as [string, number]] : []),
    [t('treasury.recon.sheet.toReceive'), s.to_receive_cents]
  ];
  return (
    <dl class="tre-lines" data-testid="recon-sheet">
      {lines.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd class="money">{money(v, l)}</dd></div>)}
    </dl>
  );
}
