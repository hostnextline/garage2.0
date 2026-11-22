/* The address field's work over time: suggestions 300 ms after the last key, the position looked up when the person
   leaves the field, the search again when the signal comes back. The rules are pure (addressEdit.ts, addressState.ts);
   this hook only runs them.

   Two things make it safe with slow answers:
   - every answer is put on the LATEST value with the LATEST onValue: an answer arriving seconds after the blur no
     longer hands the parent the draft of the blur's render, which erased what was typed meanwhile (customers-a-01);
   - the suggestions and the lookup have their own run numbers, and leaving the field cancels the pending suggestions,
     so a late list neither drops the lookup's position nor opens on a field that was left (customers-a-07). */
import { useEffect, useReducer, useRef } from 'preact/hooks';
import { searchPlaces } from './places';
import { locate } from './locate';
import { EMPTY_PLACE, type PlaceValue } from './place';
import type { Suggestion } from './photon';
import { fieldReducer, START, type FieldState } from './addressState';
import { typed, pasted, picked, left, located, searchable } from './addressEdit';

export function useAddressField(value: PlaceValue, onValue: (v: PlaceValue) => void) {
  const v: PlaceValue = { ...EMPTY_PLACE, ...(value || {}) };
  const [st, dispatch] = useReducer(fieldReducer, START);
  const stRef = useRef<FieldState>(st);
  stRef.current = st;
  const vRef = useRef(v);
  vRef.current = v;
  const onValueRef = useRef(onValue);
  onValueRef.current = onValue;
  /** the address the field itself wrote last: another one coming in means the value was replaced from outside */
  const mine = useRef(v.address);
  /** the address the unit and postal code were written for (addressEdit.ts) */
  const anchor = useRef(v.address);
  /** the person typed since the last choice (only then are suggestions asked as the text changes) */
  const typing = useRef(false);
  const searchRun = useRef(0);
  const locateRun = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emit = (next: PlaceValue) => {
    mine.current = next.address;
    vRef.current = next;
    onValueRef.current(next);
  };
  const stopSearch = () => {
    if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null; }
    searchRun.current++;
  };

  // the value replaced from outside (the booking's customer changed, a form put back): what the field knew is about
  // another address (customers-a-19)
  useEffect(() => {
    if (v.address === mine.current) return;
    mine.current = v.address;
    anchor.current = v.address;
    typing.current = false;
    stopSearch();
    locateRun.current++;
    dispatch({ type: 'reset' });
  }, [v.address]);

  const search = async (text: string, asked: boolean) => {
    const n = ++searchRun.current;
    dispatch({ type: 'busy' });
    const r = await searchPlaces(text);
    if (n !== searchRun.current) return;
    // `partial`: TomTom answered, Photon did not (review-places R6): the network works, so not « Pas de réseau »
    dispatch({ type: 'suggestions', places: r.places, offline: !!r.error && !r.partial, asked });
  };
  // suggestions as you type, 300 ms after the last key
  useEffect(() => {
    if (!typing.current) return;
    const text = v.address.trim();
    if (!searchable(text)) { stopSearch(); dispatch({ type: 'tooShort' }); return; }
    searchTimer.current = setTimeout(() => { searchTimer.current = null; void search(text, false); }, 300);
    return () => { if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null; } };
  }, [v.address]);

  // the signal is back while the address has no position: search again
  useEffect(() => {
    const on = () => {
      const cur = vRef.current;
      if (stRef.current.status === 'offline' && cur.address.trim() && cur.lat == null) void search(cur.address, false);
    };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    searchRun.current++;
    locateRun.current++;
  }, []);

  // the person leaves the field without choosing: the position is taken when one place fits what was typed (the same
  // door, street and town); the address stays as typed. Otherwise the suggestions wait for a choice.
  const autoLocate = async () => {
    const cur = vRef.current;
    const text = cur.address.trim();
    if (!text || cur.lat != null || !searchable(text)) return;
    const n = ++locateRun.current;
    dispatch({ type: 'busy' });
    const r = await locate(text, { postal: cur.postal_code });
    if (n !== locateRun.current) return;
    const now = vRef.current;
    if (now.address.trim() !== text || now.lat != null) { dispatch({ type: 'idle' }); return; }
    if (r.status === 'found') {
      typing.current = false;
      dispatch({ type: 'located', s: { ...r.place, exact: r.quality === 'door' } });
      anchor.current = now.address;
      emit(located(now, r.place));
    } else {
      // Photon down while TomTom works (`partial`): « not found now », never « Pas de réseau » (review-places R6)
      const status = r.status === 'offline' && r.partial ? 'none' : r.status;
      dispatch({ type: 'notLocated', status, choices: r.status === 'choose' ? r.choices : undefined });
    }
  };

  const startTyping = () => {
    typing.current = true;
    locateRun.current++;
    dispatch({ type: 'typed' });
  };

  return {
    v, st,
    pick(s: Suggestion) {
      typing.current = false;
      stopSearch();
      locateRun.current++;
      dispatch({ type: 'picked', s });
      const next = picked(vRef.current, s, anchor.current);
      anchor.current = next.address;
      emit(next);
    },
    type(text: string) { startTyping(); emit(typed(vRef.current, text)); },
    paste(text: string) {
      startTyping();
      const next = pasted(vRef.current, text, anchor.current);
      anchor.current = next.address;
      emit(next);
    },
    focus() {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      dispatch({ type: 'focus', located: vRef.current.lat != null && vRef.current.lng != null });
    },
    blur() {
      dispatch({ type: 'blur' });
      closeTimer.current = setTimeout(() => { closeTimer.current = null; dispatch({ type: 'close' }); }, 120);
      stopSearch();
      const cur = vRef.current;
      const afterChoice = !!stRef.current.picked;
      const next = left(cur, anchor.current, afterChoice);
      if (next !== cur) { anchor.current = next.address; emit(next); }
      else if (!afterChoice) anchor.current = cur.address;
      if (!afterChoice) void autoLocate();
    },
    /** « Chercher »: the suggestions for the address as it is, shown even though the field is not focused */
    find() { typing.current = false; void search(vRef.current.address, true); },
    clear() {
      typing.current = false;
      stopSearch();
      locateRun.current++;
      dispatch({ type: 'reset' });
      anchor.current = '';
      emit({ ...EMPTY_PLACE });
    },
    /** the unit or postal code typed in its own box: written for the address shown now */
    detail(patch: Partial<PlaceValue>) {
      anchor.current = vRef.current.address;
      emit({ ...vRef.current, ...patch });
    },
    dispatch
  };
}
