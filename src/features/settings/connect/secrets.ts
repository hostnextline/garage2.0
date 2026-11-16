/* What the server says about the keys of the outside services (never the keys themselves), and the small rules of the
   « dans mon compte » switches (pure, secrets.test.ts). */

export interface Secrets { ghl: { on: boolean; token_end: string | null; location: string | null }; stripe: { on: boolean; test: boolean; end: string | null } }

/** the answer of `team secrets`, with every missing piece said « off » */
export function secretsOf(r: Partial<{ ghl: Partial<Secrets['ghl']>; stripe: Partial<Secrets['stripe']> }> | null | undefined): Secrets {
  return {
    ghl: { on: !!r?.ghl?.on, token_end: r?.ghl?.token_end ?? null, location: r?.ghl?.location ?? null },
    stripe: { on: !!r?.stripe?.on, test: !!r?.stripe?.test, end: r?.stripe?.end ?? null }
  };
}

/** what to send to `secrets-set` for GoHighLevel: only the boxes filled (an empty one keeps the stored key); null: nothing typed */
export function ghlBody(token: string, location: string): Record<string, string> | null {
  const body: Record<string, string> = {};
  if (token.trim()) body.ghl_token = token.trim();
  if (location.trim()) body.ghl_location = location.trim();
  return Object.keys(body).length ? body : null;
}

/** this device's alert (Web Push) serves the calls AND the texts of the account: it is switched off only when the other
    one is off too */
export function dropAlert(turningOn: boolean, otherOn: boolean): boolean {
  return !turningOn && !otherOn;
}
