/* 🤖 Hermes: the panel (loaded the first time the bubble is opened). The conversation itself lives in session.ts, so it
   stays when the panel closes and goes away when the account changes; this file only draws it: the head, then either
   the conversation (HermesChat.tsx) or, for the owner, « Questions de l'équipe » (TeamLog.tsx). */
import { useState } from 'preact/hooks';
import { Volume2, RotateCcw, Users, MessageCircle } from 'lucide-preact';
import { isOwner } from '../../data/auth';
import { t } from '../../lib/i18n';
import { IconButton } from '../../ui';
import { chat, restartHermes } from './session';
import { stopSpeaking } from './speech';
import { voiceOn, setVoiceOn } from './prefs';
import { HermesChat } from './HermesChat';
import { TeamLog } from './TeamLog';

export function HermesPanel() {
  const [view, setView] = useState<'chat' | 'team'>('chat');
  const [voice, setVoice] = useState(voiceOn);
  const owner = isOwner();
  const toggleVoice = () => { const v = !voice; setVoice(v); setVoiceOn(v); if (!v) stopSpeaking(); };
  return (
    <section class="hermes-panel glass-strong" aria-label={t('hermes.title')} data-testid="hermes-panel">
      <header class="hermes-head">
        <b class="grow">🤖 {view === 'team' ? t('hermes.team') : t('hermes.title')}</b>
        {owner && (view === 'chat'
          ? <IconButton icon={<Users size={18} />} label={t('hermes.team')} onClick={() => setView('team')} data-testid="hermes-team-open" />
          : <IconButton icon={<MessageCircle size={18} />} label={t('hermes.back')} onClick={() => setView('chat')} data-testid="hermes-team-back" />)}
        <IconButton icon={<Volume2 size={18} />} label={t('hermes.voice')} pressed={voice} onClick={toggleVoice} />
        {chat.value.length > 0 && <IconButton icon={<RotateCcw size={18} />} label={t('hermes.newChat')} onClick={restartHermes} data-testid="hermes-new" />}
      </header>
      {view === 'team' ? <div class="hermes-body"><TeamLog /></div> : <HermesChat owner={owner} />}
    </section>
  );
}
