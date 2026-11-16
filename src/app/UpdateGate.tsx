/* « Mets l'app à jour »: this version is older than the oldest one the garage still accepts (version.json). One screen,
   one button; the changes waiting on the phone are kept and go out with the new version. */
import { ArrowUpCircle } from 'lucide-preact';
import { t } from '../lib/i18n';
import { Button } from '../ui';
import { applyUpdate } from '../shared/app/pwa';

export function UpdateGate() {
  return (
    <div class="gate" data-testid="update-gate">
      <div class="gate-panel glass-strong">
        <img class="gate-logo" src="./logo-his.png" alt="" width="88" height="88" />
        <h1>{t('shell.update.tooOld')}</h1>
        <p class="gate-lead">{t('shell.update.tooOldLead')}</p>
        <Button variant="primary" block icon={<ArrowUpCircle size={20} />} onClick={applyUpdate} data-testid="update-gate-apply">{t('shell.update.apply')}</Button>
      </div>
    </div>
  );
}
