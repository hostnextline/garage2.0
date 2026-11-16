/* « Objectif du mois »: the revenue aimed at each month (before taxes), the same for the whole team
   (settings.billing.goal_cents), or « Retirer l'objectif ». */
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { saveSettings } from '../../data/api';
import { settings } from '../../data/select';
import { Button, Sheet, Field, MoneyInput, Form, attempt } from '../../ui';

export function GoalSheet(p: { open: boolean; onClose: () => void }) {
  const cur = settings.value.billing.goal_cents ?? null;
  const [cents, setCents] = useState<number | null>(cur);
  const [err, setErr] = useState<string | null>(null);
  // each opening starts from the goal as it is now
  useEffect(() => { if (p.open) { setCents(cur); setErr(null); } }, [p.open]);
  const save = async (value: number | null) => {
    if (value != null && value <= 0) { setErr(t('dashboard.goal.invalid')); return; }
    const ok = await attempt(() => saveSettings('billing', { ...settings.value.billing, goal_cents: value }), { ok: value == null ? t('dashboard.goal.removed') : t('dashboard.goal.saved') });
    if (ok) p.onClose();
  };
  return (
    <Sheet open={p.open} onClose={p.onClose} title={t('dashboard.goal.title')} data-testid="goal-sheet"
      footer={<>
        {cur != null && <Button variant="ghost" onClick={() => save(null)}>{t('dashboard.goal.remove')}</Button>}
        <Button variant="primary" type="submit" form="goal-form" data-testid="goal-save">{t('dashboard.goal.save')}</Button>
      </>}>
      <Form id="goal-form" onSubmit={() => save(cents)}>
        <Field label={t('dashboard.goal.field')} hint={t('dashboard.goal.hint')} error={err}>
          <MoneyInput cents={cents} onCents={(c) => { setCents(c); setErr(null); }} autoFocus aria-label={t('dashboard.goal.field')} />
        </Field>
      </Form>
    </Sheet>
  );
}
