/* 🤖 Hermes: the round button at the bottom right of every screen, for everyone on the team (not while the owner
   « Voir l'app comme… »). The panel's code is loaded the first time it is opened. */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Bot, X } from 'lucide-preact';
import { access, preview } from '../../data/auth';
import { t } from '../../lib/i18n';
import './hermes.css';
import { hermesOpen, setHermesOpen } from '../../services/bubbles';

export const hermesBusy = signal(false);

export function mayHermes(): boolean { return !!access.value && !preview.value; }

export function HermesHost() {
  const show = mayHermes();
  const open = show && hermesOpen.value;
  const [Panel, setPanel] = useState<ComponentType | null>(null);
  useEffect(() => { document.documentElement.classList.toggle('has-hermes', show); return () => document.documentElement.classList.remove('has-hermes'); }, [show]);
  useEffect(() => { if (open && !Panel) void import('./HermesPanel').then((m) => setPanel(() => m.HermesPanel)); }, [open]);
  if (!show) return null;
  return (
    <>
      {open && Panel && <Panel />}
      <button type="button" class={`hermes-bubble${open ? ' is-open' : ''}`} onClick={() => setHermesOpen(!open)} aria-expanded={open}
        aria-label={open ? t('hermes.close') : t('hermes.open')} title={t('hermes.title')} data-testid="hermes-bubble">
        {open ? <X size={24} /> : <Bot size={26} />}
        {hermesBusy.value && !open && <span class="hermes-dot" aria-hidden="true" />}
      </button>
    </>
  );
}
