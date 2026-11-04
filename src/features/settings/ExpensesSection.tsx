/* Catégories de dépenses: the list used to file expenses and receipts (Trésorerie): rename, reorder, remove, add. */
import { useState } from 'preact/hooks';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { fold } from '../../lib/text';
import { settings } from '../../data/select';
import { saveSettings } from '../../data/api';
import { Panel, Input, IconButton, Button, Empty, attempt, toast } from '../../ui';
import { useSectionDraft, SaveBar, Section } from './SectionFrame';

export function ExpensesSection() {
  const saved = (settings.value.expense_categories || []).map(String);
  const { draft: d, set, dirty, reset } = useSectionDraft<string[]>('expenses', saved);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const dupes = new Set(d.map((x) => fold(x)).filter((x, i, a) => x && a.indexOf(x) !== i));
  const move = (i: number, by: number) => set((x) => { const a = x.slice(); const [v] = a.splice(i, 1); a.splice(i + by, 0, v); return a; });
  const add = () => {
    const v = name.trim();
    if (!v) { setErr(t('settings.expenses.needName')); return; }
    if (d.some((x) => fold(x) === fold(v))) { setErr(t('settings.expenses.duplicate')); return; }
    set((x) => [...x, v]); setName(''); setErr(null);
  };
  const save = async () => {
    if (dupes.size) { toast(t('settings.fixErrors'), { kind: 'bad' }); return; }
    const list = d.map((x) => x.trim()).filter(Boolean);
    if (await attempt(() => saveSettings('expense_categories', list), { ok: t('settings.saved') })) reset();
  };
  return (
    <Section testid="settings-expenses" bar={<SaveBar dirty={dirty} onSave={save} onReset={() => { reset(); setErr(null); }} />}>
      <p class="muted" style={{ margin: 0 }}>{t('settings.expenses.lead')}</p>
      <Panel flush help={t('settings.expenses.help')} title={t('settings.sections.expenses.title')}>
        {!d.length && <Empty title={t('settings.expenses.empty')} />}
        <div class="rows" role="list">
          {d.map((c, i) => (
            <div key={i} class="row-item settings-cat" role="listitem">
              <Input value={c} onValue={(v) => set((x) => x.map((y, k) => (k === i ? v : y)))} invalid={dupes.has(fold(c))} aria-label={c || t('settings.expenses.newPh')} />
              <IconButton icon={<ArrowUp />} label={t('settings.expenses.up')} disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon={<ArrowDown />} label={t('settings.expenses.down')} disabled={i === d.length - 1} onClick={() => move(i, 1)} />
              <IconButton icon={<Trash2 />} label={t('settings.expenses.remove', { name: c })} onClick={() => set((x) => x.filter((_, k) => k !== i))} />
            </div>
          ))}
        </div>
        <div class="settings-cat-add">
          <Input value={name} onValue={(v) => { setName(v); setErr(null); }} placeholder={t('settings.expenses.newPh')} aria-label={t('settings.expenses.newPh')} onEnter={add} invalid={!!err} data-testid="cat-new" />
          <Button icon={<Plus size={18} />} onClick={add} data-testid="cat-add">{t('settings.expenses.add')}</Button>
        </div>
        {err && <p class="field-error settings-cat-err" role="alert">{err}</p>}
        {dupes.size > 0 && <p class="field-error settings-cat-err" role="alert">{t('settings.expenses.duplicate')}</p>}
      </Panel>
    </Section>
  );
}
