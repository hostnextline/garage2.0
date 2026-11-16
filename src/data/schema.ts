/* The tables this device keeps a copy of (they are listed in the same order as the database migrations: parents
   first). Which rows of them a person still sees is checked on every table (reconcile.ts). */
export const SYNCED = [
  'settings', 'staff', 'trucks', 'truck_week', 'truck_days', 'services', 'service_parts', 'inventory_items', 'engine_specs',
  'customers', 'customer_notes', 'vehicles', 'jobs', 'job_items', 'quotes', 'invoices', 'payments', 'expenses', 'inventory_moves',
  'shifts', 'positions', 'trips', 'messages'
] as const;
export type TableName = (typeof SYNCED)[number];
