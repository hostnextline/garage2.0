/* Internal links count as steps of the app's history (so « Retour » goes back to them): a plain click on
   <a href="#/…"> becomes navigate(). A click with a modifier key, a link that opens elsewhere or downloads, or a click
   already handled is left to the browser. */
import { navigate } from '../platform/router';

/** the screen a click goes to, or null when the browser should handle it (pure: tested) */
export function linkTarget(e: Pick<MouseEvent, 'defaultPrevented' | 'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'target'>): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as HTMLElement | null)?.closest?.('a[href^="#/"]') as HTMLAnchorElement | null;
  if (!a || a.target || a.hasAttribute('download')) return null;
  return a.getAttribute('href')!.slice(1);
}
/** listens once for the whole app; returns the way to stop */
export function interceptLinks(doc: Document = document): () => void {
  const onClick = (e: MouseEvent) => {
    const to = linkTarget(e);
    if (to == null) return;
    e.preventDefault();
    navigate(to);
  };
  doc.addEventListener('click', onClick);
  return () => doc.removeEventListener('click', onClick);
}
