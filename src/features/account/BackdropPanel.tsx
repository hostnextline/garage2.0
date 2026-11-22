import { useRef, useState } from 'preact/hooks';
import { ImageUp, RotateCcw } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { myPhoto, setMyPhoto, shrinkPhoto } from '../../services/backdrop';
import { HIS_NIGHT, HIS_DAY } from '../../ui/backdrops';
import { Panel, Button, toast } from '../../ui';

/* what is behind the glass: the H.I.S picture (the road at night, the showroom by day), or my own photo (this device) */
export function BackdropPanel() {
  const photo = myPhoto.value;
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const url = await shrinkPhoto(f);
      if (setMyPhoto(url)) toast(t('account.backdrop.saved'), { kind: 'ok' });
      else toast(t('account.backdrop.full'), { kind: 'bad' });
    } catch {
      toast(t('account.backdrop.failed'), { kind: 'bad' });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };
  return (
    <Panel title={t('account.backdrop.title')} help={t('account.backdrop.help')} data-testid="account-backdrop">
      <div class="stack">
        <div class={`account-backdrop${photo ? ' is-mine' : ''}`} aria-hidden="true" data-testid="backdrop-preview"
          style={photo ? { backgroundImage: `url("${photo}")` } : { '--day': `url("${HIS_DAY}")`, '--night': `url("${HIS_NIGHT}")` }}>
          {!photo && <><span class="account-backdrop-day" /><span class="account-backdrop-night" /></>}
        </div>
        <p class="small muted" style={{ margin: 0 }}>{photo ? t('account.backdrop.mine') : t('account.backdrop.his')}</p>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void pick((e.currentTarget as HTMLInputElement).files?.[0])} data-testid="backdrop-file" />
        <div class="row-wrap">
          <Button icon={<ImageUp size={18} />} busy={busy} onClick={() => file.current?.click()} data-testid="backdrop-choose">
            {photo ? t('account.backdrop.change') : t('account.backdrop.choose')}
          </Button>
          {photo && (
            <Button variant="ghost" icon={<RotateCcw size={18} />} onClick={() => { setMyPhoto(null); toast(t('account.backdrop.removed')); }} data-testid="backdrop-reset">
              {t('account.backdrop.reset')}
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
