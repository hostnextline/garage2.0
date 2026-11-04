/* The tables this device keeps a copy of (they are listed in the same order as the database migrations).
   SCOPED tables are the ones where what a person sees can shrink (a job moved to another truck…): the app checks
   from time to time which rows it still sees. */
export const SYNCED = [
  'settings', 'staff', 'trucks', 'truck_week', 'truck_days', 'services', 'service_parts', 'inventory_items', 'engine_specs',
  'customers', 'customer_notes', 'vehicles', 'jobs', 'job_items', 'quotes', 'invoices', 'payments', 'expenses', 'inventory_moves',
  'shifts', 'positions', 'trips', 'messages'
] as const;
export type TableName = (typeof SYNCED)[number];
export const SCOPED: TableName[] = ['customers', 'customer_notes', 'vehicles', 'jobs', 'job_items', 'quotes', 'invoices', 'payments', 'trips', 'messages', 'expenses', 'inventory_moves'];
