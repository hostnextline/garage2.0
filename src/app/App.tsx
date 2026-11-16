/* What is on the screen: the splash while starting, the sign-in screens (downloaded only when needed: a signed-in
   start does not carry them), « Mets l'app à jour » for a version too old, or the app. The questions, the toasts and
   the tap shield sit above everything. */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { authState } from '../data/auth';
import { reportError } from '../platform/report';
import { ToastHost, AskHost, TapShield, CrashMessage } from '../ui';
import { mustUpdate } from '../shared/app/pwa';
import { Shell } from './Shell';
import { Splash } from './Splash';
import { UpdateGate } from './UpdateGate';

/** the start failed in a way nothing else caught: « Recharger » instead of a splash for ever */
export const bootFailed = signal(false);

type Gates = typeof import('../features/auth/GateScreens');
let gates: Gates | null = null;
let gatesLoading: Promise<Gates> | null = null;
function loadGates(): Promise<Gates> {
  if (!gatesLoading) gatesLoading = import('../features/auth/GateScreens').then((m) => (gates = m), (e) => { gatesLoading = null; throw e; });
  return gatesLoading;
}
function Gate(p: { pick: (g: Gates) => ComponentType }) {
  const [, setReady] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (gates) return;
    let alive = true;
    loadGates().then(() => { if (alive) setReady((n) => n + 1); }, (e) => { reportError(e, 'gates', 'chunk'); if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);
  if (failed) return <CrashMessage />;
  if (!gates) return <Splash />;
  const C = p.pick(gates);
  return <C />;
}

export function App() {
  const s = authState.value;
  return (
    <>
      {bootFailed.value ? <CrashMessage />
        : mustUpdate() ? <UpdateGate />
        : s === 'loading' ? <Splash />
        : s === 'invite' ? <Gate pick={(g) => g.InviteScreen} />
        : s === 'signed_out' ? <Gate pick={(g) => g.LoginScreen} />
        : s === 'no_access' ? <Gate pick={(g) => g.NoAccessScreen} />
        : <Shell />}
      <AskHost />
      <ToastHost />
      <TapShield />
    </>
  );
}
