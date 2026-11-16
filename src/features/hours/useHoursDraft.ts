/* The drawing on the glass window: it starts from what the truck has (its usual week; « one day »: that date's real
   hours in its column) and follows it while nothing is drawn. When the truck's hours change on the server while the
   person is drawing, the drawing stays and only what it is compared with moves. */
import { useEffect, useState } from 'preact/hooks';
import { weekToPanes, changedDays, type Panes, type Week } from './grid';

export interface Draft {
  /** what is drawn */
  draft: Panes;
  /** what the truck has now (what « Annuler les changements » goes back to) */
  base: Panes;
  /** the weekdays drawn differently from `base` */
  dirtyDays: number[];
  setDraft: (p: Panes) => void;
  /** back to what the truck has */
  reset: () => void;
}
interface St { truck: string | null; key: string; from: Panes; draft: Panes }

/** the state for this truck and these hours: another truck starts over; new hours replace an untouched drawing */
export function follow(st: St, truck: string | null, week: Week): St {
  const key = JSON.stringify(week);
  if (st.truck === truck && st.key === key) return st;
  const b = weekToPanes(week);
  if (st.truck !== truck) return { truck, key, from: b, draft: b };
  return changedDays(st.draft, st.from).length ? { ...st, key, from: b } : { truck, key, from: b, draft: b };
}

export function useHoursDraft(truckId: string | null, week: Week): Draft {
  const [st, setSt] = useState<St>(() => follow({ truck: null, key: '', from: {}, draft: {} }, truckId, week));
  // worked out while drawing, so the first picture of another truck or another date already shows its hours
  const cur = follow(st, truckId, week);
  useEffect(() => { if (cur !== st) setSt(cur); });
  return {
    draft: cur.draft,
    base: cur.from,
    dirtyDays: changedDays(cur.draft, cur.from),
    setDraft: (p) => setSt((s) => ({ ...follow(s, truckId, week), draft: p })),
    reset: () => setSt((s) => { const f = follow(s, truckId, week); return { ...f, draft: f.from }; })
  };
}
