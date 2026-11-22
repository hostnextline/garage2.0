/* « Réserver en ligne », step 2: the address, chosen in the list of places found (it gives the position), and the
   apartment. Only places on the street typed are offered. */
import { useEffect, useState } from 'preact/hooks';
import { CalendarDays, MapPin, Search } from 'lucide-preact';
import { Button } from '../../../ui/Button';
import { searchPlaces } from '../../../shared/places/places';
import { locate } from '../../../shared/places/locate';
import type { Suggestion } from '../../../shared/places/photon';
import { ct, type CLang } from '../../i18n';
import { Note } from '../../ui';
import { onTypedStreet, placeOf, type Place } from '../book-state';
import type { TitleRef } from './ServicesStep';

const MIN_CHARS = 4;
const WAIT_MS = 350;

export function AddressStep(p: { l: CLang; value: Place | null; onValue: (x: Place | null) => void; titleRef: TitleRef; msg: string | null; onNext: () => void }) {
  const { l } = p;
  const [q, setQ] = useState('');
  const [list, setList] = useState<Suggestion[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'none' | 'offline'>('idle');
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (p.value || q.trim().length < MIN_CHARS) { setList([]); setState('idle'); return; }
    // each new letter cancels the search before it (its answer would come back after the newer one)
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
    }, WAIT_MS);
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
