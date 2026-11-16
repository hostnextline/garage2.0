/* The photo zone of the expense sheet: « Prendre le reçu en photo » / « Choisir une image » before there is one; the
   picture with « Changer la photo » / « Retirer la photo » after; the reader's progress and its message. */
import { Camera, ImagePlus, Paperclip, ScanText, X, Expand } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { Button, Banner, Skeleton } from '../../ui';
import { Meter } from '../../shared/charts/charts';
import type { ReadMsg, ReadingState } from './useReceiptReading';

export function ReceiptCapture(p: {
  /** the picture shown, or null; `attached`: the expense names a receipt (its picture may still be on its way) */
  shown: string | null; attached: boolean; thumb: 'idle' | 'loading' | 'failed';
  /** the photo waits on the phone to be sent */
  waiting: boolean;
  /** the server refused the photo: it is kept, and saving again tries it again */
  refused?: boolean;
  reading: ReadingState | null; msg: ReadMsg | null; l: string;
  onShoot: () => void; onPick: () => void; onRemove: () => void; onView: () => void; onStop: () => void;
}) {
  const { reading } = p;
  const pctText = reading ? new Intl.NumberFormat(p.l === 'en' ? 'en-CA' : 'fr-CA', { style: 'percent', maximumFractionDigits: 0 }).format(reading.pct) : '';
  return (
    <div class="tre-photo stack">
      {!(p.shown || p.attached) ? (
        <>
          <button type="button" class="tre-shoot" onClick={p.onShoot} data-testid="receipt-shoot">
            <span class="tre-shoot-icon" aria-hidden="true"><Camera /></span>
            <span class="tre-shoot-txt"><b>{t('treasury.form.photo')}</b><span>{t('treasury.form.photoSub')}</span></span>
          </button>
          <Button variant="ghost" icon={<ImagePlus size={18} />} onClick={p.onPick} data-testid="receipt-pick">{t('treasury.form.pick')}</Button>
        </>
      ) : (
        <>
          {p.shown ? (
            <button type="button" class="tre-thumb" onClick={p.onView} aria-label={t('treasury.form.see')} data-testid="receipt-thumb">
              <img src={p.shown} alt={t('treasury.form.photoAlt')} />
              <span class="tre-thumb-zoom" aria-hidden="true"><Expand size={18} /></span>
            </button>
          ) : p.thumb === 'loading' ? <div class="tre-thumb tre-thumb-empty"><Skeleton h={180} /></div>
            : <div class="tre-thumb tre-thumb-empty"><Paperclip /><Button variant="secondary" onClick={p.onView}>{t('treasury.form.see')}</Button></div>}
          {p.waiting && <p class="small muted" style={{ margin: 0 }} data-testid="receipt-waiting">{t('treasury.form.photoWaiting')}</p>}
          {p.refused && <p class="small tre-warn" style={{ margin: 0 }} role="status" data-testid="receipt-refused">{t('treasury.form.photoRefused')}</p>}
          <div class="row-wrap">
            <Button variant="secondary" icon={<Camera size={18} />} onClick={p.onShoot} data-testid="receipt-change">{t('treasury.form.change')}</Button>
            <Button variant="ghost" icon={<X size={18} />} onClick={p.onRemove} data-testid="receipt-remove">{t('treasury.form.remove')}</Button>
          </div>
        </>
      )}
      {reading && (
        <div class="tre-reading" role="status" data-testid="receipt-reading">
          <div class="row">
            <ScanText size={20} aria-hidden="true" />
            <span class="grow">{reading.stage === 'read' ? t('treasury.form.reading', { pct: pctText }) : t('treasury.form.preparing')}</span>
            <Button variant="ghost" onClick={p.onStop} data-testid="receipt-stop">{t('treasury.form.stop')}</Button>
          </div>
          <Meter value={reading.stage === 'read' ? reading.pct : 0.04} label={t('treasury.form.preparing')} />
        </div>
      )}
      {p.msg && <Banner kind={p.msg.kind} data-testid="receipt-message">{p.msg.text}</Banner>}
    </div>
  );
}
