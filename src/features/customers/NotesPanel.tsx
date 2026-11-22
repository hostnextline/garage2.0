/* Notes on a customer, with an optional reminder date (« Rappeler le … ») and « Fait ».
   Example from Hassan's old app: « Plaquettes arrière à 4 mm : rappeler au printemps ». The rules are notes.ts. */
import { useState } from 'preact/hooks';
import { Check, Trash2, BellRing, Bell, RotateCcw, StickyNote } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { addDays } from '../../lib/dates';
import { notesOf, staffName } from '../../data/select';
import { saveNote } from '../../data/api';
import type { CustomerNote } from '../../data/types';
import { Panel, Button, IconButton, Textarea, DateInput, Field, Pill, attempt } from '../../ui';
import { dateShort, stampDay } from '../../domain/moment/dayWords';
import { currentDay } from '../../domain/oil/clock';
import { dueCount, noteState, orderNotes, quickDays } from './notes';

export function NotesPanel(p: { customerId: string; canEdit: boolean }) {
  const all = notesOf(p.customerId);
  const now = currentDay.value;
  const [body, setBody] = useState('');
  const [remind, setRemind] = useState('');
  const [tried, setTried] = useState(false);
  const due = dueCount(all, now);
  const add = async () => {
    if (!body.trim()) { setTried(true); return; }
    const ok = await attempt(() => saveNote({ customer_id: p.customerId, body: body.trim().slice(0, 4000), remind_on: remind || null, done_at: null }), { ok: t('customers.notes.added') });
    if (ok) { setBody(''); setRemind(''); setTried(false); }
  };
  return (
    <Panel title={t('customers.notes.title')} sub={due ? t('customers.notes.dueCount', { n: due }) : undefined} data-testid="notes-panel">
      <div class="stack">
        {p.canEdit && (
          <div class="customers-note-add">
            <Field label={t('customers.notes.new')} error={tried && !body.trim() ? t('customers.notes.empty') : null}>
              <Textarea value={body} onValue={(v) => { setBody(v); setTried(false); }} rows={2} placeholder={t('customers.notes.placeholder')} maxLength={4000} data-testid="note-body" />
            </Field>
            {(body.trim() || remind) && <Field label={t('customers.notes.remind')} optional group>
              <div class="customers-note-when">
                <div class="chips" role="group" aria-label={t('customers.notes.remind')}>
                  {quickDays(now).map((x) => (
                    <button key={x.key} type="button" class="chip" aria-pressed={remind === x.day} title={dateShort(x.day)}
                      onClick={() => setRemind(remind === x.day ? '' : x.day)} data-testid={`note-${x.key}`}>{t(`customers.notes.${x.key}`)}</button>
                  ))}
                </div>
                <DateInput value={remind} onValue={setRemind} min={addDays(now, 1)} aria-label={t('customers.notes.remindDate')} />
              </div>
            </Field>}
            <Button icon={<StickyNote size={18} />} onClick={add} data-testid="note-add">
              {remind ? t('customers.notes.addWith', { date: dateShort(remind) }) : t('customers.notes.add')}
            </Button>
          </div>
        )}
        {all.length === 0
          ? <p class="muted" style={{ margin: 0 }}>{t('customers.notes.none')}</p>
          : <ul class="customers-notes" data-testid="notes-list">{orderNotes(all).map((n) => <NoteItem key={n.id} n={n} canEdit={p.canEdit} today={now} />)}</ul>}
      </div>
    </Panel>
  );
}

function NoteItem(p: { n: CustomerNote; canEdit: boolean; today: string }) {
  const n = p.n;
  const who = staffName(n.created_by);
  const when = stampDay(n.created_at, !!who);
  const state = noteState(n, p.today);
  const pill = state === 'done' ? <Pill tone="muted" dot={false}>{t('customers.notes.doneOn', { date: stampDay(n.done_at, true) })}</Pill>
    : state === 'late' ? <Pill tone="warn"><BellRing size={14} aria-hidden="true" />{t('customers.notes.due', { date: dateShort(n.remind_on as string) })}</Pill>
      : state === 'today' ? <Pill tone="warn"><BellRing size={14} aria-hidden="true" />{t('customers.notes.dueToday')}</Pill>
        : state === 'later' ? <Pill tone="booked" dot={false}><Bell size={14} aria-hidden="true" />{t('customers.notes.later', { date: dateShort(n.remind_on as string) })}</Pill> : null;
  const patch = (x: Partial<CustomerNote>) => attempt(() => saveNote({ id: n.id, customer_id: n.customer_id, ...x }));
  return (
    <li class={`customers-note${n.done_at ? ' is-done' : ''}`} data-testid="note">
      <p class="customers-note-body">{n.body}</p>
      <div class="customers-note-meta">
        {pill}
        <span class="faint small">{who ? t('customers.notes.by', { name: who, date: when }) : t('customers.notes.on', { date: when })}</span>
        <span class="grow" />
        {p.canEdit && n.remind_on && !n.done_at && <Button icon={<Check size={18} />} onClick={() => patch({ done_at: new Date().toISOString() })} data-testid="note-done">{t('customers.notes.done')}</Button>}
        {p.canEdit && n.done_at && <Button variant="ghost" icon={<RotateCcw size={18} />} onClick={() => patch({ done_at: null })}>{t('customers.notes.reopen')}</Button>}
        {p.canEdit && <IconButton icon={<Trash2 />} label={t('customers.notes.delete')} confirm={t('customers.notes.deleteConfirm')} onClick={() => patch({ deleted_at: new Date().toISOString() })} data-testid="note-delete" />}
      </div>
    </li>
  );
}
