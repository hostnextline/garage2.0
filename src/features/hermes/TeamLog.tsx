/* 🤖 Hermes, the owner only: « Questions de l'équipe », every question asked to Hermes by anyone, newest first, with its
   answer (tap to read it all). Read through the server function (the table has no access from the app). */
import { useEffect, useState } from 'preact/hooks';
import { callFn } from '../../data/auth';
import { staffList, staffName } from '../../data/select';
import { stamp } from '../../lib/dates';
import { t, lang } from '../../lib/i18n';
import { Button, Banner, Skeleton } from '../../ui';

type Q = { id: string; staff_id: string; question: string; answer: string | null; error: string | null; created_at: string };

export function TeamLog() {
  const [who, setWho] = useState('');
  const [list, setList] = useState<Q[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  async function load(reset: boolean) {
    const before = !reset && list?.length ? list[list.length - 1].created_at : undefined;
    const r = await callFn<{ questions?: Q[] }>('hermes', { action: 'log', ...(who ? { staff_id: who } : {}), ...(before ? { before } : {}) }, 20000);
    if (!r.ok) { setErr(r.error || t('errors.server')); if (reset) setList([]); return; }
    const got = r.questions || [];
    setErr(null); setMore(got.length >= 100);
    setList(reset ? got : [...(list || []), ...got]);
  }
  useEffect(() => { setList(null); void load(true); }, [who]);
  return (
    <div class="stack" data-testid="hermes-team">
      <p class="muted small" style={{ margin: 0 }}>{t('hermes.teamLead')}</p>
      <select class="select" value={who} onChange={(e) => setWho((e.target as HTMLSelectElement).value)} aria-label={t('hermes.team')} data-testid="hermes-team-who">
        <option value="">{t('hermes.everyone')}</option>
        {staffList.value.map((s) => <option key={s.id} value={s.id}>{s.short_name || s.full_name}</option>)}
      </select>
      {err && <Banner kind="bad">{err}</Banner>}
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
