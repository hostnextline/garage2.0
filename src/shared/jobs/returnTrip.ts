/* « Retour à la Centrale » after the last job of the day: the trip back, and the garage's number gets the arrival time and
   the live map (« Je pars vers … »); « Je suis arrivé » ends it. Needs the network (not kept on the phone). */
import { enroute, errorMessage } from '../../data/api';
import { pull, isNetworkError, uuid } from '../../data/sync';
import { intents, keepOp, KEEP_OP_MS } from '../../domain/jobs/intents';
import { today } from '../../lib/dates';
import { toast } from '../../ui';
import { t } from '../../lib/i18n';
import { quickPosition } from '../../services/position';
import { clockOf } from './select';
import { outcome } from './texts';

/** one id per « Je pars vers la Centrale », kept until the server answered: tapped again after a lost answer, one trip
    and one text (enroute return, R28). Only for that retry: a few minutes, the same day (the Montréal one), and not
    after « Je suis arrivé »: the next way back is a new trip, never the old one's « already » (jobs-r2-1) */
const returns = intents(uuid, { maxAge: KEEP_OP_MS });
/** « Je pars vers la Centrale » */
export async function doReturn(): Promise<void> {
  const pos = await quickPosition();
  const op = returns.op('return', today());
  try {
    const e = await enroute('return', null, { pos, notify: true, op });
    returns.done('return', op);
    if (!e.ok) { toast(errorMessage(e), { kind: 'bad' }); return; }
    const time = e.eta_at ? clockOf(e.eta_at) : '';
    const place = e.place || 'Centrale';
    if (e.sms === 'sent') toast(time ? t('today.return.sentEta', { time }) : t('today.return.sent'), { kind: 'ok' });
    else if (e.sms === 'quiet') toast(t('today.return.quiet', { place }));
    else if (e.sms === 'no_phone') { toast(t('today.return.noPhone'), { kind: 'bad' }); outcome.value = { status: 'off', message: e.message, link: e.link, phone: null, error: e.error }; }
    else outcome.value = { status: e.sms, message: e.message, link: e.link, phone: e.phone, error: e.error };
    void pull('trips');
    void pull('messages');
  } catch (err) {
    if (!keepOp(err, isNetworkError(err))) returns.done('return', op);
    toast(isNetworkError(err) ? t('today.return.offline') : errorMessage(err), { kind: 'bad' });
  }
}
/** « Je suis arrivé » at the start: the trip back is over (ending the day does it too). Said only once the server says so:
    a refusal (an expired session, a server error) leaves the trip on, and the customer page would still show the truck on
    its way */
export async function doReturnEnd(): Promise<void> {
  try {
    const e = await enroute('return_end', null);
    if (!e.ok) { toast(errorMessage(e), { kind: 'bad' }); return; }
    returns.forget('return');
    void pull('trips');
    toast(t('today.return.arrivedToast'), { kind: 'ok' });
  } catch (err) {
    toast(isNetworkError(err) ? t('today.return.offline') : errorMessage(err), { kind: 'bad' });
  }
}
