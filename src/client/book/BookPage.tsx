/* client.html#reserver: « Réserver en ligne ». Anyone books an appointment in 4 steps, one question per screen:
   1. the services   2. the address (chosen in the list: it gives the position)   3. one of the best moments (where a
   truck already goes nearby, soonest; « Voir d'autres dates » for the next two weeks)   4. name, phone, car → « Réserver ».
   Then: booked, a confirmation text, the button to the customer's own page.
   « Plages d’arrivée » (info.windows): step 3 offers days with their 4-hour window (« Jeudi 19 novembre, entre 9 h et 13 h »),
   « Voir d’autres heures » when a day has several, and « Je suis disponible toute la journée » (the window is confirmed
   the day before). This file holds what is chosen and talks to the server; each step draws itself (steps/). */
import { useEffect, useRef, useState } from 'preact/hooks';
import { ArrowLeft, CalendarX } from 'lucide-preact';
import { Button } from '../../ui/Button';
import { attemptCall, callBook, type ClientError, type Garage } from '../api';
import { ct, pickLang, type CLang } from '../i18n';
import { replaceHash, rememberGarage, recallGarage } from '../link';
import { CallUs, ErrorState, Footer, Header, Skeleton, garageName } from '../ui';
import { STEPS, stepNumber, stepOfError, errorKey, EMPTY_CONTACT, bookWhen, type Step, type WebInfo, type WebSlot, type Contact, type Booked, type Place } from './book-state';
import { AddressStep } from './steps/AddressStep';
import { ContactStep } from './steps/ContactStep';
import { DoneStep } from './steps/DoneStep';
import { ServicesStep } from './steps/ServicesStep';
import { SlotsStep } from './steps/SlotsStep';

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
  const alive = useRef(true);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const garage: Garage | null = info?.garage || recallGarage();

  const load = async () => {
    setLoadErr(null);
    const r = await attemptCall(() => callBook<WebInfo>('info'));
    if (!alive.current) return;
    if (r.ok) { setInfo(r.value); rememberGarage(r.value.garage); } else setLoadErr(r.error.code);
  };
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; if (focusTimer.current) clearTimeout(focusTimer.current); };
  }, []);
  useEffect(() => {
    document.documentElement.lang = l === 'en' ? 'en-CA' : 'fr-CA';
    document.title = `${ct(l, 'book.title')} – ${garageName(garage, l)}`;
  }, [l, garage?.name]);

  const go = (s: Step) => {
    setStep(s);
    setMsg(null);
    window.scrollTo({ top: 0 });
    // the new step's title takes the focus once it is drawn (a screen reader reads where the customer is)
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => top.current?.focus(), 30);
  };
  const back = () => { const i = STEPS.indexOf(step); if (i > 0) go(STEPS[i - 1]); };
  const onLang = () => { const n: CLang = l === 'en' ? 'fr' : 'en'; setL(n); replaceHash(n === 'en' ? '#reserver&l=en' : '#reserver'); };
  /** a refusal of the server: back to the step to fix, with its words */
  const refused = (e: ClientError) => {
    const to = stepOfError(e.code);
    if (to === 'slots') setSlot(null);
    if (to && to !== step) go(to);
    setMsg(ct(l, errorKey(e.code)));
  };

  const book = async () => {
    if (!place || !slot) return;
    setMsg(null);
    const r = await attemptCall(() => callBook<Booked>('book', {
      lang: l, services: ids, ...bookWhen(slot),
      first_name: contact.first.trim(), last_name: contact.last.trim(), phone: contact.phone, email: contact.email.trim(),
      address: place.address, unit: place.unit.trim(), postal_code: place.postal_code, city: place.city, lat: place.lat, lng: place.lng,
      vehicle: { year: contact.year || null, make: contact.make.trim(), model: contact.model.trim() }, problem: contact.problem.trim(),
      extra: (document.getElementById('cl-bk-f') as HTMLInputElement | null)?.value || ''
    }));
    if (!alive.current) return;
    if (!r.ok) { refused(r.error); return; }
    setDone(r.value);
    go('done');
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
  else if (step === 'done' && done) body = <DoneStep l={l} done={done} slot={slot} info={info} phone={contact.phone} garage={garage} onAgain={() => { setDone(null); setSlot(null); setIds([]); go('services'); }} />;
  else {
    body = (
      <>
        <div class="cl-hero">
          <p class="cl-eyebrow" data-testid="book-step">{ct(l, 'book.step', { n: stepNumber(step) })}</p>
          <div class="bk-progress" aria-hidden="true">{STEPS.map((s, i) => <span key={s} class={i < stepNumber(step) ? 'is-on' : ''} />)}</div>
        </div>
        {step === 'services' && <ServicesStep l={l} info={info} ids={ids} onIds={(x) => { setIds(x); setSlot(null); setMsg(null); }} titleRef={top} msg={msg} onNext={() => (ids.length ? go(place ? 'slots' : 'address') : setMsg(ct(l, 'book.services.none')))} />}
        {step === 'address' && <AddressStep l={l} value={place} onValue={(x) => { setPlace(x); setSlot(null); setMsg(null); }} titleRef={top} msg={msg} onNext={() => go('slots')} />}
        {step === 'slots' && place && <SlotsStep l={l} info={info} ids={ids} place={place} value={slot} onPick={(x) => { setSlot(x); go('contact'); }} titleRef={top} msg={msg} garage={garage} onRefused={refused} />}
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
