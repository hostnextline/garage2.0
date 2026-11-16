/* Who the appointment is for: a customer we know (the search, or « Nouveau client » in a sheet), or with « Appel
   entrant » somebody new: the first name and the number, asked last (the file is made when « Réserver » is tapped). */
import { Search, UserPlus } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { phoneDigits } from '../../lib/text';
import { customersList, customerName } from '../../data/select';
import { Panel, Field, Input, PhoneInput, Button, Banner } from '../../ui';
import { CustomerPicker } from '../../shared/customers/CustomerPicker';
import { phoneOwners } from '../../shared/customers/dupes';
import type { Action, Caller } from './draft';

type Act = (a: Action) => void;

export function CustomerPanel(p: { customerId: string | null; newCaller: boolean; searchKnown: boolean; caller: Caller; tried: boolean; autoFocus: boolean; act: Act }) {
  if (p.newCaller && !p.searchKnown) return <CallerPanel caller={p.caller} tried={p.tried} act={p.act} />;
  return (
    <Panel title={t('booking.customer.title')} data-tour="book-customer">
      <CustomerPicker value={p.customerId} onPick={(id) => p.act({ t: 'pickCustomer', id })} allowCreate autoFocus={p.autoFocus} />
      {p.newCaller && p.searchKnown && (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <Button size="sm" variant="ghost" icon={<UserPlus />} onClick={() => p.act({ t: 'searchKnown', on: false })}>{t('booking.call.backNew')}</Button>
        </div>
      )}
    </Panel>
  );
}

/** a new caller: the name and the number; a number already on file says whose it is (« C'est lui ») */
function CallerPanel(p: { caller: Caller; tried: boolean; act: Act }) {
  const { caller } = p;
  const set = (patch: Partial<Caller>) => p.act({ t: 'caller', patch });
  const dupes = phoneOwners(caller.phone, customersList.value);
  return (
    <Panel title={t('booking.call.who')} sub={t('booking.call.whoSub')} data-testid="call-who">
      <div class="stack">
        <div class="grid-2">
          <Field label={t('customers.form.first')} error={p.tried && !caller.first.trim() ? t('booking.call.needFirst') : null}>
            <Input value={caller.first} onValue={(v) => set({ first: v })} autoComplete="off" autoCapitalize="words" data-testid="call-first" />
          </Field>
          <Field label={t('customers.form.last')} optional>
            <Input value={caller.last} onValue={(v) => set({ last: v })} autoComplete="off" autoCapitalize="words" data-testid="call-last" />
          </Field>
        </div>
        <Field label={t('customers.form.phone')} error={p.tried && !phoneDigits(caller.phone) ? t('booking.call.needPhone') : null}>
          <PhoneInput value={caller.phone} onValue={(v) => set({ phone: v })} />
        </Field>
        {dupes.length > 0 && (
          <Banner kind="warn" title={t('booking.call.already', { name: customerName(dupes[0]) })} data-testid="call-already"
            action={<Button size="sm" onClick={() => p.act({ t: 'pickCustomer', id: dupes[0].id })} data-testid="call-same">{t('booking.call.isThem')}</Button>}>
            {t('booking.call.alreadyText')}
          </Banner>
        )}
        <div><Button size="sm" variant="ghost" icon={<Search />} onClick={() => p.act({ t: 'searchKnown', on: true })} data-testid="call-search-known">{t('booking.call.searchKnown')}</Button></div>
      </div>
    </Panel>
  );
}
