/* The state of a customer form: the draft (changed by patches applied to the draft as it is NOW: a position found
   seconds after leaving the address no longer puts back the name or the language typed meanwhile), the errors once
   the person tried to save, and one save at a time (`saving`: while it runs, the sheet's « Annuler » and back do nothing:
   a save that waits for the position of the address must not end in a sheet the person thought they had left). */
import { useRef, useState } from 'preact/hooks';
import { checkDraft, hasErrors, type Draft, type DraftErrors } from './draft';

export function useCustomerDraft(init: () => Draft, storedPhone?: string | null) {
  const [draft, setDraft] = useState<Draft>(init);
  const [tried, setTried] = useState(false);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const errors: DraftErrors = tried ? checkDraft(draft, storedPhone) : {};
  /** marks the form as tried; true when it may be saved */
  const ready = () => { setTried(true); return !hasErrors(checkDraft(draft, storedPhone)); };
  /** runs the save once: a second tap while it runs does nothing */
  const once = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setSaving(true);
    try { return await fn(); } finally { busy.current = false; setSaving(false); }
  };
  /** a save is running now (read live, for a close asked in the same moment) */
  const isSaving = () => busy.current;
  return { draft, set, errors, tried, ready, once, saving, isSaving, bad: tried && hasErrors(errors) };
}
