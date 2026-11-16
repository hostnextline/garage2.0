/* « + » (Ajouter): the quick entries a person may use (nav.ts QUICK). Choosing one navigates; the router closes the
   sheet and removes its history step first, so « Retour » goes straight back. */
import { signal } from '@preact/signals';
import { t } from '../lib/i18n';
import { navigate } from '../platform/router';
import { windowsOn } from '../data/select';
import { Sheet, Rows, RowItem } from '../ui';
import { QUICK } from './nav';

const quickOpen = signal(false);
export const openQuick = () => { quickOpen.value = true; };

export function QuickSheet() {
  const items = QUICK.filter((q) => q.show());
  return (
    <Sheet open={quickOpen.value} onClose={() => (quickOpen.value = false)} title={t('shell.quick.title')} data-testid="quick-sheet">
      <Rows>
        {items.map((q) => {
          const Icon = q.icon;
          return (
            <RowItem key={q.key} start={<span class="quick-icon"><Icon size={22} /></span>} title={t(`shell.quick.${q.key}`)} sub={t(q.key === 'book' && windowsOn.value ? 'shell.quick.bookSubWin' : `shell.quick.${q.key}Sub`)} chevron
              data-testid={`quick-${q.key}`} onClick={() => { quickOpen.value = false; navigate(q.href.slice(1)); }} />
          );
        })}
      </Rows>
    </Sheet>
  );
}
