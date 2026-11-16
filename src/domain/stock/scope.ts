/* Whose appointments the week's needs can count. The phone holds only the jobs its account may read
   (job_visible: the « agenda » right, else the trucks the person drives, or every truck with « Routes partagées »).
   A mechanic with « Inventaire » but neither would see the needs of his own truck only, and a short list sent to the
   supplier looked complete: the screen says so. Pure (tested in scope.test.ts). */

/** true when the phone holds every truck's appointments */
export function holdsEveryJob(canAgenda: boolean, mine: readonly string[], trucks: readonly string[]): boolean {
  if (canAgenda) return true;
  const own = new Set(mine);
  return trucks.length > 0 && trucks.every((t) => own.has(t));
}
