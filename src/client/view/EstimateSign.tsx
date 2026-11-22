/* The estimate to accept: « J’accepte et je signe » (one tap, the name on the file) or the name and the finger, with the
   conditions of the work; « Estimation signée par… » once done. Always for the total shown: when it moved meanwhile, the
   new total is said and the customer is asked again. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { PenLine } from 'lucide-preact';
import { Button } from '../../ui/Button';
import { shortDate } from '../../lib/dates';
import { SignaturePad } from '../../shared/sign/SignaturePad';
import { hasEnoughInk, type Stroke } from '../../shared/sign/signature';
import type { JobView } from '../api';
import { cad, localDayOf } from '../format';
import { ct, type CLang } from '../i18n';
import { Note, garageName } from '../ui';
import type { ActResult, Drawn } from './useAppointment';

type Said = { text: string; kind: 'bad' | 'warn' } | null;

export function EstimateSign(p: { v: JobView; l: CLang; onSign: (d: Drawn | null) => Promise<ActResult> }) {
  const { v, l } = p;
  const e = v.estimate;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  // « J’accepte … {total} » is ticked FOR a total: when the file read again shows another one (the mechanic added work
  // while the customer was away from the tab), the box is no longer ticked and the page says the total changed
  const [agreedFor, setAgreedFor] = useState<number | null>(null);
  const agree = agreedFor != null && agreedFor === v.expected.total;
  const moved = agreedFor != null && !agree;
  const [said, setSaid] = useState<Said>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (open) titleRef.current?.focus(); }, [open]);
  if (!e) return null;
  const total = cad(v.expected.total, l);
  const bad = (text: string): Said => ({ text, kind: 'bad' });
  const send = async (drawn: Drawn | null): Promise<boolean> => {
    setSaid(null);
    setBusy(true);
    try {
      const r = await p.onSign(drawn);
      if (r.ok) return true;
      if (r.code === 'amount_changed') {
        // the box ticked said the old total: it must be ticked again for the new one
        setAgreedFor(null);
        setSaid({ text: ct(l, r.key, { total: cad(r.cents ?? v.expected.total, l) }), kind: 'warn' });
      } else setSaid(bad(ct(l, r.key)));
      return false;
    } finally { setBusy(false); }
  };
  if (!e.can_sign) {
    if (!e.signed_at) return null;
    const d = localDayOf(e.signed_at);
    return (
      <div class="cl-sign-done" data-testid="client-signed">
        <Note kind="ok">{d ? ct(l, 'sign.done', { name: e.signer || '', date: shortDate(d, l) }) : ct(l, 'sign.doneShort')}</Note>
      </div>
    );
  }
  const conditions = v.conditions && (
    <details class="cl-details">
      <summary>{ct(l, 'sign.conditions')}</summary>
      <p class="cl-cond">{v.conditions}</p>
    </details>
  );
  const saidNote = said && <Note kind={said.kind}>{said.text}</Note>;
  if (!open) {
    return (
      <div class="cl-sign cl-noprint" data-testid="client-sign">
        {e.changed && <Note kind="warn">{ct(l, 'sign.changed')}</Note>}
        <p class="cl-sub" style={{ margin: 0 }}>{ct(l, 'sign.oneLead', { garage: garageName(v.garage, l) })}</p>
        {conditions}
        {saidNote}
        <Button variant="primary" block busy={busy} icon={<PenLine />} onClick={() => send(null)} data-testid="client-sign-click">{ct(l, 'sign.oneButton')}</Button>
        <p class="cl-small cl-muted" style={{ margin: 0 }}>{ct(l, 'sign.oneNote')}{' '}
          <button type="button" class="cl-linkbtn" onClick={() => { setOpen(true); setSaid(null); }} data-testid="client-sign-open">{ct(l, 'sign.drawInstead')}</button>
        </p>
      </div>
    );
  }
  const submit = async () => {
    setSaid(null);
    if (name.trim().length < 2) { setSaid(bad(ct(l, 'sign.needName'))); return; }
    if (!hasEnoughInk(strokes)) { setSaid(bad(ct(l, 'sign.needInk'))); return; }
    if (!agree) { setSaid(bad(ct(l, 'sign.needAgree'))); return; }
    if (await send({ signer: name.trim(), strokes })) setOpen(false);
  };
  return (
    <div class="cl-sign cl-sign-open cl-noprint" data-testid="client-sign-form">
      <h3 ref={titleRef} tabIndex={-1}>{ct(l, 'sign.title')}</h3>
      <p class="cl-sub">{ct(l, 'sign.lead', { total })}</p>
      {conditions}
      <label class="cl-field">
        <span>{ct(l, 'sign.name')}</span>
        <input class="input" value={name} onInput={(x) => { setName((x.currentTarget as HTMLInputElement).value); setSaid(null); }} autoComplete="name" autoCapitalize="words" data-testid="client-sign-name" />
      </label>
      <SignaturePad strokes={strokes} onStrokes={(x) => { setStrokes(x); setSaid(null); }} label={ct(l, 'sign.padLabel')} hint={ct(l, 'sign.pad')} clearLabel={ct(l, 'sign.clear')} height={190} data-testid="client-sign-pad" />
      <label class="cl-check">
        <input type="checkbox" checked={agree} onChange={(x) => { setAgreedFor((x.currentTarget as HTMLInputElement).checked ? v.expected.total : null); setSaid(null); }} data-testid="client-sign-agree" />
        <span>{ct(l, 'sign.agree', { total })}</span>
      </label>
      {saidNote || (moved && <Note kind="warn" data-testid="client-sign-moved">{ct(l, 'sign.changedNow', { total })}</Note>)}
      <div class="cl-choice">
        <Button onClick={() => setOpen(false)} data-testid="client-sign-cancel">{ct(l, 'sign.cancel')}</Button>
        <Button variant="primary" busy={busy} onClick={submit} data-testid="client-sign-submit">{ct(l, 'sign.submit')}</Button>
      </div>
    </div>
  );
}
