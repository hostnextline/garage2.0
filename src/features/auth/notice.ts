/* A word from one gate screen to the next. Accepting an invitation unmounts its screen at once (the app goes to
   « loading », then to the sign-in screen if signing in fails): the reason would be lost with the screen, so it waits
   here and the sign-in screen shows it. */
import { signal } from '@preact/signals';

export const gateNotice = signal<string | null>(null);
