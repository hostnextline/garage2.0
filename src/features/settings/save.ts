/* One part of the settings written, as every section saves it, saying whether it only waits on this phone
   (settings-team-11): without signal the change is kept on the phone and sent when the network comes back, so the
   section says « Gardé sur le téléphone : ça part dès que le réseau revient. » (attempt() reads `queued`) instead of
   « Réglages enregistrés ». A refusal later is listed by the frame with the other refused changes, as for any change. */
import { saveSettings } from '../../data/api';
import { net } from '../../data/sync';
import type { Settings } from '../../data/types';

export type SaveAnswer = { queued: true } | undefined;

export async function saveSection(part: keyof Settings, value: unknown): Promise<SaveAnswer> {
  const r: unknown = await saveSettings(part, value);
  // a newer data layer may say it itself (R172); else: no server now means the change waits on this phone
  if (r && typeof r === 'object' && (r as { queued?: unknown }).queued === true) return { queued: true };
  return net.peek().online ? undefined : { queued: true };
}

/** several parts saved one after the other (Facturation writes billing and company): waits when any of them waits */
export function anyQueued(list: SaveAnswer[]): SaveAnswer {
  return list.some((a) => a?.queued) ? { queued: true } : undefined;
}
