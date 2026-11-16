/* The live camera of « Scanner le NIV »: opens the back camera, reads barcodes in it until a VIN is seen, and can be
   stopped (for a photo) and started again (after a photo that gave nothing: the live view used to stay gone until the
   sheet was reopened, customers-b-09). Every start has its own number: frames of an older start are never read. */
import { useEffect, useRef, useState, type MutableRef } from 'preact/hooks';
import { vinFromCode } from '../../domain/vehicles/vinRead';
import { barcodeReader, hasCamera } from './vinScan';

export type CameraState = 'starting' | 'loading' | 'live' | 'denied' | 'nocam' | 'error' | 'noreader' | 'off';

/** `onCode(vin, sure)`: a VIN seen in a barcode; a doubtful one only once it was read the same twice */
export function useVinCamera(video: MutableRef<HTMLVideoElement | null>, onCode: (vin: string, sure: boolean) => void) {
  const [state, setState] = useState<CameraState>('starting');
  const [torch, setTorch] = useState<boolean | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const session = useRef(0);
  const timer = useRef<number>(0);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = () => {
    session.current++;
    clearTimeout(timer.current);
    stream.current?.getTracks().forEach((x) => x.stop());
    stream.current = null;
    setTorch(null);
  };

  const start = async () => {
    stop();
    const n = session.current;
    const alive = () => n === session.current;
    setState('starting');
    let step: 'camera' | 'reader' = 'camera';
    try {
      if (!hasCamera()) throw Object.assign(new Error('none'), { name: 'NotFoundError' });
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (!alive()) { s.getTracks().forEach((x) => x.stop()); return; }
      stream.current = s;
      const el = video.current;
      if (!el) { stop(); return; }
      el.srcObject = s;
      // autoplay is refused on some phones until a tap: the frames still come, the reader still reads them
      await el.play().catch(() => undefined);
      const caps = (s.getVideoTracks()[0]?.getCapabilities?.() || {}) as { torch?: boolean };
      if (caps.torch) setTorch(false);
      setState('loading');
      step = 'reader';
      const { detector, native } = await barcodeReader();
      if (!alive()) return;
      setState('live');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let last = '', seen = 0;
      const tick = async () => {
        if (!alive() || !stream.current) return;
        try {
          if (el.readyState >= 2 && el.videoWidth) {
            let src: ImageBitmapSource | ImageData = el;
            if (!native && ctx) {
              // ZXing reads a still picture: the middle of the frame (where the code is aimed), at most 1280 px wide
              const w = el.videoWidth, h = el.videoHeight;
              const cw = Math.round(w * 0.9), ch = Math.round(h * 0.6);
              const k = Math.min(1, 1280 / cw);
              canvas.width = Math.round(cw * k); canvas.height = Math.round(ch * k);
              ctx.drawImage(el, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
              src = ctx.getImageData(0, 0, canvas.width, canvas.height);
            }
            for (const code of await detector.detect(src)) {
              if (!alive()) return;
              const r = vinFromCode(code.rawValue);
              if (!r) continue;
              if (r.ok) { onCodeRef.current(r.vin, true); return; }
              // a check digit that does not match (a car from outside North America, or a bad read): the same twice, then ask
              if (r.vin === last) { if (++seen >= 2) onCodeRef.current(r.vin, false); } else { last = r.vin; seen = 1; }
            }
          }
        } catch {
          // one frame the reader could not take (the video was resizing): the next one is tried
        }
        if (alive()) timer.current = window.setTimeout(tick, native ? 180 : 120);
      };
      void tick();
    } catch (e) {
      if (!alive()) return;
      // the camera is closed on every failure: it kept running behind « La caméra ne s’ouvre pas »
      stop();
      const name = (e as { name?: string })?.name;
      setState(step === 'reader' ? 'noreader'
        : name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
        : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nocam' : 'error');
    }
  };

  const off = () => { stop(); setState('off'); };

  const flip = async () => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch == null) return;
    try { await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }); setTorch(!torch); }
    catch { setTorch(null); }   // the lamp refused: its button goes
  };

  useEffect(() => { void start(); return stop; }, []);

  return { state, torch, start, off, flip };
}
