/* « Réserver en ligne », step 4: the summary of the booking, the name, the mobile, the car, a note, then « Réserver ».
   A field that is not right says so under it, and the first one gets the focus. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Check } from 'lucide-preact';
import { Button } from '../../../ui/Button';
import { formatPhone } from '../../../lib/text';
import { cad, dayTitle } from '../../format';
import { ct, type CLang } from '../../i18n';
import { Note } from '../../ui';
import { chosenTotal, contactErrors, serviceName, whenWords, years, type Contact, type ContactErrors, type Place, type WebInfo, type WebSlot } from '../book-state';
import type { TitleRef } from './ServicesStep';

export function ContactStep(p: { l: CLang; info: WebInfo; ids: string[]; place: Place; slot: WebSlot; value: Contact; onValue: (c: Contact) => void; titleRef: TitleRef;
  msg: string | null; onSubmit: () => Promise<void> }) {
  const { l, info, value: c } = p;
  const [err, setErr] = useState<ContactErrors>({});
  const [tried, setTried] = useState(false);
  // counts the « Réserver » refused by the checks: the focus moves once the red words are drawn (not before)
  const [refusals, setRefusals] = useState(0);
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!refusals) return;
    const bad = box.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
    bad?.focus();
    bad?.scrollIntoView?.({ block: 'center' });
  }, [refusals]);
  const set = (k: keyof Contact) => (e: Event) => {
    const v = { ...c, [k]: (e.currentTarget as HTMLInputElement).value };
    p.onValue(v);
    if (tried) setErr(contactErrors(v));
  };
  const submit = async () => {
    setTried(true);
    const e = contactErrors(c);
    setErr(e);
    if (Object.keys(e).length) { setRefusals((n) => n + 1); return; }
    await p.onSubmit();
  };
  const sum = chosenTotal(info.services, p.ids, info.taxes);
  const field = (k: keyof Contact, label: string, extra: Record<string, unknown> = {}) => {
    const e = err[k as keyof ContactErrors];
    return (
      <label class="cl-field">
        <span>{label}</span>
        <input class="input" value={c[k]} onInput={set(k)} aria-invalid={e ? 'true' : undefined} data-testid={`book-${k}`} {...extra} />
        {e && <span class="field-error">{ct(l, `book.contact.${e}`)}</span>}
      </label>
    );
  };
  return (
    <section class="cl-panel glass" aria-labelledby="bk-t4" data-testid="book-contact" ref={box}>
      <h1 id="bk-t4" class="bk-title" ref={p.titleRef} tabIndex={-1}>{ct(l, 'book.contact.title')}</h1>
      <p class="cl-sub">{ct(l, 'book.contact.sub')}</p>
      <div class="bk-summary" data-testid="book-summary">
        <span class="cl-small cl-muted">{ct(l, 'book.contact.summary')}</span>
        <b>{dayTitle(p.slot.day, l)}</b>
        <span data-testid="book-summary-when">{whenWords(p.slot, info.blocks, l)}</span>
        {p.slot.flex && <span class="cl-small cl-muted">{ct(l, 'flexNote')}</span>}
        <span class="cl-small cl-muted">{p.place.address}{p.place.unit.trim() ? `, ${ct(l, 'book.address.unitIn', { unit: p.place.unit.trim() })}` : ''}</span>
        <span class="cl-small cl-muted">{info.services.filter((s) => p.ids.includes(s.id)).map((s) => serviceName(s, l)).join(', ')}</span>
        {sum.any && <span class="cl-small">{ct(l, 'book.services.totalIs', { amount: cad(sum.total, l) })}</span>}
      </div>
      <div class="cl-stack">
        <div class="bk-two">
          {field('first', ct(l, 'book.contact.first'), { autoComplete: 'given-name', autoCapitalize: 'words', maxLength: 80 })}
          {field('last', ct(l, 'book.contact.last'), { autoComplete: 'family-name', autoCapitalize: 'words', maxLength: 80 })}
        </div>
        {field('phone', ct(l, 'book.contact.phone'), { type: 'tel', inputMode: 'tel', autoComplete: 'tel', maxLength: 20, onBlur: () => p.onValue({ ...c, phone: formatPhone(c.phone) }) })}
        <p class="cl-small cl-muted bk-hint">{ct(l, 'book.contact.phoneHint')}</p>
        {field('email', ct(l, 'book.contact.email'), { type: 'email', inputMode: 'email', autoComplete: 'email', maxLength: 160 })}
        <fieldset class="bk-car">
          <legend>{ct(l, 'book.contact.car')}</legend>
          <div class="bk-three">
            <label class="cl-field">
              <span>{ct(l, 'book.contact.year')}</span>
              <select class="select" value={c.year} onChange={set('year')} data-testid="book-year">
                <option value="">–</option>
                {years().map((y) => <option key={y} value={String(y)}>{y}</option>)}
              </select>
            </label>
            {field('make', ct(l, 'book.contact.make'), { placeholder: ct(l, 'book.contact.makePh'), autoCapitalize: 'words', maxLength: 60 })}
            {field('model', ct(l, 'book.contact.model'), { placeholder: ct(l, 'book.contact.modelPh'), autoCapitalize: 'words', maxLength: 60 })}
          </div>
        </fieldset>
        <label class="cl-field">
          <span>{ct(l, 'book.contact.problem')}</span>
          <textarea class="textarea" rows={3} maxLength={1000} value={c.problem} placeholder={ct(l, 'book.contact.problemPh')} onInput={set('problem')} data-testid="book-problem" />
        </label>
        {/* not for people: robots fill every field. Its name means nothing to a phone's autofill (« website » did,
            and a filled trap looks like a booking that was never made) */}
        <input id="cl-bk-f" name="bk_f" class="bk-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      </div>
      {p.msg && <Note kind="bad">{p.msg}</Note>}
      <p class="cl-small cl-muted">{ct(l, 'book.contact.terms')}</p>
      <Button variant="primary" block class="bk-next" icon={<Check />} onClick={submit} data-testid="book-submit">{ct(l, 'book.contact.submit')}</Button>
    </section>
  );
}
