/* client.html#reserver: « Réserver en ligne ». Anyone books an appointment in 4 steps, one question per screen:
   1. the services   2. the address (chosen in the list: it gives the position)   3. one of the best moments (where a
   truck already goes nearby, soonest; « Voir d'autres dates » for the next two weeks)   4. name, phone, car → « Réserver ».
   Then: booked, a confirmation text, the button to the customer's own page. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { ArrowLeft, Check, MapPin, Search, CalendarDays, Sparkles, CircleCheck, Users, CalendarX } from 'lucide-preact';
import { Button } from '../ui/Button';
import { callBook, ClientError, type Garage } from './api';
import { ct, pickLang, type CLang } from './i18n';
import { cad, dayTitle, relDay, slotText } from './format';
import { replaceHash, rememberGarage, recallGarage } from './link';
import { Header, Footer, Note, Skeleton, CallUs, garageName } from './ui';
import { duration, shortDate, longDay, today } from '../lib/dates';
import { formatPhone } from '../lib/text';
import { searchPlaces } from '../features/customers/places';
import { locate } from '../features/customers/locate';
import type { Suggestion } from '../features/customers/photon';
import { ErrorState } from './ViewPage';
import {
  STEPS, stepNumber, serviceName, chosenTotal, toggle, contactErrors, years, stepOfError, errorKey, nextFrom, mergeSlots,
  onTypedStreet, EMPTY_CONTACT, type Step, type WebInfo, type WebSlot, type Contact, type ContactErrors, type Booked
} from './book-state';

interface Place { address: string; unit: string; postal_code: string | null; city: string | null; lat: number; lng: number; exact: boolean }
const PAGE_DAYS = 14;

export function BookPage(p: { linkLang: CLang | null }) {
  const [l, setL] = useState<CLang>(() => pickLang(p.linkLang, null));
  const [info, setInfo] = useState<WebInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('services');
  const [ids, setIds] = useState<string[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [slot, setSlot] = useState<WebSlot | null>(null);
  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT);
  const [done, setDone] = useState<Booked | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const top = useRef<HTMLHeadingElement>(null);
  const garage: Garage | null = info?.garage || recallGarage();

  const load = async () => {
    setLoadErr(null);
    try { const v = await callBook<WebInfo>('info'); setInfo(v); rememberGarage(v.garage); }
    catch (e) { setLoadErr(e instanceof ClientError ? e.code : 'server'); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA';
    document.title = `${ct(l, 'book.title')} – ${garageName(garage, l)}`;
  }, [l, garage?.name]);

  const go = (s: Step) => { setStep(s); setMsg(null); window.scrollTo({ top: 0 }); setTimeout(() => top.current?.focus(), 30); };
  const back = () => { const i = STEPS.indexOf(step); if (i > 0) go(STEPS[i - 1]); };
  const onLang = () => { const n: CLang = l === 'en' ? 'fr' : 'en'; setL(n); replaceHash(n === 'en' ? '#reserver&l=en' : '#reserver'); };
  const refused = (e: unknown) => {
    const code = e instanceof ClientError ? e.code : 'server';
    const to = stepOfError(code);
    if (to === 'slots') setSlot(null);
    if (to && to !== step) go(to);
    setMsg(ct(l, errorKey(code)));
  };

  const book = async () => {
    if (!place || !slot) return;
    setMsg(null);
    try {
      const r = await callBook<Booked>('book', {
        lang: l, services: ids, day: slot.day, block: slot.block,
        first_name: contact.first.trim(), last_name: contact.last.trim(), phone: contact.phone, email: contact.email.trim(),
        address: place.address, unit: place.unit.trim(), postal_code: place.postal_code, city: place.city, lat: place.lat, lng: place.lng,
        vehicle: { year: contact.year || null, make: contact.make.trim(), model: contact.model.trim() }, problem: contact.problem.trim(),
        extra: (document.getElementById('cl-bk-f') as HTMLInputElement | null)?.value || ''
      });
      setDone(r);
      go('done');
    } catch (e) { refused(e); }
  };

  let body;
  if (loadErr) body = <ErrorState code={loadErr === 'network' ? 'network' : 'server'} l={l} garage={garage} onRetry={() => void load()} />;
  else if (!info) body = <Skeleton l={l} />;
  else if (!info.on) body = (
    <section class="cl-panel glass cl-state" data-testid="book-closed">
      <span class="cl-state-icon" aria-hidden="true"><CalendarX /></span>
      <h1>{ct(l, 'book.closed.title')}</h1>
      <p>{ct(l, 'book.closed.text')}</p>
      <CallUs garage={garage} l={l} />
    </section>
  );
  else if (step === 'done' && done) body = <Done l={l} done={done} info={info} phone={contact.phone} onAgain={() => { setDone(null); setSlot(null); setIds([]); go('services'); }} />;
  else {
    body = (
      <>
        <div class="cl-hero">
          <p class="cl-eyebrow" data-testid="book-step">{ct(l, 'book.step', { n: stepNumber(step) })}</p>
          <div class="bk-progress" aria-hidden="true">{STEPS.map((s, i) => <span key={s} class={i < stepNumber(step) ? 'is-on' : ''} />)}</div>
        </div>
        {step === 'services' && <Services l={l} info={info} ids={ids} onIds={(x) => { setIds(x); setSlot(null); setMsg(null); }} titleRef={top} msg={msg} onNext={() => (ids.length ? go(place ? 'slots' : 'address') : setMsg(ct(l, 'book.services.none')))} />}
        {step === 'address' && <Address l={l} value={place} onValue={(x) => { setPlace(x); setSlot(null); setMsg(null); }} titleRef={top} msg={msg} onNext={() => go('slots')} />}
        {step === 'slots' && place && <Slots l={l} info={info} ids={ids} place={place} value={slot} onPick={(x) => { setSlot(x); go('contact'); }} titleRef={top} msg={msg} garage={garage} onRefused={refused} />}
        {step === 'contact' && place && slot && <ContactStep l={l} info={info} ids={ids} place={place} slot={slot} value={contact} onValue={setContact} titleRef={top} msg={msg} onSubmit={book} />}
        {step !== 'services' && <Button variant="ghost" icon={<ArrowLeft />} onClick={back} class="bk-back" data-testid="book-back">{ct(l, 'book.back')}</Button>}
      </>
    );
  }
  return (
    <div class="cl">
      <Header garage={garage} l={l} />
      <main class="cl-wrap cl-main" id="main" data-testid="book-page">{body}</main>
      <Footer garage={garage} l={l} onLang={onLang} />
    </div>
  );
}

type Ref = { current: HTMLHeadingElement | null };

/* ---------- 1. the services ---------- */
function Services(p: { l: CLang; info: WebInfo; ids: string[]; onIds: (x: string[]) => void; titleRef: Ref; msg: string | null; onNext: () => void }) {
  const { l, info } = p;
  const sum = chosenTotal(info.services, p.ids, info.taxes);
  return (
    <section class="cl-panel glass" aria-labelledby="bk-t1" data-testid="book-services">
      <h1 id="bk-t1" class="bk-title" ref={p.titleRef} tabIndex={-1}>{ct(l, 'book.services.title')}</h1>
      <p class="cl-sub">{ct(l, 'book.services.sub')}</p>
      <ul class="bk-svcs">
        {info.services.map((s) => {
          const on = p.ids.includes(s.id);
          const inc = (s.includes || []).map((x) => (l === 'en' ? x.en || x.fr : x.fr || x.en)).filter(Boolean);
          return (
            <li key={s.id}>
              <button type="button" class={`bk-svc${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => p.onIds(toggle(p.ids, s.id))} data-testid="book-svc">
                <span class="bk-tick" aria-hidden="true">{on && <Check />}</span>
                <span class="bk-svc-main">
                  <span class="bk-svc-name">{s.promo && <span class="bk-promo">{ct(l, 'book.services.promo')}</span>}{serviceName(s, l)}</span>
                  {inc.length > 0 && <span class="bk-svc-inc">{inc.join(', ')}</span>}
                  <span class="bk-svc-meta">{ct(l, 'book.services.about', { time: duration(s.duration_min, l) })}</span>
                  {s.promo && s.promo_until && <span class="bk-svc-meta">{ct(l, 'book.services.until', { date: shortDate(s.promo_until, l) })}</span>}
                </span>
                <span class="bk-svc-price">{s.price_cents == null ? <span class="cl-muted cl-small">{ct(l, 'book.services.toConfirm')}</span> : cad(s.price_cents, l)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {p.ids.length > 0 && (
        <div class="cl-total" data-testid="book-total">
          <div>
            <div class="cl-total-label">{ct(l, 'book.services.chosen', { n: p.ids.length })}</div>
            {sum.any && <div class="cl-small cl-muted">{ct(l, 'book.services.total')}{info.taxes ? `, ${ct(l, 'book.services.totalTaxes')}` : ''}{sum.hourly ? `, ${ct(l, 'book.services.plusHourly')}` : ''}</div>}
          </div>
          {sum.any && <div class="cl-total-amt">{cad(sum.total, l)}</div>}
        </div>
      )}
      {p.msg && <Note kind="warn">{p.msg}</Note>}
      <Button variant="primary" block class="bk-next" onClick={p.onNext} data-testid="book-next">{ct(l, 'book.next')}</Button>
    </section>
  );
}

/* ---------- 2. the address ---------- */
function placeOf(s: Suggestion): Place | null {
  if (s.place.lat == null || s.place.lng == null) return null;
  return { address: [s.label, s.sub].filter(Boolean).join(', '), unit: s.place.unit || '', postal_code: s.place.postal_code, city: s.place.city ?? null,
    lat: s.place.lat, lng: s.place.lng, exact: s.exact };
}
function Address(p: { l: CLang; value: Place | null; onValue: (x: Place | null) => void; titleRef: Ref; msg: string | null; onNext: () => void }) {
  const { l } = p;
  const [q, setQ] = useState('');
  const [list, setList] = useState<Suggestion[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'none' | 'offline'>('idle');
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (p.value || q.trim().length < 4) { setList([]); setState('idle'); return; }
    const ctl = new AbortController();
    setState('searching');
    const t = setTimeout(async () => {
      const r = await searchPlaces(q, ctl.signal);
      if (ctl.signal.aborted) return;
      let ok = onTypedStreet(r.places, q);
      // nothing on that street: ask again the careful way (short words written out, without the town)
      if (!ok.length && !r.error) {
        const x = await locate(q);
        if (ctl.signal.aborted) return;
        ok = onTypedStreet(x.status === 'found' ? [x.place] : x.status === 'choose' ? x.choices : [], q);
      }
      setList(ok);
      setState(r.error === 'offline' ? 'offline' : ok.length ? 'idle' : 'none');
    }, 350);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [q, p.value]);
  return (
    <section class="cl-panel glass" aria-labelledby="bk-t2" data-testid="book-address">
      <h1 id="bk-t2" class="bk-title" ref={p.titleRef} tabIndex={-1}>{ct(l, 'book.address.title')}</h1>
      <p class="cl-sub">{ct(l, 'book.address.sub')}</p>
      {p.value ? (
        <div class="cl-stack">
          <div class="bk-place" data-testid="book-place">
            <MapPin aria-hidden="true" />
            <div class="grow"><span class="cl-small cl-muted">{ct(l, 'book.address.chosen')}</span><b>{p.value.address}</b></div>
            <Button variant="ghost" size="sm" onClick={() => { setQ(p.value!.address.split(',')[0]); p.onValue(null); }} data-testid="book-place-change">{ct(l, 'book.address.change')}</Button>
          </div>
          {!p.value.exact && <Note kind="info">{ct(l, 'book.address.street')}</Note>}
          <label class="cl-field">
            <span>{ct(l, 'book.address.unit')}</span>
            <input class="input" value={p.value.unit} maxLength={20} onInput={(e) => p.onValue({ ...p.value!, unit: (e.currentTarget as HTMLInputElement).value })} autoComplete="address-line2" data-testid="book-unit" />
          </label>
        </div>
      ) : (
        <div class="cl-stack">
          <label class="cl-field">
            <span>{ct(l, 'book.address.label')}</span>
            <span class="bk-search">
              <Search aria-hidden="true" />
              <input class="input" value={q} placeholder={ct(l, 'book.address.placeholder')} autoComplete="street-address" enterKeyHint="search"
                onInput={(e) => { setQ((e.currentTarget as HTMLInputElement).value); setHint(false); }} aria-describedby="bk-addr-state" data-testid="book-address-input" />
            </span>
          </label>
          <div id="bk-addr-state" role="status" class="cl-small cl-muted">
            {state === 'searching' && ct(l, 'book.address.searching')}
            {state === 'none' && ct(l, 'book.address.nothing')}
            {state === 'offline' && ct(l, 'book.address.offline')}
          </div>
          {list.length > 0 && (
            <ul class="bk-sugg" data-testid="book-suggestions">
              {list.map((s) => (
                <li key={s.key}>
                  <button type="button" onClick={() => { const v = placeOf(s); if (v) p.onValue(v); }} data-testid="book-suggestion">
                    <MapPin aria-hidden="true" /><span><b>{s.label}</b><span class="cl-small cl-muted">{s.sub}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {hint && <Note kind="warn">{ct(l, 'book.address.pick')}</Note>}
        </div>
      )}
      {p.msg && <Note kind="bad">{p.msg}</Note>}
      <Button variant="primary" block class="bk-next" icon={<CalendarDays />} onClick={() => (p.value ? p.onNext() : setHint(true))} data-testid="book-next">{ct(l, 'book.address.seeDates')}</Button>
    </section>
  );
}

/* ---------- 3. the moments ---------- */
function Slots(p: { l: CLang; info: WebInfo; ids: string[]; place: Place; value: WebSlot | null; onPick: (s: WebSlot) => void; titleRef: Ref; msg: string | null;
  garage: Garage | null; onRefused: (e: unknown) => void }) {
  const { l, info } = p;
  const [slots, setSlots] = useState<WebSlot[] | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [end, setEnd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ask = async (f: string | null) => {
    setBusy(true); setErr(null);
    try {
      const r = await callBook<{ from: string | null; days: number; slots: WebSlot[] }>('slots', { lat: p.place.lat, lng: p.place.lng, services: p.ids, from: f, days: PAGE_DAYS });
      setSlots((cur) => (f && cur ? mergeSlots(cur, r.slots) : r.slots));
      // the next page starts after the days asked (from today when f is null)
      const start = f || today();
      const nf = nextFrom(start, PAGE_DAYS);
      setFrom(nf);
      if (f && !r.slots.length) setEnd(true);
    } catch (e) {
      const code = e instanceof ClientError ? e.code : 'server';
      if (code === 'network' || code === 'server') setErr(ct(l, errorKey(code))); else p.onRefused(e);
      if (!f) setSlots((cur) => cur || []);
    } finally { setBusy(false); }
  };
  useEffect(() => { void ask(null); }, []);
  const blockOf = (k: string) => info.blocks.find((b) => b.key === k);
  return (
    <section class="cl-panel glass" aria-labelledby="bk-t3" data-testid="book-slots">
      <h1 id="bk-t3" class="bk-title" ref={p.titleRef} tabIndex={-1}>{ct(l, 'book.slots.title')}</h1>
      <p class="cl-sub">{ct(l, 'book.slots.sub')}</p>
      {p.msg && <Note kind="warn">{p.msg}</Note>}
      {slots === null ? <p class="cl-muted" role="status">{ct(l, 'book.slots.loading')}</p> : (
        <>
          {slots.length === 0 && !busy && <div class="cl-stack"><Note kind="info">{ct(l, from && !end ? 'book.slots.none' : 'book.slots.noneMore')}</Note></div>}
          <ul class="bk-slots">
            {slots.map((s, i) => {
              const b = blockOf(s.block);
              const rel = relDay(s.day);
              return (
                <li key={`${s.day}-${s.block}`}>
                  <button type="button" class={`bk-slot${i === 0 ? ' is-best' : ''}`} onClick={() => p.onPick(s)} data-testid="book-slot">
                    <span class="bk-slot-main">
                      {i === 0 && <span class="bk-best"><Sparkles aria-hidden="true" />{ct(l, 'book.slots.best')}</span>}
                      <b>{rel ? `${ct(l, rel)}, ${longDay(s.day, l)}` : dayTitle(s.day, l)}</b>
                      <span>{ct(l, `blocks.${s.block}`)}</span>
                      {b && <span class="cl-small cl-muted">{slotText(b.start, b.end, l)}</span>}
                      {s.near && <span class="bk-near"><Users aria-hidden="true" />{ct(l, 'book.slots.near')}</span>}
                    </span>
                    <span class="bk-slot-go" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {err && <Note kind="bad">{err}</Note>}
          {end && slots.length > 0 && <Note kind="info">{ct(l, 'book.slots.noneMore')}</Note>}
          {(end || (slots.length === 0 && !busy)) && <CallUs garage={p.garage} l={l} primary={false} />}
          {!end && from && <Button block busy={busy} onClick={() => ask(from)} data-testid="book-more">{ct(l, 'book.slots.more')}</Button>}
        </>
      )}
    </section>
  );
}

/* ---------- 4. who, and the car ---------- */
function ContactStep(p: { l: CLang; info: WebInfo; ids: string[]; place: Place; slot: WebSlot; value: Contact; onValue: (c: Contact) => void; titleRef: Ref;
  msg: string | null; onSubmit: () => Promise<void> }) {
  const { l, info, value: c } = p;
  const [err, setErr] = useState<ContactErrors>({});
  const [tried, setTried] = useState(false);
  const set = (k: keyof Contact) => (e: Event) => {
    const v = { ...c, [k]: (e.currentTarget as HTMLInputElement).value };
    p.onValue(v);
    if (tried) setErr(contactErrors(v));
  };
  const submit = async () => {
    setTried(true);
    const e = contactErrors(c);
    setErr(e);
    if (Object.keys(e).length) { document.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus(); return; }
    await p.onSubmit();
  };
  const b = info.blocks.find((x) => x.key === p.slot.block);
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
    <section class="cl-panel glass" aria-labelledby="bk-t4" data-testid="book-contact">
      <h1 id="bk-t4" class="bk-title" ref={p.titleRef} tabIndex={-1}>{ct(l, 'book.contact.title')}</h1>
      <p class="cl-sub">{ct(l, 'book.contact.sub')}</p>
      <div class="bk-summary" data-testid="book-summary">
        <span class="cl-small cl-muted">{ct(l, 'book.contact.summary')}</span>
        <b>{dayTitle(p.slot.day, l)}</b>
        <span>{b ? slotText(b.start, b.end, l) : ct(l, `blocks.${p.slot.block}`)}</span>
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

/* ---------- booked ---------- */
function Done(p: { l: CLang; done: Booked; info: WebInfo; phone: string; onAgain: () => void }) {
  const { l, done } = p;
  const b = p.info.blocks.find((x) => x.key === done.block);
  const rel = relDay(done.day);
  const day = rel ? ct(l, rel).toLowerCase() : longDay(done.day, l);
  const sent = done.text === 'sent';
  return (
    <section class="cl-panel glass cl-state" data-testid="book-done">
      <span class="cl-state-icon is-ok" aria-hidden="true"><CircleCheck /></span>
      <h1>{ct(l, 'book.done.title')}</h1>
      <p class="bk-done-when">{ct(l, 'book.done.lead', { day, slot: (b ? slotText(b.start, b.end, l) : ct(l, `blocks.${done.block}`))?.toLowerCase() })}</p>
      <p>{sent ? ct(l, 'book.done.text', { phone: formatPhone(p.phone).replace(/ /g, '\u00a0') }) : ct(l, 'book.done.noText')}</p>
      {done.link && <Button variant="primary" block href={done.link} data-testid="book-see">{ct(l, 'book.done.see')}</Button>}
      <Button variant="ghost" block onClick={p.onAgain} data-testid="book-again">{ct(l, 'book.done.again')}</Button>
    </section>
  );
}
