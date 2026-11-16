/* « Appel entrant » from GoHighLevel (an owner who switched it on for their own account: `prefs.calls`, « Recevoir les
   appels dans mon compte »): a call that comes in on the garage's number shows here, on every screen, with the number
   and the name GoHighLevel knows (or our own customer's). « Ouvrir » opens Appel entrant with the number already typed.
   A banner, never a jump: the screen in use stays. The calls are noted by the server function « ring » in
   incoming_calls: told at once (realtime), and asked every 10 s while the app is in view. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { PhoneCall, X } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { formatPhone } from '../../lib/text';
import { sb } from '../../data/auth';
import { customersList, customerName } from '../../data/select';
import { navigate } from '../../platform/router';
import { REALTIME } from '../../lib/config';
import { Button, IconButton } from '../../ui';
import { phoneOwners } from '../../shared/customers/dupes';
import { type IncomingCall, callLink, callsOn, onCheckCalls } from '../../services/bubbles';
import { CALL_SHOWN_MS, callToShow } from './calls';
/* The banner's rules (and the « texto à envoyer » sheet's, shared/moment/notify.tsx, on screens that load no picker)
   are in the shared booking stylesheet, loaded here at the start of the app, as before the rebuild: one sheet, one
   order (a copy of the same rules loaded later would change which rule wins). */
import '../../shared/moment/booking.css';

const POLL_MS = 10 * 1000;

export function CallHost() {
  const on = callsOn();
  const [calls, setCalls] = useState<IncomingCall[]>([]);
  const [, setTick] = useState(0);
  const closed = useRef(new Set<string>());
  useEffect(() => {
    if (!on) return;
    let alive = true;
    // only the newest question's answer counts (a slow answer must not put back a list a newer one replaced)
    let asked = 0;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      const mine = ++asked;
      const { data } = await sb.from('incoming_calls').select('id, phone, name, at').gte('at', new Date(Date.now() - CALL_SHOWN_MS).toISOString()).order('at', { ascending: false }).limit(3);
      if (!alive || mine !== asked) return;
      if (data) setCalls(data as IncomingCall[]);
      // the clock moves even when nothing new came: a call older than 3 minutes leaves
      setTick((x) => x + 1);
    };
    // a look that fails (no signal) keeps what is shown: the next one, 10 s later or on realtime, asks again
    const keepShown = () => undefined;
    const look = () => void load().catch(keepShown);
    onCheckCalls(look);
    look();
    const timer = setInterval(look, POLL_MS);
    document.addEventListener('visibilitychange', look);
    const ch = REALTIME ? sb.channel('incoming-calls').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incoming_calls' }, look).subscribe() : null;
    return () => { alive = false; onCheckCalls(null); clearInterval(timer); document.removeEventListener('visibilitychange', look); if (ch) void sb.removeChannel(ch); };
  }, [on]);
  const call = on ? callToShow(calls, closed.current, Date.now()) : null;
  if (!call) return null;
  const known = phoneOwners(call.phone, customersList.value)[0];
  const who = known ? customerName(known) : call.name;
  const close = () => { closed.current.add(call.id); setTick((x) => x + 1); };
  return (
    <div class="call-banner glass-strong" role="alert" data-testid="call-banner">
      <span class="call-banner-icon" aria-hidden="true"><PhoneCall size={22} /></span>
      <span class="call-banner-txt">
        <b>{t('booking.ring.title')}</b>
        <span data-testid="call-banner-who">{[who, formatPhone(call.phone)].filter(Boolean).join(', ')}</span>
        {known && <span class="small muted">{t('booking.ring.known')}</span>}
      </span>
      <Button variant="primary" size="sm" onClick={() => { close(); navigate(callLink(call)); }} data-testid="call-banner-open">{t('booking.ring.open')}</Button>
      <IconButton icon={<X />} label={t('common.close')} onClick={close} data-testid="call-banner-close" />
    </div>
  );
}
