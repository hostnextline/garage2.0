/* Réservations: « Départ des camions » first (where the trucks leave from: every route and arrival time is counted
   from there, it is shown on every map), then the arrival windows, the times of the 3 blocks, the real roads (Part 27:
   « Vraies routes », TomTom), how far ahead one can book and the numbers of the route estimate. Moving the start, or
   changing a number the planner counts, re-plans the coming appointments on the server (Part 17); the phone brings them
   back at once. */
import { useState } from 'preact/hooks';
import { t } from '../../../lib/i18n';
import { settings, windowsOn, roadsOn } from '../../../data/select';
import { saveSection } from '../save';
import { flush, pull } from '../../../data/sync';
import { attempt, toast } from '../../../ui';
import { useSectionDraft, SaveBar, Section } from '../SectionFrame';
import { viewOf, patchOf, check, planOf, type BookingView, type BookingErrors } from './model';
import { StartPanel } from './StartPanel';
import { WindowsPanel } from './WindowsPanel';
import { BlocksPanel } from './BlocksPanel';
import { PlanNumbers } from './PlanNumbers';
import { RoadsPanel } from './RoadsPanel';

/** what each panel of the section gets: the draft, how to change it, and the errors to show */
export interface PartProps {
  d: BookingView;
  set: (fn: (x: BookingView) => BookingView) => void;
  err: BookingErrors;
  /** clears the error of a field the person is fixing */
  clear: (k: keyof BookingErrors) => void;
  /** shows an error on a field at once (a change that cannot be taken) */
  flag: (k: keyof BookingErrors, message: string) => void;
}

/** the section's fields as stored now (also what the dot of the list compares the draft with) */
export const bookingSaved = (): BookingView => viewOf(settings.value.booking);

export function BookingSection() {
  const saved = bookingSaved();
  const winOn = windowsOn.value;
  const onRoads = roadsOn.value;
  const { draft: d, set, dirty, changes, reset } = useSectionDraft<BookingView>('booking', saved);
  const [err, setErr] = useState<BookingErrors>({});
  const clear = (k: keyof BookingErrors) => { if (err[k]) setErr((e) => ({ ...e, [k]: null })); };
  const flag = (k: keyof BookingErrors, message: string) => setErr((e) => ({ ...e, [k]: message }));
  const replan = planOf(d, onRoads) !== planOf(saved, onRoads);

  const save = async () => {
    const { errors, blocks } = check(d, { winOn, placeChanged: !!changes.place, roadsOn: onRoads });
    setErr(errors);
    if (blocks || Object.keys(errors).length) { toast(t('settings.fixErrors'), { kind: 'bad' }); return; }
    const moved = d.place.lat !== saved.place.lat || d.place.lng !== saved.place.lng;
    const b = settings.value.booking;
    const ok = await attempt(() => saveSection('booking', { ...b, ...patchOf(changes, b, winOn) }),
      { ok: replan ? t(moved ? 'settings.booking.startMoved' : 'settings.booking.replanned') : t('settings.saved') });
    if (!ok) return;
    reset();
    // the server planned the coming appointments again: bring them once the change is sent (realtime brings them too)
    if (replan) void flush().then(() => pull('jobs')).catch(() => undefined);
  };

  const parts: PartProps = { d, set, err, clear, flag };
  return (
    <Section testid="settings-booking" bar={<SaveBar dirty={dirty} onSave={save} onReset={() => { reset(); setErr({}); }} />}>
      <StartPanel {...parts} replanNote={dirty && replan} />
      <WindowsPanel {...parts} />
      {!winOn && <BlocksPanel {...parts} />}
      <RoadsPanel {...parts} />
      <PlanNumbers {...parts} roadsOn={onRoads} />
    </Section>
  );
}
