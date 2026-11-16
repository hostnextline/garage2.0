/* The history of an item: the 60 latest moves, each with its reason, signed quantity, when, who, « En attente d'envoi »
   while the server has not confirmed it, its note, and a link to the job for parts a job used. */
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, RotateCcw } from 'lucide-preact';
import { t, lang } from '../../lib/i18n';
import { stamp } from '../../lib/dates';
import { movesOf, staffName, job } from '../../data/select';
import type { InventoryItem, InventoryMove } from '../../data/types';
import { useQty, signed } from './useQty';

const REASON_ICON = { restock: ArrowDownToLine, used: ArrowUpFromLine, adjust: ClipboardCheck, return: RotateCcw };
const SHOWN = 60;

/** the note worth showing: not when it only repeats the job's number (the link says it) */
function noteOf(m: InventoryMove, jobText: string): string | null {
  const n = m.note?.trim();
  if (!n || n === jobText || (m.job_id && /^job\s*\d+$/i.test(n))) return null;
  return m.note;
}

export function History(p: { item: InventoryItem }) {
  const qtyText = useQty();
  const l = lang.value;
  const moves = movesOf(p.item.id).slice(0, SHOWN);
  return (
    <section class="stack" data-testid="item-history">
      <h3 class="inv-h3">{t('inventory.sheet.history')}</h3>
      {moves.length ? (
        <ul class="inv-hist">
          {moves.map((m) => {
            const Icon = REASON_ICON[m.reason] || ClipboardCheck;
            const d = Number(m.delta);
            const who = staffName(m.created_by);
            const j = m.job_id ? job(m.job_id) : undefined;
            const jobText = m.job_id ? t('inventory.sheet.job', { n: j?.number ?? '' }).trim() : '';
            const note = noteOf(m, jobText);
            return (
              <li key={m.id} class="inv-hist-item" data-testid="move-row">
                <span class={`inv-hist-icon is-${m.reason}`} aria-hidden="true"><Icon size={18} /></span>
                <div class="grow stack" style={{ gap: '2px' }}>
                  <div class="inv-hist-top">
                    <b>{t(`inventory.sheet.reasons.${m.reason}`)}</b>
                    <span class={`num${d < 0 ? ' inv-minus' : ''}`}>{signed(d, qtyText(Math.abs(d), p.item.unit))}</span>
                  </div>
                  <span class="small muted">
                    {stamp(m.created_at, l)}{who && <>, {t('inventory.sheet.by', { name: who })}</>}
                    {!m.updated_at && <> <span class="inv-pending">{t('inventory.sheet.pending')}</span></>}
                  </span>
                  {(note || m.job_id) && (
                    <span class="small inv-hist-note">
                      {note}
                      {m.job_id && <a class="inv-job" href={`#/job/${m.job_id}`}>{jobText || m.note || t('inventory.sheet.job', { n: '' })}</a>}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p class="muted" style={{ margin: 0 }}>{t('inventory.sheet.noHistory')}</p>}
    </section>
  );
}
