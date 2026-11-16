/* A sheet closed by one of its buttons steps back over its own history entry. That step is asynchronous: a
   navigation asked meanwhile waits for it (see whenHistorySettled), or it would be undone by the step back. */
let backPending = 0;
const afterBack: (() => void)[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (backPending > 0 && --backPending === 0) for (const f of afterBack.splice(0)) f();
  });
}
export function whenHistorySettled(fn: () => void) { if (backPending > 0) afterBack.push(fn); else fn(); }
export function stepBack() {
  backPending++;
  history.back();
  // a browser that never answers the step back must not hold navigation
  setTimeout(() => { if (backPending > 0) { backPending = 0; for (const f of afterBack.splice(0)) f(); } }, 600);
}
