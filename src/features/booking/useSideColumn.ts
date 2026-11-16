/* The right column of the booking screen on a computer stays in view while the form scrolls. */
import { useEffect, type MutableRef } from 'preact/hooks';

/** blocks: the column's height follows where it starts on the screen, so « Réserver » under it is always visible
    (before the page scrolls, the column starts lower). « Plages d'arrivée » (`tall`): the time calendar is taller
    than the screen can be, so the column is as tall as it needs and stays in view by its bottom (it sticks where its
    last line shows, above the « Réserver » bar). */
export function useSideColumn(side: MutableRef<HTMLElement | null>, on: boolean, tall: boolean): void {
  useEffect(() => {
    const el = side.current;
    if (!on || !el) return;
    let raf = 0;
    const update = () => { raf = 0; el.style.setProperty('--side-top', `${Math.max(0, Math.round(el.getBoundingClientRect().top))}px`); };
    const later = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => { window.removeEventListener('scroll', later); window.removeEventListener('resize', later); if (raf) cancelAnimationFrame(raf); };
  }, [on]);
  useEffect(() => {
    const el = side.current;
    if (!tall || !el || typeof ResizeObserver !== 'function') return;
    const fit = () => el.style.setProperty('--side-stick', `${Math.min(12, window.innerHeight - el.offsetHeight - 108)}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [tall]);
}
