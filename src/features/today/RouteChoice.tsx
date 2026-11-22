/* « La route que je fais » (« Routes partagées »): several vehicles are mine, I pick the one I drive now; one tap to
   change, kept on the phone. */
import { useEffect } from 'preact/hooks';
import { Seg } from '../../ui';
import { t } from '../../lib/i18n';
import { truck as truckRow } from '../../data/select';
import { net } from '../../data/sync';
import { myRoute, setMyRoute } from './prefs';
import { currentRoute, myActiveTrucks } from './select';

export function RouteChoice() {
  const ids = myActiveTrucks();
  const stored = myRoute.value;
  const ready = net.value.ready;
  // a route remembered on a vehicle that is no longer mine or in service: forgotten, so the list is never filtered on it
  // (only once the phone's copy is there: before, every vehicle looks unknown)
  useEffect(() => { if (ready && stored && ids.length > 0 && !ids.includes(stored)) setMyRoute(null); }, [ready, stored, ids.join()]);
  if (ids.length < 2) return null;
  const rows = ids.map((id) => truckRow(id)!);
  // « Voiture » / « Camion » when that tells them apart, else the vehicles' names
  const cars = rows.filter((r) => r.tire_machine === false).length;
  const byKind = cars === 1 && rows.length === 2;
  return (
    <div class="today-route" data-testid="today-route">
      <Seg<string> value={currentRoute() ?? 'all'} onValue={(v) => setMyRoute(v === 'all' ? null : v)} label={t('today.route.label')}
        options={[{ value: 'all', label: t('today.route.all') }, ...rows.map((r) => ({ value: r.id, label: byKind ? t(r.tire_machine === false ? 'today.route.car' : 'today.route.truck') : r.name }))]} />
    </div>
  );
}
