/* The link of an invitation or a new password, handed by the owner: the phone's « Partager » and a ready e-mail. */

/** the phone's share sheet with the link (closing it is not an error) */
export async function shareLink(title: string, text: string, url: string): Promise<void> {
  try { await navigator.share({ title, text, url }); } catch { /* the person closed the share sheet: nothing to say */ }
}
export function mailHref(email: string | null | undefined, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(String(email || ''))}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
