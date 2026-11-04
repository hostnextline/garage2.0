/* « PDF »: makes the document, then hands it to the phone's « Partager » panel (or downloads it on a computer).
   A phone may want a fresh tap before sharing when the file took a moment: the sheet « Le PDF est prêt » asks for it. */
import { useEffect, useState } from 'preact/hooks';
import { Share2, Download } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { Sheet, Button, toast } from '../../ui';
import { drawPdf, preloadPdf, type PdfData } from './pdf';
import { shareOrDownload, shareFileNow, downloadBlob, type ShareOutcome } from './share';

export function usePdf() {
  const [ready, setReady] = useState<{ blob: Blob; data: PdfData; onShared?: () => void } | null>(null);
  useEffect(() => {
    const w = window as unknown as { requestIdleCallback?: (f: () => void) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(preloadPdf); else setTimeout(preloadPdf, 1500);
  }, []);
  /** makes the PDF; share: false only downloads it; onShared: once it was handed to another app (or downloaded) */
  const make = async (build: () => PdfData | null, o: { share?: boolean; onShared?: () => void } = {}): Promise<ShareOutcome | null> => {
    let data: PdfData | null = null;
    try {
      data = build();
      if (!data) return null;
      const blob = await drawPdf(data);
      let r: ShareOutcome;
      if (o.share === false) { downloadBlob(blob, data.fileName); r = 'downloaded'; }
      else r = await shareOrDownload(blob, data.fileName, { title: data.docTitle });
      if (r === 'blocked') setReady({ blob, data, onShared: o.onShared });
      else if (r === 'downloaded') toast(t('invoices.pdf.downloaded', { name: data.fileName }), { kind: 'ok' });
      if (r === 'shared' || r === 'downloaded') o.onShared?.();
      return r;
    } catch (e) {
      console.error(e);
      toast(t('invoices.pdf.failed'), { kind: 'bad' });
      return null;
    }
  };
  const sheet = ready ? (
    <Sheet open onClose={() => setReady(null)} title={t('invoices.pdf.readyTitle')} sub={ready.data.fileName}
      footer={<>
        <Button icon={<Download />} onClick={() => { downloadBlob(ready.blob, ready.data.fileName); ready.onShared?.(); setReady(null); }}>{t('common.download')}</Button>
        <Button variant="primary" icon={<Share2 />} onClick={async () => {
          const r = await shareFileNow(ready.blob, ready.data.fileName, { title: ready.data.docTitle });
          if (r === 'shared') ready.onShared?.();
          setReady(null);
        }}>{t('common.share')}</Button>
      </>}>
      <p class="muted" style={{ margin: 0 }}>{t('invoices.pdf.readyText')}</p>
    </Sheet>
  ) : null;
  return { make, sheet };
}
