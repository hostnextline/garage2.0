/* The connection, as the frame shows it: the sync chip (in the bars) and the sync sheet (what waits, what was refused).
   What the chip says is worked out in netView.ts. */
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { CloudOff, RefreshCw, OctagonAlert } from 'lucide-preact';
import { t, lang } from '../lib/i18n';
import { stamp } from '../lib/dates';
import { browserOnline } from '../platform/media';
import { net, flush, pullAll, dismissFailed, outboxList } from '../data/sync';
import type { OutboxEntry } from '../data/local';
import { Button, Sheet, Banner, Rows, RowItem, ask } from '../ui';
import { readNet, refusalText, type NetView } from './netView';

/** the frame's view of the connection (old and new shapes of `net`) */
export const netView = (): NetView => readNet(net.value, browserOnline.value);

/** a payment taken on the phone and refused by the server: its entry is the only trace of money the customer may have
    handed over (argent-app-03, S01) */
export const isPaymentEntry = (e: Pick<OutboxEntry, 'kind' | 'rpc'>): boolean => e.kind === 'rpc' && e.rpc === 'payment_add';
/** « Retirer » on a refused change: a payment asks first (the customer may have paid), anything else goes in one tap.
    true = the entry was taken off the phone */
export async function removeFailed(e: OutboxEntry): Promise<boolean> {
  if (isPaymentEntry(e) && !(await ask({ title: t('shell.failed.paymentAsk'), text: t('shell.failed.paymentConfirm'), ok: t('shell.failed.dismiss'), danger: true }))) return false;
  await dismissFailed(e.seq!);
  return true;
}

export const syncOpen = signal(false);
const openSync = () => { syncOpen.value = true; };

/** shows only when there is something to say (no signal, changes waiting or refused): nothing when all is sent */
export function SyncChip() {
  const v = netView();
  if (v.chip === 'synced') return null;
  const label = v.chip === 'offline' ? t('shell.sync.offline') : v.chip === 'pending' ? t('shell.sync.pending', { n: v.pending })
    : v.chip === 'sending' ? t('shell.sync.sending') : t('shell.failed.chip', { n: v.failed });
  const extra = !v.online && v.pending ? ` (${v.pending})` : '';
  return (
    <button type="button" class={`syncchip syncchip-${v.chip}${v.failed ? ' has-failed' : ''}`} onClick={openSync} data-tour="sync-state" data-testid="sync-chip"
      aria-label={`${t('shell.sync.title')} : ${label}${!v.online && v.pending ? ` (${t('shell.sync.pending', { n: v.pending })})` : ''}`}>
      {v.chip === 'offline' ? <CloudOff size={16} /> : v.chip === 'failed' ? <OctagonAlert size={16} /> : <RefreshCw size={16} class={v.chip === 'sending' ? 'spin-slow' : ''} />}
      <span>{label}{extra}</span>
    </button>
  );
}

export function SyncSheet() {
  const n = net.value;
  const v = netView();
  const [list, setList] = useState<OutboxEntry[]>([]);
  const open = syncOpen.value;
  // the answer of an older read never replaces a newer one
  const [asked, setAsked] = useState(0);
  const refresh = () => setAsked((x) => x + 1);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    outboxList().then((l) => { if (alive) setList(l); }, () => undefined);
    return () => { alive = false; };
  }, [open, n.pending, n.failed.length, asked]);
  const pending = list.filter((e) => e.state === 'pending');
  const failed = list.filter((e) => e.state === 'failed');
  return (
    <Sheet open={open} onClose={() => (syncOpen.value = false)} title={t('shell.sync.title')} data-testid="sync-sheet"
      footer={<Button variant="primary" block icon={<RefreshCw size={18} />} onClick={async () => { await flush(); await pullAll(); refresh(); }}>{t('shell.sync.sendNow')}</Button>}>
      <div class="stack">
        {!v.online && <Banner kind="warn">{t('shell.sync.offlineLead')}</Banner>}
        {v.storageLost && <Banner kind="bad">{t('shell.sync.storage')}</Banner>}
        {v.stuck > 0 && <Banner kind="warn">{t('shell.stuck', { n: v.stuck })}{v.stuckLabel ? ` — ${v.stuckLabel}` : ''}</Banner>}
        <p class="muted small" style={{ margin: 0 }}>
          {n.realtime ? t('shell.sync.live') : t('shell.sync.notLive')}
          {n.lastPull ? ` — ${t('shell.sync.lastPull', { when: stamp(n.lastPull, lang.value) })}` : ''}
        </p>
        {failed.length > 0 && (
          <>
            <h3>{t('shell.failed.title', { n: failed.length })}</h3>
            <p class="muted small" style={{ margin: 0 }}>{t('shell.failed.lead')}</p>
            <Rows>
              {failed.map((e) => (
                <RowItem key={e.seq} title={e.label || t('log.change')} sub={refusalText({ ...e, label: null })}
                  end={<span class="row">
                    <Button size="sm" onClick={async () => { await dismissFailed(e.seq!, true); refresh(); }}>{t('shell.failed.retry')}</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { if (await removeFailed(e)) refresh(); }}>{t('shell.failed.dismiss')}</Button>
                  </span>} />
              ))}
            </Rows>
          </>
        )}
        {pending.length > 0 && (
          <>
            <h3>{t('shell.sync.pending', { n: pending.length })}</h3>
            <p class="muted small" style={{ margin: 0 }}>{t('shell.sync.pendingLead')}</p>
            <Rows>{pending.map((e) => <RowItem key={e.seq} title={e.label || t('log.change')} sub={stamp(e.at, lang.value)} />)}</Rows>
          </>
        )}
        {!pending.length && !failed.length && v.online && <Banner kind="ok">{t('shell.sync.synced')}</Banner>}
      </div>
    </Sheet>
  );
}
