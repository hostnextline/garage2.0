/* The address field's own state: the suggestions shown, the one under the arrow keys, what the hint says, the focus,
   the place chosen. One reducer, so each race is a unit test instead of a timer in a component (customers-a-26).
   The place itself (address, unit, postal code, position) is the parent's value: see addressEdit.ts. */
import type { Suggestion } from './photon';

export type Status = 'idle' | 'busy' | 'none' | 'offline';
export interface FieldState {
  items: Suggestion[];
  open: boolean;
  active: number;
  status: Status;
  focused: boolean;
  /** the suggestion chosen (or found by itself) for the address shown; exact = the door, not only the street */
  picked: Suggestion | null;
}
export const START: FieldState = { items: [], open: false, active: 0, status: 'idle', focused: false, picked: null };

export type FieldEvent =
  | { type: 'focus'; located: boolean }
  | { type: 'blur' }
  | { type: 'close' }
  | { type: 'openList' }
  | { type: 'move'; by: 1 | -1 }
  | { type: 'hover'; index: number }
  | { type: 'typed' }
  | { type: 'tooShort' }
  | { type: 'busy' }
  | { type: 'idle' }
  /** the suggestions arrived; `asked`: the person tapped « Chercher » (the list opens even without the focus) */
  | { type: 'suggestions'; places: Suggestion[]; offline: boolean; asked: boolean }
  | { type: 'picked'; s: Suggestion }
  | { type: 'located'; s: Suggestion }
  | { type: 'notLocated'; status: 'choose' | 'none' | 'offline'; choices?: Suggestion[] }
  /** the field emptied by its X, or its value replaced from outside (another customer in the booking) */
  | { type: 'reset' };

export function fieldReducer(s: FieldState, e: FieldEvent): FieldState {
  switch (e.type) {
    case 'focus': return { ...s, focused: true, open: s.items.length > 0 && !e.located ? true : s.open };
    case 'blur': return { ...s, focused: false };
    case 'close': return s.open ? { ...s, open: false } : s;
    case 'openList': return s.items.length ? { ...s, open: true } : s;
    case 'move': return s.items.length ? { ...s, active: (s.active + e.by + s.items.length) % s.items.length } : s;
    case 'hover': return { ...s, active: e.index };
    case 'typed': return s.picked ? { ...s, picked: null } : s;
    case 'tooShort': return { ...s, items: [], open: false, status: 'idle' };
    case 'busy': return { ...s, status: 'busy' };
    case 'idle': return { ...s, status: 'idle' };
    case 'suggestions':
      // never opened on a field the person has left: the list would push the fields below while they reach for
      // them, and a tap could land on a suggestion and replace the address (customers-a-07)
      return { ...s, items: e.places, active: 0, open: e.places.length > 0 && (e.asked || s.focused),
        status: e.offline ? 'offline' : e.places.length ? 'idle' : 'none' };
    case 'picked': return { ...s, picked: e.s, open: false, items: [], status: 'idle' };
    case 'located': return { ...s, picked: e.s, open: false, status: 'idle' };
    case 'notLocated':
      if (e.status === 'choose') return { ...s, items: e.choices || [], active: 0, status: 'idle' };
      return { ...s, status: e.status === 'offline' ? 'offline' : s.items.length ? 'idle' : 'none' };
    case 'reset': return { ...START, focused: s.focused };
  }
}
