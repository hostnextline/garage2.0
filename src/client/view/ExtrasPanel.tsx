/* The extra work the mechanic proposes, while the visit is coming or under way: each one to accept or refuse in two
   steps, for the price shown (when it moved meanwhile, the new price is said and the customer chooses again). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Button } from '../../ui/Button';
import type { ExtraV, JobView } from '../api';
import { cad, lineCents } from '../format';
import { ct, type CLang } from '../i18n';
import { Note } from '../ui';
import type { ActResult, Reply } from './useAppointment';
import { chargesTaxes, extrasToAnswer } from './view-state';

type Answer = (x: ExtraV, accept: boolean) => Promise<ActResult>;

export function ExtrasPanel(p: { v: JobView; l: CLang; reply: Reply; onAnswer: Answer }) {
  const { v, l, reply } = p;
  const proposed = extrasToAnswer(v);
  const taxed = chargesTaxes(v);
  return (
    <section class="cl-panel glass cl-extras cl-noprint" aria-labelledby="cl-extras" data-testid="client-extras">
      <h2 id="cl-extras">{ct(l, 'extras.title')}</h2>
      {proposed.length > 0 && <p class="cl-sub">{ct(l, 'extras.lead')}</p>}
      <div class="cl-stack">
        {reply?.kind === 'thanks' && (
          <Note kind="ok" data-testid="client-thanks">
            <p class="cl-thanks">{ct(l, 'extras.thanks')}</p>
            {v.expected.total > 0 && <p>{ct(l, 'extras.newTotal', { total: cad(v.expected.total, l) })}</p>}
          </Note>
        )}
        {reply?.kind === 'already' && (
          <Note kind="info" data-testid="client-already">{ct(l, reply.status === 'approved' ? 'extras.alreadyAccepted' : 'extras.alreadyDeclined')}</Note>
        )}
        {reply?.kind === 'closed' && <Note kind="warn" data-testid="client-extras-closed">{ct(l, 'extras.closed')}</Note>}
        {proposed.map((x) => <ExtraCard key={x.id} x={x} l={l} taxed={taxed} onAnswer={p.onAnswer} />)}
      </div>
    </section>
  );
}

function ExtraCard(p: { x: ExtraV; l: CLang; taxed: boolean; onAnswer: Answer }) {
  const { x, l } = p;
  const [step, setStep] = useState<'idle' | 'accept' | 'decline'>('idle');
  const [said, setSaid] = useState<{ text: string; kind: 'bad' | 'warn' } | null>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const price = cad(lineCents(x), l);
  useEffect(() => { if (step !== 'idle') confirmRef.current?.focus(); }, [step]);
  const send = async () => {
    setSaid(null);
    const r = await p.onAnswer(x, step === 'accept');
    if (r.ok) return;
    // the visit is over: the panel says it once, above (the card goes away with the file read again)
    if (r.code === 'closed') { setStep('idle'); return; }
    if (r.code === 'amount_changed') {
      // back to the choice, with the new price said: the customer decides again on what he sees
      setStep('idle');
      setSaid({ text: ct(l, r.key, { price: cad(r.cents ?? lineCents(x), l) }), kind: 'warn' });
    } else setSaid({ text: ct(l, r.key), kind: 'bad' });
  };
  const id = `cl-x-${x.id}`;
  return (
    <article class="cl-extra" aria-labelledby={id} data-testid="client-extra">
      <h3 id={id}>{x.description}</h3>
      {x.note && <p class="cl-why"><b>{ct(l, 'extras.why')}</b> {x.note}</p>}
      <p class="cl-price" style={{ margin: 0 }}><b>{price}</b>{p.taxed && <span>{ct(l, 'extras.plusTax')}</span>}</p>
      {step === 'idle' ? (
        <div class="cl-choice">
          <Button onClick={() => setStep('decline')} data-testid="client-extra-decline">{ct(l, 'extras.decline')}</Button>
          <Button variant="primary" onClick={() => setStep('accept')} data-testid="client-extra-accept">{ct(l, 'extras.accept')}</Button>
        </div>
      ) : (
        <>
          <p class="cl-confirm" ref={confirmRef} tabIndex={-1}>
            {step === 'accept' ? ct(l, p.taxed ? 'extras.confirmAccept' : 'extras.confirmAcceptNoTax', { price }) : ct(l, 'extras.confirmDecline')}
          </p>
          <div class="cl-choice">
            <Button onClick={() => { setSaid(null); setStep('idle'); }} data-testid="client-extra-back">{ct(l, 'extras.back')}</Button>
            <Button variant={step === 'accept' ? 'primary' : 'danger'} onClick={send} data-testid="client-extra-confirm">
              {ct(l, step === 'accept' ? 'extras.yesAccept' : 'extras.yesDecline')}
            </Button>
          </div>
        </>
      )}
      {said && <Note kind={said.kind}>{said.text}</Note>}
    </article>
  );
}
