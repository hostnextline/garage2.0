/* The work of the car on screen: the services (time and price count by themselves), the duration, the problem the
   customer describes; and the note for the mechanic (one for the visit). */
import { RotateCcw } from 'lucide-preact';
import { t } from '../../lib/i18n';
import { duration } from '../../lib/dates';
import { uuid } from '../../data/sync';
import { Panel, Field, Textarea, Stepper, Button, Money } from '../../ui';
import { ServicePicker } from '../../shared/moment/ServicePicker';
import { clampDuration, type BookSummary } from '../../domain/moment/logic';
import type { Action, Work } from './draft';

type Act = (a: Action) => void;

export function ServicesPanel(p: { work: Work; sum: BookSummary; lang: 'fr' | 'en'; ui: 'fr' | 'en'; forCar: string | null; bt: (k: string) => string; act: Act }) {
  const { work, sum } = p;
  const l = p.ui;
  return (
    <Panel title={t('booking.services.title')} sub={t('booking.services.sub')} data-tour="book-services">
      {p.forCar && <p class="book-for" data-testid="book-services-for">{t('booking.call.workFor', { car: p.forCar })}</p>}
      <ServicePicker value={work.items} onValue={(items) => p.act({ t: 'items', items, mint: uuid() })} lang={p.lang} allowCustom hideTotal />
      <div class="book-duration" data-testid="book-duration">
        <Field label={t('booking.options.duration')} hint={work.dur != null ? p.bt('options.durationChanged') : p.bt('options.durationHint')} group>
          <div class="row-wrap">
            <Stepper value={sum.minutes} min={15} max={720} step={15} label={t('booking.options.duration')} format={(v) => duration(v, l)} onValue={(v) => p.act({ t: 'dur', dur: clampDuration(v), mint: uuid() })} />
            {work.dur != null && <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => p.act({ t: 'dur', dur: null, mint: uuid() })} data-testid="book-duration-reset">{t('booking.options.durationReset')}</Button>}
          </div>
        </Field>
      </div>
      <div class="book-sum" data-testid="book-services-sum">
        <span class="book-sum-time"><b class="num">{duration(sum.minutes, l)}</b> <span class="muted small">{work.items.length || work.dur ? t('booking.summary.workLabel') : t('booking.summary.problemOnly')}</span></span>
        <span class="book-sum-money">
          <Money cents={sum.total} large />
          <span class="muted small">{t('booking.summary.taxesLabel')}{sum.toConfirm ? `, ${t('booking.summary.toConfirm')}` : ''}</span>
        </span>
      </div>
    </Panel>
  );
}

/** the problem is the car's own (several cars: each says its own); the note is the visit's */
export function NotesPanel(p: { problem: string; notes: string; hasLines: boolean; act: Act }) {
  return (
    <Panel title={t('booking.notes.title')}>
      <div class="stack">
        <Field label={t('booking.notes.problem')} hint={t('booking.notes.problemHint')} optional={p.hasLines}>
          <Textarea value={p.problem} onValue={(text) => p.act({ t: 'problem', text, mint: uuid() })} rows={3} maxLength={2000} data-testid="book-problem" />
        </Field>
        <Field label={t('booking.notes.notes')} hint={t('booking.notes.notesHint')} optional>
          <Textarea value={p.notes} onValue={(text) => p.act({ t: 'notes', text })} rows={2} maxLength={2000} />
        </Field>
      </div>
    </Panel>
  );
}
