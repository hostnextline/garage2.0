/* « Scanner le NIV »: the barcode of the door-jamb sticker live in the camera, or a photo of the printed VIN.
   A sure reading is given back at once; a doubtful one is shown (« NIV lu : … ») and given back only when the person
   taps « Garder ce NIV »: the screens that receive it save it as it is. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Flashlight, FlashlightOff, Check, Camera } from 'lucide-preact';
import { t } from '../../lib/i18n';
import type { VinDoubt } from '../../domain/vehicles/vinRead';
import { Button, Sheet, Banner, Spinner } from '../../ui';
import { readVinPhoto, ReaderUnavailable, type VinReading } from './vinScan';
import { useVinCamera } from './useVinCamera';
import '../places/customers.css';

type PhotoState = 'idle' | 'reading' | 'notfound' | 'noreader';

export function VinScanSheet(p: { onClose: () => void; onVin: (vin: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const reading = useRef<VinReading | null>(null);
  const onVin = useRef(p.onVin);
  onVin.current = p.onVin;
  const done = useRef(false);
  const [photoState, setPhotoState] = useState<PhotoState>('idle');
  const [doubtful, setDoubtful] = useState<{ vin: string; why: VinDoubt } | null>(null);
  const [progress, setProgress] = useState(0);

  /** a VIN given back once (a second frame or a late photo answer must not save it twice) */
  const give = (vin: string) => {
    if (done.current) return;
    done.current = true;
    try { navigator.vibrate?.(60); } catch { /* a phone without vibration: nothing to feel */ }
    onVin.current(vin);
  };
  // a photo still being read when the sheet goes: its worker is stopped
  useEffect(() => () => { reading.current?.cancel(); reading.current = null; }, []);
  const cam = useVinCamera(video, (vin, sure) => { if (sure) give(vin); else setDoubtful({ vin, why: 'check' }); });

  // a photo of the printed VIN, read on the phone
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    // the live view comes back after the photo only if it was there, or only its reader failed, or the camera would not
    // open (busy in another app: it may be free now, places-vehicles-r2-2); a camera refused or absent is not asked
    // for again after each photo, and its message stays (pv-4)
    const again = cam.state === 'starting' || cam.state === 'loading' || cam.state === 'live' || cam.state === 'noreader' || cam.state === 'error';
    if (again) cam.off();
    setDoubtful(null);
    setPhotoState('reading');
    setProgress(0);
    const r = readVinPhoto(file, setProgress);
    reading.current = r;
    let failed: PhotoState = 'notfound';
    try {
      const out = await r.result;
      if (reading.current !== r) return;
      if (out?.ok) { give(out.vin); return; }
      if (out) setDoubtful({ vin: out.vin, why: out.why || 'check' });
    } catch (e) {
      if (reading.current !== r) return;
      if (e instanceof ReaderUnavailable) failed = 'noreader';
    } finally {
      if (reading.current === r) reading.current = null;
      if (photo.current) photo.current.value = '';
    }
    if (done.current) return;
    setPhotoState(failed);
    // the live view comes back for another try (the barcode, or another photo)
    if (again) void cam.start();
  };
  const close = () => { reading.current?.cancel(); reading.current = null; p.onClose(); };

  const live = cam.state === 'starting' || cam.state === 'loading' || cam.state === 'live';
  const doubt = doubtful && (doubtful.why === 'check' ? t('vehicles.vin.bad') : t('vehicles.scan.unsure'));
  return (
    <Sheet open onClose={close} title={t('vehicles.scan.title')} data-testid="vin-scan-sheet"
      footer={<>
        <Button onClick={close}>{t('common.cancel')}</Button>
        {cam.torch != null && live && <Button icon={cam.torch ? <FlashlightOff size={18} /> : <Flashlight size={18} />} onClick={cam.flip}>{cam.torch ? t('vehicles.scan.torchOff') : t('vehicles.scan.torchOn')}</Button>}
      </>}>
      <div class="stack">
        {live && (
          <div class={`customers-scan${cam.state === 'live' ? ' is-live' : ''}`}>
            <video ref={video} playsInline muted autoPlay aria-hidden="true" />
            <span class="customers-scan-frame" aria-hidden="true"><span class="customers-scan-line" /></span>
            {cam.state !== 'live' && <span class="customers-scan-msg"><Spinner label={cam.state === 'loading' ? t('vehicles.scan.loading') : t('vehicles.scan.starting')} /></span>}
          </div>
        )}
        {cam.state === 'live' && <p class="muted" style={{ margin: 0 }}>{t('vehicles.scan.aim')}</p>}
        {cam.state === 'denied' && <Banner kind="warn">{t('vehicles.scan.denied')}</Banner>}
        {cam.state === 'nocam' && <Banner kind="info">{t('vehicles.scan.noCamera')}</Banner>}
        {cam.state === 'error' && <Banner kind="warn">{t('vehicles.scan.failed')}</Banner>}
        {(cam.state === 'noreader' || photoState === 'noreader') && <Banner kind="warn" data-testid="vin-reader-failed">{t('vehicles.scan.readerFailed')}</Banner>}
        {photoState === 'reading' && (
          <div class="stack" data-testid="vin-photo-reading">
            <p class="muted" style={{ margin: 0 }}>{t('vehicles.scan.reading')}</p>
            <div class="customers-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}
        {photoState === 'notfound' && !doubtful && <Banner kind="warn" data-testid="vin-photo-none">{t('vehicles.scan.notFound')}</Banner>}
        {doubtful && (
          <Banner kind="warn" title={t('vehicles.scan.doubt', { vin: doubtful.vin })} data-testid="vin-doubt"
            action={<Button size="sm" variant="primary" icon={<Check size={16} />} onClick={() => give(doubtful.vin)} data-testid="vin-doubt-keep">{t('vehicles.scan.keep')}</Button>}>
            {doubt}
          </Banner>
        )}
        <div class="customers-scan-photo">
          <p class="small muted" style={{ margin: 0 }}>{t('vehicles.scan.photoLead')}</p>
          <Button icon={<Camera size={18} />} onClick={() => photo.current?.click()} disabled={photoState === 'reading'} data-testid="vin-photo">{t('vehicles.scan.photo')}</Button>
          <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onPhoto((e.currentTarget as HTMLInputElement).files?.[0])} data-testid="vin-photo-input" />
        </div>
      </div>
    </Sheet>
  );
}
