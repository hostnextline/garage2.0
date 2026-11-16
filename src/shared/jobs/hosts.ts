/* The questions of the job flow (« Pièces utilisées », « La voiture », the text to send by hand) are asked from anywhere
   (a promise, or a signal) and drawn by a host component. Hosts may be mounted by several places at once (the job sheet,
   « Aujourd'hui », the frame): only the first one mounted draws, so a question is never shown twice. When the last host
   goes (the person left for a screen that shows none), the question is dropped instead of popping up later, on another
   screen, for a job that is no longer in front of them. */
import { signal, type Signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';

const mounted = new Map<string, Signal<number[]>>();
let next = 0;
/** a moment to let the next screen mount its own host (a change of screen unmounts one and mounts the other): long
    enough for a screen opened for the first time, whose code is loaded meanwhile (« Aujourd'hui » → the job sheet on a
    slow phone), so the text to send by hand is not lost on the way */
export const GRACE_MS = 2500;

function listOf(name: string): Signal<number[]> {
  let s = mounted.get(name);
  if (!s) { s = signal<number[]>([]); mounted.set(name, s); }
  return s;
}
/** true for the one host of `name` that draws; `dropped` runs when no host of that name is left */
export function useHostTurn(name: string, dropped: () => void): boolean {
  const [id] = useState(() => ++next);
  const list = listOf(name);
  useEffect(() => {
    list.value = [...list.value, id];
    return () => {
      list.value = list.value.filter((x) => x !== id);
      if (!list.value.length) setTimeout(() => { if (!list.value.length) dropped(); }, GRACE_MS);
    };
  }, []);
  return list.value[0] === id;
}
