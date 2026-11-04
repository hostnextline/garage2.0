/* STUB (owner: client page) — the customer's page: #t=<token> (estimate, extra work, invoice, pay) and
   #suivi=<token> (the mechanic on the way). See docs/ARCHITECTURE.md. */
import { render } from 'preact';
import '../ui/styles/tokens.css';
import '../ui/styles/base.css';
import '../ui/styles/components.css';

function ClientApp() { return <main class="page"><h1>Mécanique Mobile H.I.S</h1></main>; }
render(<ClientApp />, document.getElementById('client')!);
