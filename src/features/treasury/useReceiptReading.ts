/* Reading a receipt photo with the reader (OCR), for the expense sheet: the progress, « Arrêter la lecture », and
   the message when it fails. One reading at a time: a new photo stops the one before, and an answer that arrives for
   a photo no longer on screen is dropped. The reading stops when the sheet closes. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { readReceipt, type Reading } from '../../shared/export/ocr';

export interface ReadMsg { kind: 'ok' | 'info' | 'warn'; text: string }
export interface ReadingState { pct: number; stage: 'load' | 'read' }

export function useReceiptReading(onText: (text: string) => void) {
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [msg, setMsg] = useState<ReadMsg | null>(null);
  const current = useRef<Reading | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  useEffect(() => () => current.current?.cancel(), []);

  async function read(image: string) {
    current.current?.cancel();
    setReading({ pct: 0, stage: 'load' });
    let r: Reading | null = null;
    r = readReceipt(image, (pct, stage) => { if (!r || current.current === r) setReading({ pct, stage }); });
    current.current = r;
    try {
      const text = await r.result;
      if (current.current !== r) return;
      onTextRef.current(text);
    } catch (e) {
      if (current.current !== r) return;
      setMsg((e as { code?: string }).code === 'stopped' ? { kind: 'info', text: t('treasury.form.stopped') } : { kind: 'warn', text: t('treasury.form.noReader') });
    } finally {
      if (current.current === r) { current.current = null; setReading(null); }
    }
  }
  /** « Arrêter la lecture »: the person types the amounts */
  const stop = () => current.current?.cancel();
  /** the photo is gone: the reading and its message too */
  function reset() {
    current.current?.cancel();
    current.current = null;
    setReading(null); setMsg(null);
  }
  return { reading, msg, setMsg, read, stop, reset };
}
