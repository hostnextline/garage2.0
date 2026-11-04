/* The tour's overlay: the screen dimmed, a spotlight on one element, a short bubble (title, one or two sentences)
   with « Précédent », « Suivant », « Arrêter ». Calm: no points, no game; the page underneath can't be tapped by
   mistake. Keyboard: Échap stops, the arrows move, Tab stays in the bubble. Reduced motion is respected. */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../lib/i18n';
import { Button } from '../../ui';
import { tourRun, nextTourStep, prevTourStep, stopTour, relocate } from './tour';
import { placeBubble } from './tour-steps';
import './guide.css';

const PAD = 6;
interface Box { top: number; left: number; width: number; height: number; bottom: number }

export function TourOverlay() {
  const r = tourRun.value;
  const [box, setBox] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const el = r?.phase === 'show' ? r.el : null;

  // follow the element: scrolling, resizing, the screen moving under it
  useLayoutEffect(() => {
    if (!el) { setBox(null); return; }
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!el.isConnected) { relocate(); return; }
        const b = el.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const top = Math.max(4, b.top - PAD), left = Math.max(4, b.left - PAD);
        const right = Math.min(vw - 4, b.right + PAD), bottom = Math.min(vh - 4, b.bottom + PAD);
        setBox((cur) => (cur && cur.top === top && cur.left === left && cur.width === right - left && cur.height === bottom - top ? cur
          : { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top), bottom }));
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    const iv = setInterval(measure, 400);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); ro?.disconnect(); clearInterval(iv); };
  }, [el]);

  // the bubble next to the spotlight
  useLayoutEffect(() => {
    const b = bubble.current;
    if (!b || !r) { setPos(null); return; }
    const bb = b.getBoundingClientRect();
    const p = placeBubble(box ? { top: box.top, bottom: box.top + box.height, left: box.left, width: box.width } : null, window.innerWidth, window.innerHeight, bb.width, bb.height);
    setPos((cur) => (cur && cur.top === p.top && cur.left === p.left ? cur : { top: p.top, left: p.left }));
  }, [box, r?.index, r?.phase, r?.kind]);

  // each new step: the bubble's title gets the focus (read aloud), Tab stays in the bubble, Échap stops
  useEffect(() => { if (r?.phase === 'show') title.current?.focus({ preventScroll: true }); }, [r?.index, r?.phase, r?.el]);
  useEffect(() => {
    if (!r) return;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopTour(); return; }
      if (e.key === 'ArrowRight' && tourRun.value?.phase === 'show') { e.preventDefault(); nextTourStep(); return; }
      if (e.key === 'ArrowLeft' && tourRun.value?.phase === 'show') { e.preventDefault(); prevTourStep(); return; }
      if (e.key === 'Tab' && bubble.current) {
        const f = Array.from(bubble.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="-1"]'));
        if (!f.length) return;
        const i = f.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); before?.focus?.({ preventScroll: true }); };
  }, [!!r]);

  if (!r) return null;
  // « Montre-moi »: nothing on the screen until the element is found (the screen opens first)
  if (r.kind === 'spot' && r.phase !== 'show') return null;
  const step = r.steps[r.index];
  const showing = r.phase === 'show' && !!box;
  const head = r.kind === 'spot' ? r.title : t(`guide.tour.steps.${step.key}.title`);
  const text = r.kind === 'spot' ? r.text : t(`guide.tour.steps.${step.key}.text`);
  const last = r.index >= r.steps.length - 1;
  return (
    <div class="tour" data-testid="tour">
      <div class={`tour-block${showing ? '' : ' is-dim'}`} onPointerDown={(e) => e.preventDefault()} aria-hidden="true" />
      {showing && <div class="tour-spot" style={{ top: `${box!.top}px`, left: `${box!.left}px`, width: `${box!.width}px`, height: `${box!.height}px` }} aria-hidden="true" />}
      <div ref={bubble} class="tour-bubble" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" data-testid="tour-bubble"
        style={pos ? { top: `${pos.top}px`, left: `${pos.left}px` } : { visibility: 'hidden', top: '0px', left: '0px' }}>
        {r.phase === 'seek' ? (
          <div class="tour-wait" role="status">
            <span class="spin" aria-hidden="true" />
            <span class="grow">{t('guide.tour.wait')}</span>
            <Button variant="ghost" onClick={stopTour} data-testid="tour-stop">{t('guide.tour.stop')}</Button>
          </div>
        ) : (
          <>
            <span class="tour-count">{r.kind === 'tour' ? t('guide.tour.count', { n: r.index + 1, total: r.steps.length }) : t('guide.tour.here')}</span>
            <h2 id="tour-title" ref={title} tabIndex={-1} aria-live="polite">{head}</h2>
            <p id="tour-text">{text}</p>
            <div class="tour-actions">
              {r.kind === 'tour' ? (
                <>
                  <Button variant="ghost" onClick={stopTour} data-testid="tour-stop">{t('guide.tour.stop')}</Button>
                  <span class="grow" />
                  {r.index > 0 && <Button onClick={prevTourStep} data-testid="tour-prev">{t('guide.tour.prev')}</Button>}
                  <Button variant="primary" onClick={nextTourStep} data-testid="tour-next">{last ? t('guide.tour.finish') : t('guide.tour.next')}</Button>
                </>
              ) : (
                <>
                  <span class="grow" />
                  <Button variant="primary" onClick={stopTour} data-testid="tour-ok">{t('guide.tour.ok')}</Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
