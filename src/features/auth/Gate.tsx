/* The frame of the screens before the app (sign in, invitation, no access): the H.I.S logo on glass, the language
   below; and the splash while the app starts. */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Eye, EyeOff } from 'lucide-preact';
import { t, lang, setLang } from '../../lib/i18n';
import { InputWithButton, Seg } from '../../ui';

export function Gate(p: { children: ComponentChildren; testid: string }) {
  return (
    <div class="gate" data-testid={p.testid}>
      <div class="gate-panel glass-strong">
        <img class="gate-logo" src="./logo-his.png" alt="Mécanique Mobile H.I.S" width="88" height="88" />
        {p.children}
        <div class="gate-foot">
          <Seg value={lang.value} onValue={(v) => setLang(v)} label={lang.value === 'en' ? 'Language' : 'Langue'} options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
        </div>
      </div>
    </div>
  );
}

export function Splash() {
  return <div class="splash" aria-busy="true" aria-label={t('shell.splash')}><img src="./logo-his.png" alt="" width="96" height="96" /></div>;
}

export function PasswordInput(p: { value: string; onValue: (v: string) => void; autoComplete: string; id?: string; invalid?: boolean; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <InputWithButton id={p.id} type={show ? 'text' : 'password'} value={p.value} onValue={p.onValue} autoComplete={p.autoComplete} invalid={p.invalid} autoFocus={p.autoFocus}
      button={<button type="button" class="iconbtn" aria-label={show ? t('auth.hide') : t('auth.show')} onClick={() => setShow(!show)}>{show ? <EyeOff /> : <Eye />}</button>} />
  );
}
