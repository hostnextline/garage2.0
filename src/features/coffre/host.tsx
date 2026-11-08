/* « Payé par le Coffre » from anywhere a payment is taken (the payment sheet of the job, of the invoice panel, of the
   invoice screen): the payment sheet closes, then this host opens the Coffre sheet of that job. Mounted once in the
   shell; the sheet's code is loaded only when it is asked for. */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { job as jobRow } from '../../data/select';
import { me } from '../../data/auth';
import type { Job } from '../../data/types';
import { whenHistorySettled } from '../../ui';

const coffreFor = signal<string | null>(null);

/** may this person put this job in the Coffre (as the server: anyone on the team, for a job that is not cancelled
    and not in the Coffre already) */
export function mayCoffre(j: Job | undefined): boolean {
  if (!j || j.coffre_id || j.status === 'cancelled' || j.status === 'no_show') return false;
  return !!me.value;
}
/** opens the Coffre sheet of this job once the sheet open now has closed */
export function openCoffre(jobId: string) { setTimeout(() => whenHistorySettled(() => { coffreFor.value = jobId; }), 0); }

type SheetComp = ComponentType<{ job: Job; open: boolean; onClose: () => void }>;
export function CoffreHost() {
  const id = coffreFor.value;
  const [Comp, setComp] = useState<SheetComp | null>(null);
  useEffect(() => {
    if (!id || Comp) return;
    void import('./CoffreSheet').then((m) => setComp(() => m.CoffreSheet as SheetComp));
  }, [id]);
  const j = jobRow(id);
  if (!id || !j || !Comp) return null;
  return <Comp job={j} open onClose={() => { coffreFor.value = null; }} />;
}
