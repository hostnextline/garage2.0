/* Services et prix: the price list (search above 8), and a service's sheet (ServiceSheet). */
import { useState } from 'preact/hooks';
import { Plus } from 'lucide-preact';
import { t, lang } from '../../../lib/i18n';
import { duration, shortDate, today } from '../../../lib/dates';
import { matches } from '../../../lib/text';
import { servicesList, serviceName } from '../../../data/select';
import type { Service } from '../../../data/types';
import { Panel, Rows, RowItem, Pill, Money, Button, SearchInput, Empty } from '../../../ui';
import { useSectionAnchor } from '../SectionFrame';
import { ServiceSheet } from './ServiceSheet';
import { promoEnded } from './serviceModel';

export function ServicesSection() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);   // a service id, or 'new'
  const all = servicesList.value;
  const list = all.filter((s) => matches(q, s.name_fr, s.name_en, s.category));
  const anchor = useSectionAnchor();
  return (
    <div class="settings-section stack-lg" data-testid="settings-services">
      <Panel flush title={t('settings.services.list')} help={t('settings.services.listHelp')} data-tour={anchor}
        action={<Button variant="primary" size="sm" icon={<Plus size={18} />} onClick={() => setOpen('new')} data-testid="service-add">{t('settings.services.add')}</Button>}>
        {all.length > 8 && <div class="settings-search"><SearchInput value={q} onValue={setQ} placeholder={t('settings.services.search')} /></div>}
        {!all.length
          ? <Empty title={t('settings.services.none')} text={t('settings.services.noneText')} action={<Button variant="primary" icon={<Plus size={18} />} onClick={() => setOpen('new')}>{t('settings.services.add')}</Button>} />
          : !list.length ? <Empty title={t('settings.services.noMatch')} />
          : (
            <Rows>
              {list.map((s) => (
                <RowItem key={s.id} onClick={() => setOpen(s.id)} data-testid={`service-${s.id}`} chevron class={s.active ? '' : 'settings-off'}
                  title={serviceName(s, lang.value)} sub={<ServiceSub s={s} />}
                  end={<span class="settings-svc-end">
                    {!s.active && <Pill tone="muted">{t('settings.services.hidden')}</Pill>}
                    {s.price_cents == null ? <span class="small muted">{t('settings.services.toConfirm')}</span> : <Money cents={s.price_cents} />}
                  </span>} />
              ))}
            </Rows>
          )}
      </Panel>
      <ServiceSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

/** under the name: the promo and its end (said when it is over: booking no longer offers it), else category and duration */
function ServiceSub({ s }: { s: Service }) {
  if (s.promo_until && promoEnded(s, today())) return <span class="settings-promo">{t('settings.services.promoEnded', { date: shortDate(s.promo_until, lang.value) })}</span>;
  if (s.is_promo) return <span class="settings-promo">{s.promo_until ? t('settings.services.promoUntil', { date: shortDate(s.promo_until, lang.value) }) : t('settings.services.promo')}</span>;
  return <>{t('settings.services.meta', { category: cap(s.category), duration: duration(s.duration_min, lang.value) })}</>;
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
