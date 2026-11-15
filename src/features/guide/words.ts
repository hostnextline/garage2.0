/* The guide's words in the garage's booking mode: a text that speaks of blocks has a twin under `guide.win` for a garage
   that books by arrival windows (« Plages d'arrivée »); a text with no twin is the same in both modes. */
import { t } from '../../lib/i18n';
import { windowsOn } from '../../data/select';

/** `key` starts with « guide. » */
export function gt(key: string, vars?: Record<string, string | number>, windows = windowsOn.value): string {
  if (windows) {
    const k = key.replace(/^guide\./, 'guide.win.');
    const v = t(k, vars);
    if (v !== k) return v;
  }
  return t(key, vars);
}
