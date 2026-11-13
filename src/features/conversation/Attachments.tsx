/* The pictures and documents of a message (a customer's MMS, or what the garage sent from GoHighLevel): a picture shows in
   the conversation (a tap opens it full size), a video or a voice note plays in place, a document is a link that opens it.
   The files stay at GoHighLevel: the app only shows their web addresses. Rules in texts.ts (fileKind, fileName). */
import { useState } from 'preact/hooks';
import { Paperclip } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { fileKind, fileName, safeFiles } from './texts';

export function Attachments(p: { files: string[] | null | undefined }) {
  const files = safeFiles(p.files);
  if (!files.length) return null;
  return <div class="conv-files" data-testid="conversation-files">{files.map((u) => <One key={u} url={u} />)}</div>;
}

function One(p: { url: string }) {
  const kind = fileKind(p.url);
  // a picture that does not load (or an address with no ending that is not a picture) becomes a link
  const [broken, setBroken] = useState(false);
  if ((kind === 'image' || kind === 'unknown') && !broken) {
    return (
      <a class="conv-file-pic" href={p.url} target="_blank" rel="noopener noreferrer" aria-label={t('conversation.file.openPhoto')} data-testid="conversation-photo">
        <img src={p.url} alt={t('conversation.file.photo')} loading="lazy" decoding="async" referrerpolicy="no-referrer" onError={() => setBroken(true)} />
      </a>
    );
  }
  if (kind === 'video') return <video class="conv-file-video" src={p.url} controls playsInline preload="metadata" aria-label={t('conversation.file.video')} data-testid="conversation-video" />;
  if (kind === 'audio') return <audio class="conv-file-audio" src={p.url} controls preload="none" aria-label={t('conversation.file.audio')} data-testid="conversation-audio" />;
  const name = fileName(p.url);
  return (
    <a class="conv-file-doc" href={p.url} target="_blank" rel="noopener noreferrer" data-testid="conversation-doc">
      <Paperclip size={18} aria-hidden="true" />
      <span class="ellipsis">{kind === 'file' && name ? name : t('conversation.file.doc')}</span>
      <span class="conv-file-open">{t('conversation.file.open')}</span>
    </a>
  );
}
