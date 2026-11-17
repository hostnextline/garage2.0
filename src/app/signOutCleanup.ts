/* What « Me déconnecter » forgets on this phone besides the session and the push address (R104): the routes by the
   streets and the team's maps kept in memory, and the reports kept on the phone (his.report.*), so the next person
   who signs in here never sees the last one's. The frame registers them (shared/app may not reach shared/map or
   shared/charts); each one's code is asked only at sign-out (the service worker keeps it on the phone). Hermes and the
   texts forget their person by themselves when the account changes (features/hermes/session.ts, conversation/store.ts). */
import { onSignOut } from '../shared/app/signOut';

let done = false;
export function registerSignOutCleanup(): void {
  if (done) return;
  done = true;
  onSignOut(async () => (await import('../shared/map/roads')).forgetRoads());
  onSignOut(async () => (await import('../shared/map/useTeamMap')).forgetTeamMaps());
  onSignOut(async () => (await import('../shared/charts/reportCache')).clearReports());
}
