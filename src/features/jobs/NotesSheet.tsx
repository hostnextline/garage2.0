/* « Le problème » and the team's notes of a job, changed by the owner or the office. The form is born with the sheet. */
import { useState } from 'preact/hooks';
import type { Job } from '../../data/types';
import { Sheet, Button, Field, Textarea, attempt } from '../../ui';
import { t } from '../../lib/i18n';
import { updateJob } from '../../data/api';

export function NotesSheet(p: { job: Job; open: boolean; onClose: () => void }) {
  if (!p.open) return null;
  return <NotesOpen job={p.job} onClose={p.onClose} />;
}
function NotesOpen(p: { job: Job; onClose: () => void }) {
  const [problem, setProblem] = useState(p.job.problem || '');
  const [notes, setNotes] = useState(p.job.notes || '');
  const save = async () => {
    if (await attempt(() => updateJob(p.job.id, { problem: problem.trim() || null, notes: notes.trim() || null }), { ok: t('jobs.problem.saved') })) p.onClose();
  };
  return (
    <Sheet open onClose={p.onClose} title={t('jobs.problem.editTitle')}
      footer={<><Button onClick={p.onClose}>{t('common.cancel')}</Button><Button variant="primary" onClick={save}>{t('common.save')}</Button></>}>
      <div class="stack">
        <Field label={t('jobs.problem.problemLabel')}><Textarea value={problem} onValue={setProblem} rows={3} maxLength={2000} /></Field>
        <Field label={t('jobs.problem.notesLabel')} hint={t('jobs.problem.notesHint')} optional><Textarea value={notes} onValue={setNotes} rows={3} maxLength={2000} /></Field>
      </div>
    </Sheet>
  );
}
