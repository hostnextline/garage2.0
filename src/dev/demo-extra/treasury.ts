/* DEV ONLY — demo rows for the treasury, the inventory and the dashboard (owner: the treasury section).
   Loaded by every section's demo: small, and it never throws. */
import { put, find } from '../fake-server';
import { addDays, today } from '../../lib/dates';

const D = (n: number) => addDays(today(), n);
/** a time on a demo day, never in the future (the demo can be opened at any hour) */
const at = (day: string, min: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Math.min(new Date(y, m - 1, d, Math.floor(min / 60), min % 60).getTime(), Date.now() - 3600000)).toISOString();
};
const tax = (s: number) => ({ subtotal_cents: s, tps_cents: Math.round(s * 0.05), tvq_cents: Math.round(s * 0.09975), total_cents: s + Math.round(s * 0.05) + Math.round(s * 0.09975) });
const free = (s: number) => ({ subtotal_cents: s, tps_cents: 0, tvq_cents: 0, total_cents: s });

/** a small drawn receipt (the Lordco one of yesterday), so « Voir le reçu » shows something */
function receiptSvg(day: string): string {
  const lines = [['LORDCO AUTO PARTS', 'start', 700], ['4300 rue Jean-Talon O., Montréal', 'start', 400], [day, 'start', 400],
    ['Plaquettes céramique (2)', 'start', 400], ['Disques avant (2)', 'start', 400], ['SOUS-TOTAL      184,50', 'end', 600],
    ['TPS 5 %            9,23', 'end', 400], ['TVQ 9,975 %       18,40', 'end', 400], ['TOTAL          212,13', 'end', 800], ['TPS/GST 103064577 RT0001', 'start', 400]] as const;
  const text = lines.map(([s, a, w], i) => `<text x="${a === 'end' ? 300 : 20}" y="${40 + i * 30}" text-anchor="${a}" font-weight="${w}">${s}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="360" viewBox="0 0 320 360"><rect width="320" height="360" fill="#fff"/><g font-family="monospace" font-size="15" fill="#111">${text}</g></svg>`;
}

/** what the database trigger does on a stock move (the quantity follows), and who made it */
function followMoves() {
  const w = window as Window & { __stockDemo?: boolean };
  if (w.__stockDemo) return;
  w.__stockDemo = true;
  const prev = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    let fresh: Record<string, unknown>[] | null = null;
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/rest\/v1\/inventory_moves(\?|$)/.test(url) && String(init.method || 'GET').toUpperCase() === 'POST' && typeof init.body === 'string') {
        const body = JSON.parse(init.body) as Record<string, unknown> | Record<string, unknown>[];
        const list = (Array.isArray(body) ? body : [body]).filter((m) => m && typeof m === 'object');
        const who = (globalThis as { __demoUser?: string }).__demoUser || null;
        for (const m of list) if (m.created_by == null) m.created_by = who;
        fresh = list.filter((m) => !find('inventory_moves', m.id));
        init = { ...init, body: JSON.stringify(Array.isArray(body) ? list : list[0]) };
      }
    } catch { fresh = null; }
    const res = await prev(input, init);
    if (fresh && res.ok) {
      try {
        for (const m of fresh) {
          const it = find('inventory_items', m.item_id);
          if (it && !m.deleted_at) put('inventory_items', { id: it.id, qty: Math.round((Number(it.qty) + Number(m.delta)) * 100) / 100 });
        }
      } catch { /* demo only */ }
    }
    return res;
  };
}

export function load() {
  try {
    const ex = (id: string, day: string, vendor: string, category: string, amounts: ReturnType<typeof tax>, method: string, truck: string | null, extra: Record<string, unknown> = {}) =>
      put('expenses', { id, day, vendor, category, description: null, ...amounts, method, truck_id: truck, receipt_id: null, notes: null, ...extra });
    ex('e-x1', D(-3), 'Vidéotron', 'Téléphone et internet', tax(8500), 'credit', null);
    ex('e-x2', D(-3), 'Intact Assurance', 'Assurances', free(21240), 'debit', null, { description: 'Assurance des deux camions, novembre' });
    ex('e-x3', D(-12), 'Ultramar', 'Carburant', tax(6629), 'debit', 't-voiture');
    ex('e-x4', D(-16), 'Pièces d’auto Lordco', 'Pièces', tax(34210), 'credit', 't-complet', { description: 'Plaquettes et disques pour la job de M. Gagnon' });
    ex('e-x5', D(-21), 'Meta (Facebook)', 'Publicité', tax(15000), 'credit', null);
    ex('e-x6', D(-24), 'Tim Hortons', 'Repas', tax(2039), 'debit', 't-complet');
    ex('e-x7', D(-35), 'Banque Nationale', 'Frais bancaires', free(1495), 'other', null);
    ex('e-x8', D(-52), 'Canadian Tire', 'Outils et équipement', tax(45999), 'credit', 't-complet', { description: 'Cric hydraulique 3 tonnes' });
    ex('e-x9', D(-75), 'NAPA Pièces d’auto', 'Pièces', tax(12840), 'debit', 't-voiture');
    const svg = receiptSvg(D(-1));
    put('attachments', { id: 'att-demo-1', kind: 'receipt', mime: 'image/svg+xml', data: btoa(unescape(encodeURIComponent(svg))), bytes: svg.length, width: 320, height: 360 });
    if (find('expenses', 'e-1')) put('expenses', { id: 'e-1', receipt_id: 'att-demo-1', description: 'Plaquettes et disques avant' });

    const mv = (id: string, item: string, delta: number, reason: string, day: string, min: number, who: string, job: string | null, note: string | null) =>
      put('inventory_moves', { id, item_id: item, delta, reason, job_id: job, note, created_by: who, created_at: at(day, min) });
    mv('mv-1', 'i-5w30', 24, 'restock', D(-6), 600, 'u-hassan', null, 'Commande Lordco');
    mv('mv-2', 'i-filtre', 12, 'restock', D(-6), 602, 'u-hassan', null, 'Commande Lordco');
    mv('mv-3', 'i-plaq', -2, 'used', D(-1), 590, 'u-saleh', 'j-y1', 'Job 101');
    mv('mv-4', 'i-5w30', -5, 'used', D(-1), 800, 'u-saleh', 'j-y2', 'Job 102');
    mv('mv-5', 'i-filtre', -1, 'used', D(-1), 800, 'u-saleh', 'j-y2', 'Job 102');
    mv('mv-6', 'i-0w20', -4.2, 'used', D(0), 548, 'u-saleh', 'j-1', 'Job 104');
    mv('mv-7', 'i-filtre', -1, 'used', D(0), 548, 'u-saleh', 'j-1', 'Job 104');
    mv('mv-8', 'i-lave', -2, 'adjust', D(-3), 960, 'u-adam', null, null);
    if (find('inventory_items', 'i-filtre')) put('inventory_items', { id: 'i-filtre', sku: 'PH7317', supplier: 'Lordco' });
    put('inventory_items', { id: 'i-gants', name: 'Gants nitrile (boîte de 100)', sku: null, category: 'Atelier', unit: 'boîte', qty: 3, min_qty: 2, cost_cents: 1899, price_cents: null, supplier: 'Canadian Tire', notes: null, active: true });
    put('inventory_items', { id: 'i-ancien', name: 'Huile 10W-40 (ancienne)', sku: null, category: 'Huile', unit: 'L', qty: 4, min_qty: null, cost_cents: 540, price_cents: 1100, supplier: null, notes: 'On n’en commande plus.', active: false });
    followMoves();
  } catch { /* the demo of every section must open, even if these rows could not be added */ }
}
