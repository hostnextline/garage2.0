/* What is behind the glass. With H.I.S: a picture of the road at night (dark) or of the showroom by day (light), made
   for the app (tests/tools/render-backdrops.cjs). Each person can put their own photo instead (their truck, their
   garage): it stays on this device only, made smaller first so it opens fast and fits in the phone's storage. */
import { signal } from '@preact/signals';
import nightUrl from '../ui/styles/backdrops/his-night.webp';
import dayUrl from '../ui/styles/backdrops/his-day.webp';

export const HIS_NIGHT = nightUrl;
export const HIS_DAY = dayUrl;
const KEY = 'his.backdrop.photo';

function read(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
/** my own photo behind the glass (a data: address), or null for the H.I.S picture */
export const myPhoto = signal<string | null>(read());

/** keeps the photo on this device; false when the phone has no room left for it */
export function setMyPhoto(dataUrl: string | null): boolean {
  try {
    if (dataUrl) localStorage.setItem(KEY, dataUrl); else localStorage.removeItem(KEY);
  } catch {
    return false;
  }
  myPhoto.value = dataUrl;
  return true;
}

/** the size to draw a photo at: its longest side at most `max` pixels, never made bigger */
export function fitSize(w: number, h: number, max = 1600): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
}

/** a photo from the phone, made smaller and saved as JPEG (every phone can read it); turned the right way by the browser */
export async function shrinkPhoto(file: Blob, max = 1600, quality = 0.8): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const { w, h } = fitSize(img.naturalWidth, img.naturalHeight, max);
    if (!w || !h) throw new Error('empty');
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** puts my photo (or the theme's picture) behind the glass */
export function applyBackdrop(root: HTMLElement, photo: string | null) {
  if (photo) {
    root.style.setProperty('--bg-photo', `url("${photo}")`);
    root.dataset.photo = 'mine';
  } else {
    root.style.removeProperty('--bg-photo');
    delete root.dataset.photo;
  }
}
