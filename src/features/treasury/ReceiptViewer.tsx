/* The receipt, large, in a sheet over the expense; « Ouvrir en grand » opens it in a tab of its own (the phone's
   zoom). That address is made as soon as the picture is there, so the tab opens on the tap itself (Safari blocks a
   window opened after a wait), and only for a plain picture, with its kind checked here. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Expand } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { isNetworkError, net } from '../../data/sync';
import { Sheet, Button, Banner, Spinner } from '../../ui';
import { openableUrl, receiptImage } from './receipts';

/** how long the full-size address lives after the viewer lets it go: a tab opened just before still loads it */
export const LARGE_URL_MS = 60000;

export function ReceiptViewer(p: { open: boolean; onClose: () => void; src?: string | null; id?: string | null }) {
  const [st, setSt] = useState<{ url: string | null; err: string | null; loading: boolean }>({ url: null, err: null, loading: false });
  // asked again when the signal comes back, only when it was missing (a picture already shown stays as it is)
  const online = net.value.online;
  const [ask, setAsk] = useState(0);
  const errRef = useRef(st.err);
  errRef.current = st.err;
  useEffect(() => { if (online && errRef.current === t('treasury.viewer.offline')) setAsk((n) => n + 1); }, [online]);
  useEffect(() => {
    if (!p.open) return;
    if (p.src) { setSt({ url: p.src, err: null, loading: false }); return; }
    if (!p.id) { setSt({ url: null, err: t('treasury.viewer.missing'), loading: false }); return; }
    let alive = true;
    setSt({ url: null, err: null, loading: true });
    receiptImage(p.id).then(
      (u) => { if (alive) setSt({ url: u, err: u ? null : t('treasury.viewer.missing'), loading: false }); },
      (e) => { if (alive) setSt({ url: null, err: isNetworkError(e) || !net.value.online ? t('treasury.viewer.offline') : t('treasury.viewer.missing'), loading: false }); }
    );
    return () => { alive = false; };
  }, [p.open, p.src, p.id, ask]);
  const [large, setLarge] = useState<string | null>(null);
  useEffect(() => {
    if (!p.open || !st.url) { setLarge(null); return; }
    const u = openableUrl(st.url);
    setLarge(u);
    return () => { if (u) setTimeout(() => URL.revokeObjectURL(u), LARGE_URL_MS); };
  }, [p.open, st.url]);
  // Escape: the kit's Sheet closes the sheet on top only, so this one closes and the expense stays open
  return (
    <Sheet open={p.open} onClose={p.onClose} wide title={t('treasury.viewer.title')} data-testid="receipt-viewer"
      footer={large ? <Button variant="secondary" icon={<Expand size={18} />} href={large} target="_blank">{t('treasury.viewer.open')}</Button> : undefined}>
      {st.loading ? <Spinner label={t('treasury.viewer.loading')} />
        : st.err ? <Banner kind="warn">{st.err}</Banner>
        : st.url && <img class="tre-receipt-img" src={st.url} alt={t('treasury.form.photoAlt')} />}
    </Sheet>
  );
}
