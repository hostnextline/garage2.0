/* On « La journée », from Thursday: what to buy for the coming week (Sunday: this week), the first four lines and
   « Voir la liste ». Nothing on Monday to Wednesday, or when the week takes nothing. */
import { PackageCheck } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { today, weekStart, type Day } from '../../lib/dates';
import { Panel, Button } from '../../ui';
import { shoppingWeek } from '../../domain/stock/needs';
import { useWeekNeeds } from './useWeekNeeds';
import { lineLabel, qtyWords, weekWords } from './needsWords';
import './needs.css';

export function NeedsCard() {
  const from = shoppingWeek(today());
  if (!from) return null;
  return <NeedsCardOf from={from} />;
}
function NeedsCardOf(p: { from: Day }) {
  const w = useWeekNeeds(p.from);
  if (!w.lines.length) return null;
  const buy = w.lines.filter((l) => l.toBuy > 0);
  const title = p.from === weekStart(today()) ? t('inventory.needs.cardThis') : t('inventory.needs.cardNext');
  return (
    <Panel flush title={title} sub={weekWords(p.from)} help={t('inventory.needs.cardHelp')} data-testid="today-needs"
      action={<Button size="sm" href={`#/needs?week=${p.from}`} data-testid="today-needs-open">{t('inventory.needs.cardOpen')}</Button>}>
      {buy.length ? (
        <ul class="needs-buy" role="list">
          {buy.slice(0, 4).map((l) => (
            <li key={l.key} class="needs-buy-row">
              <span class="needs-buy-name">{lineLabel(l)}</span>
              <span class="needs-buy-qty"><b class="num">{qtyWords(l, l.toBuy)}</b></span>
            </li>
          ))}
          {buy.length > 4 && <li class="needs-buy-row small muted">{t('inventory.needs.cardMore', { n: buy.length - 4 })}</li>}
        </ul>
      ) : <p class="inv-none"><PackageCheck size={18} aria-hidden="true" /> {t('inventory.needs.nothingToBuy')}</p>}
    </Panel>
  );
}
