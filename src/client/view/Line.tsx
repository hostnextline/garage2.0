/* One line of work, of an invoice or of an estimate: what, its details, its amount (struck through when refused). */
import type { ComponentChildren } from 'preact';
import { cad } from '../format';
import type { CLang } from '../i18n';

export function Line(p: { desc: string; meta?: ComponentChildren; cents: number; l: CLang; off?: boolean }) {
  return (
    <li class="cl-line">
      <span class="cl-line-main">
        <span class="cl-line-desc" style={p.off ? { textDecoration: 'line-through', color: 'var(--ink-3)' } : undefined}>{p.desc}</span>
        {p.meta && <span class="cl-line-meta">{p.meta}</span>}
      </span>
      <span class="cl-line-amt" style={p.off ? { color: 'var(--ink-3)' } : undefined}>{cad(p.cents, p.l)}</span>
    </li>
  );
}
