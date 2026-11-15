/* « Notes d'appels »: the note of each call (what the customer wanted, what we told them, what is left to do), on the customer's
   file (`CustomerCalls`) and in the list of the last calls (`#/calls`, the default export). Owners only for now. */
import { useEffect, useState } from 'preact/hooks';
import { PhoneIncoming, PhoneOutgoing, RefreshCw, UserPlus, CalendarPlus, UserRound, ListChecks } from 'lucide-preact';
import type { ScreenProps } from '../../app/routes';
import { t, lang } from '../../lib/i18n';
import { stamp } from '../../lib/dates';
import { formatPhone } from '../../lib/text';
import { customer as customerRow, customerName } from '../../data/select';
import { isOwner, preview } from '../../data/auth';
import { errorMessage } from '../../data/api';
import { Page, Panel, Empty, Banner, Button, Pill, Skeleton, Tabs, toast } from '../../ui';
import { notesOf, recentNotes, transcriptOf, callsSync, callsRedo, callLength, worthShowing, pendingCount, withTodo, type CallNote } from './notes';
import './calls.css';

/** who may see the notes (the server decides again) */
export const mayCalls = () => isOwner() && !preview.value;

function useNotes(load: () => Promise<CallNote[]>, deps: unknown[]) {
  const [list, setList] = useState<CallNote[] | null>(null);
  const [error, setError] = useState('');
  const again = async () => {
    try { setList(await load()); setError(''); }
    catch (e) { setError(errorMessage(e)); setList((l) => l || []); }
  };
  useEffect(() => { let on = true; setList(null); void load().then((l) => { if (on) { setList(l); setError(''); } }, (e) => { if (on) { setError(errorMessage(e)); setList([]); } }); return () => { on = false; }; }, deps);
  // a note still being written: look again in a moment
  const waiting = list ? pendingCount(list) : 0;
  useEffect(() => { if (!waiting) return; const id = setTimeout(() => void again(), 20_000); return () => clearTimeout(id); }, [waiting, list]);
  return { list, error, again };
}

export function NoteCard(p: { n: CallNote; who?: boolean; onChanged?: () => void }) {
  const { n } = p;
  const l = lang.value;
  const [full, setFull] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = n.customer_id ? customerRow(n.customer_id) : undefined;
  const Icon = n.dir === 'out' ? PhoneOutgoing : PhoneIncoming;
  const showAll = async () => {
    if (full != null) { setFull(null); return; }
    try { setFull((await transcriptOf(n.id)) || t('calls.noTranscript')); } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
  };
  const redo = async () => {
    setBusy(true);
    try { const r = await callsRedo(n.id); if (!r.ok) throw Object.assign(new Error(r.error || ''), { code: r.code }); p.onChanged?.(); }
    catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
    finally { setBusy(false); }
  };
  const phone = n.phone ? formatPhone(n.phone) : '';
  return (
    <article class={`call-note is-${n.status}`} data-testid="call-note">
      <header class="call-note-head">
        <Icon size={16} aria-hidden="true" />
        <span class="call-note-when">{[n.at ? stamp(n.at, l) : '', callLength(n.duration_sec)].filter(Boolean).join(', ')}</span>
        {p.who && <span class="call-note-who" data-testid="call-note-who">{c ? customerName(c) : phone || t('calls.unknown')}</span>}
        <span class="call-note-dir">{t(n.dir === 'out' ? 'calls.out' : 'calls.in')}</span>
      </header>
      {n.status === 'done' && (
        <div class="call-note-body">
          {n.summary && <p data-testid="call-note-summary">{n.summary}</p>}
          {n.told && <p><b>{t('calls.told')}</b> {n.told}</p>}
          {n.todo && <p class="call-note-todo" data-testid="call-note-todo"><ListChecks size={16} aria-hidden="true" /> <b>{t('calls.todo')}</b> {n.todo}</p>}
          <div class="row-wrap">
            <Button size="sm" variant="ghost" onClick={() => void showAll()} data-testid="call-note-all">{t(full != null ? 'calls.hideAll' : 'calls.showAll')}</Button>
            {p.who && c && <Button size="sm" variant="ghost" icon={<UserRound />} href={`#/customer/${c.id}`}>{t('calls.file')}</Button>}
            {p.who && c && <Button size="sm" variant="ghost" icon={<CalendarPlus />} href={`#/book?customer=${c.id}`}>{t('calls.book')}</Button>}
            {p.who && !c && n.phone && <Button size="sm" variant="ghost" icon={<UserPlus />} href={`#/call?phone=${encodeURIComponent(n.phone)}`} data-testid="call-note-new">{t('calls.newCustomer')}</Button>}
          </div>
          {full != null && <p class="call-note-full" data-testid="call-note-full">{full}</p>}
        </div>
      )}
      {n.status === 'new' && <p class="muted small call-note-wait" data-testid="call-note-wait">{t('calls.writing')}</p>}
      {n.status === 'failed' && (
        <div class="call-note-body">
          <p class="small"><Pill tone="bad">{t('calls.failed')}</Pill> <span class="muted">{n.error || ''}</span></p>
          <div><Button size="sm" icon={<RefreshCw />} disabled={busy} onClick={() => void redo()} data-testid="call-note-redo">{t('calls.redo')}</Button></div>
        </div>
      )}
      {(n.status === 'short' || n.status === 'no_recording') && <p class="muted small call-note-wait">{t(n.status === 'short' ? 'calls.short' : 'calls.noRecording')}</p>}
    </article>
  );
}

/** on the customer's file: the notes of the calls with this customer */
export function CustomerCalls(p: { customerId: string; phone: string | null }) {
  const { list, error, again } = useNotes(() => notesOf(p.customerId, p.phone), [p.customerId, p.phone]);
  if (!mayCalls()) return null;
  const shown = (list || []).filter(worthShowing);
  // nothing to say and nothing wrong: the panel stays out of the way
  if (list && !shown.length && !error) return null;
  return (
    <Panel title={t('calls.title')} sub={shown.length ? t('calls.count', { n: shown.length }) : undefined} data-testid="calls-panel">
      {!list ? <Skeleton h={18} lines={3} />
        : error ? <Banner kind="warn" action={<Button size="sm" onClick={() => void again()}>{t('common.retry')}</Button>}>{error}</Banner>
          : <div class="call-notes">{shown.map((n) => <NoteCard key={n.id} n={n} onChanged={() => void again()} />)}</div>}
    </Panel>
  );
}

type Tab = 'all' | 'todo';
export default function CallsScreen(_p: ScreenProps) {
  const { list, error, again } = useNotes(() => recentNotes(), []);
  const [tab, setTab] = useState<Tab>('all');
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      const r = await callsSync();
      if (!r.ok) throw Object.assign(new Error(r.error || ''), { code: r.code });
      toast(r.errors?.includes('no_key') ? t('calls.noKey') : t('calls.synced', { n: r.done ?? 0, m: r.pending ?? 0 }), { kind: r.errors?.includes('no_key') ? 'bad' : 'ok' });
      await again();
    } catch (e) { toast(errorMessage(e), { kind: 'bad' }); }
    finally { setBusy(false); }
  };
  const all = (list || []).filter((n) => n.status !== 'short' && n.status !== 'no_recording');
  const todo = withTodo(all);
  const shown = tab === 'todo' ? todo : all;
  return (
    <Page title={t('calls.title')} sub={t('calls.sub')} data-testid="calls-screen"
      actions={<Button icon={<RefreshCw />} disabled={busy} onClick={() => void sync()} data-testid="calls-sync">{t(busy ? 'calls.syncing' : 'calls.sync')}</Button>}>
      <div class="stack">
        <Tabs<Tab> value={tab} onValue={setTab} label={t('calls.title')} tabs={[{ value: 'all', label: t('calls.tabs.all') }, { value: 'todo', label: t('calls.tabs.todo'), count: todo.length }]} />
        {error && <Banner kind="warn" action={<Button size="sm" onClick={() => void again()}>{t('common.retry')}</Button>}>{error}</Banner>}
        {!list ? <Panel><Skeleton h={18} lines={5} /></Panel>
          : shown.length ? <div class="call-notes">{shown.map((n) => <Panel key={n.id}><NoteCard n={n} who onChanged={() => void again()} /></Panel>)}</div>
            : <Panel><Empty title={t(tab === 'todo' ? 'calls.emptyTodo' : 'calls.empty')} text={tab === 'todo' ? undefined : t('calls.emptyText')}
              action={<Button href="#/settings/connect">{t('calls.toSettings')}</Button>} /></Panel>}
      </div>
    </Page>
  );
}
