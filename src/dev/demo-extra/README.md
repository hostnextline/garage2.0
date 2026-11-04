Each screen section can add demo data or pretend server operations here (dev only), one file per section:
`src/dev/demo-extra/<section>.ts`, for example:

```ts
import { registerRpc, registerFn, put, find, rows, refuse } from '../fake-server';
export function load() { put('quotes', { id: 'q-9', ... }); }      // optional: more demo rows
registerRpc('my_rpc', (args) => ({ ok: true, rows: rows({ jobs: [ ... ] }) }));
registerFn('notify', (body) => ({ ok: true, status: 'sent', message: '…' }));
```
