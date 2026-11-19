Each screen section can add demo data or pretend server operations here (dev only), one file per section:
`src/dev/demo-extra/<section>.ts`, for example:

```ts
import { registerRpc, registerFn, put, find, rows, refuse } from '../fake-server';
import { can, need } from '../demo-rules';
export function load() {
  put('quotes', { id: 'q-9', ... });                                   // optional: more demo rows
  registerRpc('quote_send', (args) => {                                // the name the app calls
    need(can('book'), 'Tu ne peux pas envoyer ce devis.');             // the database's right, in its words
    return { ok: true, rows: rows({ quotes: [find('quotes', args.p_quote)!] }) };
  });
}
```

Register your pretend operations inside `load()`: they win over the core's (`src/dev/demo-rpc.ts` registers its own
only when no section did). One copy per operation. An operation the app calls and the demo does not know answers like
a database without that function (404 PGRST202), and `demo-server.test.ts` fails until the demo has it. Who is on
screen and what they may read or do: `src/dev/demo-rules.ts` (the database's row rules and rights).
