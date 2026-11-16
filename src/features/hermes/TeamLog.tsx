/* 🤖 Hermes, the owner only: « Questions de l'équipe », every question asked to Hermes by anyone, newest first, with its
   answer (tap to read it all). Read through the server function (the table has no access from the app). Without signal
   the list says so instead of staying grey; changing the person quickly never shows another person's questions. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { callFn } from '../../data/auth';
import { staffList, staffName } from '../../data/select';
import { errorMessage } from '../../lib/errors';
import { stamp } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { Button, Banner, Skeleton } from '../../ui';
import { latestOnly, type Latest } from './latest';

export type Question = { id: string; staff_id: string; question: string; answer: string | null; error: string | null; created_at: string };
export const PAGE = 100;

export type LogPage = { ok: true; questions: Question[] } | { ok: false; error: string };
export async function readLog(who: string, before?: string): Promise<LogPage> {
  try {
    const r = await callFn<{ questions?: Question[] }>('hermes', { action: 'log', ...(who ? { staff_id: who } : {}), ...(before ? { before } : {}) }, 20000);
    return r.ok ? { ok: true, questions: r.questions || [] } : { ok: false, error: r.error || t('errors.server') };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export function TeamLog(p: { read?: typeof readLog }) {
  const read = p.read || readLog;
  const [who, setWho] = useState('');
  const [list, setList] = useState<Question[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const latest = useRef<Latest>(latestOnly());
  async function load(reset: boolean) {
    const before = !reset && list?.length ? list[list.length - 1].created_at : undefined;
    const r = await latest.current.run(() => read(who, before));
    if (!r) return;   // a newer load was started (another person chosen): this answer is not for the list on screen
    if (!r.ok) { setErr(r.error); if (reset) setList([]); return; }
    setErr(null); setMore(r.questions.length >= PAGE);
    setList(reset ? r.questions : [...(list || []), ...r.questions]);
  }
  useEffect(() => { setList(null); void load(true); return () => latest.current.drop(); }, [who]);
  return (
    <div class="stack" data-testid="hermes-team">
      <p class="muted small" style={{ margin: 0 }}>{t('hermes.teamLead')}</p>
      <select class="select" value={who} onChange={(e) => setWho((e.target as HTMLSelectElement).value)} aria-label={t('hermes.team')} data-testid="hermes-team-who">
        <option value="">{t('hermes.everyone')}</option>
        {staffList.value.map((s) => <option key={s.id} value={s.id}>{s.short_name || s.full_name}</option>)}
      </select>
      {err && <Banner kind="bad">{err}</Banner>}
      {err && list && !list.length && <div><Button size="sm" variant="ghost" onClick={() => load(true)}>{t('common.retry')}</Button></div>}
      {list === null && <Skeleton h={18} lines={4} />}
      {list && !list.length && !err && <p class="muted small">{t('hermes.teamEmpty')}</p>}
      {list?.map((q) => (
        <button key={q.id} type="button" class="hermes-q" onClick={() => setOpen(open === q.id ? null : q.id)} aria-expanded={open === q.id} data-testid="hermes-team-row">
          <span class="faint small">{staffName(q.staff_id) || '?'} · {stamp(q.created_at, lang.value)}</span>
          <b class="hermes-q-text">{q.question}</b>
          {q.answer
            ? <span class={`small hermes-q-answer${open === q.id ? ' is-open' : ''}`}>{q.answer}</span>
            : <span class="small faint">{t('hermes.noAnswer', { why: q.error || '?' })}</span>}
        </button>
      ))}
      {more && <Button size="sm" variant="ghost" onClick={() => load(false)}>{t('hermes.more')}</Button>}
    </div>
  );
}
