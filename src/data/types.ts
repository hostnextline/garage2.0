/* Rows as the database sends them (see supabase/migrations). Money in cents, times in minutes after midnight,
   days 'YYYY-MM-DD'. Every synced row has id, created_at, updated_at, deleted_at, created_by. */
import type { Row } from './store';
import type { BlockKey, Range } from '../lib/dates';

export type Role = 'owner' | 'office' | 'mechanic' | 'treasurer';
export type Right = 'agenda' | 'book' | 'clients' | 'invoices' | 'edit_invoices' | 'money' | 'treasury' | 'inventory' | 'map' | 'hours' | 'settings';
export const RIGHTS: Right[] = ['agenda', 'book', 'clients', 'invoices', 'edit_invoices', 'money', 'treasury', 'inventory', 'map', 'hours', 'settings'];
export type JobStatus = 'booked' | 'en_route' | 'on_site' | 'done' | 'cancelled' | 'no_show';
export type ItemStatus = 'planned' | 'done' | 'proposed' | 'approved' | 'declined' | 'removed';
export type ItemKind = 'service' | 'part' | 'labour' | 'fee' | 'discount';
export type PayMethod = 'cash' | 'debit' | 'credit' | 'interac' | 'card_online' | 'cheque' | 'other';
export type Lang = 'fr' | 'en';

interface Base extends Row { id: string; created_at?: string; updated_at?: string; deleted_at?: string | null; created_by?: string | null }

export interface Settings extends Row {
  id: string;
  company: { name?: string; legal_name?: string; phone?: string; email?: string; address?: string; website?: string; tps_no?: string; tvq_no?: string; neq?: string; footer_fr?: string; footer_en?: string };
  taxes: { enabled: boolean; tps: number; tvq: number };
  booking: { blocks: { key: BlockKey; start: number; end: number }[]; horizon_days: number; speed_kmh: number; detour: number; stop_min: number;
    unknown_min: number; min_block_min: number; near_km: number; home: { label: string; address: string; lat: number; lng: number };
    /** « Réserver en ligne » (Part 23): the public link client.html#reserver is open */
    web?: { on?: boolean; max_km?: number };
    /** « Retour à la Centrale »: the number texted (arrival time, live map) when a mechanic heads back after the last job */
    return_phone?: string | null };
  billing: { invoice_prefix: string; quote_prefix?: string; pad: number; due_days: number; hourly_cents: number | null; travel: { cents: number; free_over_cents: number | null }; goal_cents?: number | null; terms_fr?: string; terms_en?: string };
  messages: { on: Record<string, boolean>; fr: Record<string, string>; en: Record<string, string> };
  role_rights: Partial<Record<Exclude<Role, 'owner'>, Partial<Record<Right, boolean>>>>;
  waiver: { version: string; fr: string; en: string };
  appearance: { theme?: string; mode?: string };
  maps: { provider?: 'photon' | 'tomtom' | 'google'; tomtom_key?: string; google_key?: string; tiles?: string };
  expense_categories: string[];
}
export interface Staff extends Base {
  full_name: string; short_name: string | null; email: string | null; phone: string | null; roles: Role[]; rights: Partial<Record<Right, boolean>>;
  active: boolean; color: string | null; lang: Lang; prefs: Record<string, unknown>; last_seen_at: string | null;
}
/** where one truck leaves from (Part 18); null on the truck: « Départ des camions » (settings.booking.home) */
export interface TruckStart { label: string | null; address: string | null; lat: number; lng: number }
export interface Truck extends Base { name: string; driver_id: string | null; active: boolean; color: string | null; plate: string | null; sort: number; start?: TruckStart | null;
  /** mounts and balances tires (« le camion »); false: « la voiture » (Part 24 terdecies; absent = true) */
  tire_machine?: boolean }
export interface TruckWeek extends Base { truck_id: string; dow: number; ranges: Range[] }
export interface TruckDay extends Base { truck_id: string; day: string; ranges: Range[]; note: string | null }
export interface Customer extends Base {
  first_name: string | null; last_name: string | null; company: string | null; phone: string | null; phone_digits: string | null; email: string | null; lang: Lang;
  address: string | null; unit: string | null; city: string | null; postal_code: string | null; lat: number | null; lng: number | null;
  notes: string | null; card_on_file: boolean; no_shows: number; sms_ok: boolean;
}
export interface CustomerNote extends Base { customer_id: string; body: string; remind_on: string | null; done_at: string | null }
export interface Vehicle extends Base {
  customer_id: string | null; year: number | null; make: string | null; model: string | null; trim: string | null; engine: string | null;
  displacement: number | null; cylinders: number | null; fuel: string | null; drive: string | null; vin: string | null; plate: string | null;
  odometer_km: number | null; color: string | null; tire_size: string | null; spec_key: string | null; notes: string | null;
  /** « Rappels d’huile »: what was said at the last follow-up call for this car (Part 24 sedecies); a newer visit makes it old */
  oil_followup?: OilMark | null;
  /** the last oil change the customer told us about (done elsewhere, or before the app); ours are read from the visits */
  last_oil_on?: string | null;
}
/** `at`: when the call was noted, `by`: who; `again_on`: call back that day; `stop`: do not call for this car any more */
export interface OilMark { at: string; by?: string | null; again_on?: string | null; stop?: boolean }
export interface EngineSpec extends Base { key: string; year: number | null; make: string | null; model: string | null; engine: string | null; data: SpecData; confirmed_by: string | null; confirmed_at: string | null }
export interface SpecData {
  oil_l?: number | null; oil_visc?: string; oil_filter?: string; drain_torque?: string; air_filter?: string; cabin_filter?: string; plugs?: string;
  coolant?: string; trans?: string; brake?: string; tires?: string; pressure?: string; wipers?: string; battery?: string; notes?: string;
  parts?: { name: string; ref?: string; qty?: number; service?: string }[];
}
/** what a service uses that depends on the car (its oil, its filters, its tire size); fixed parts are service_parts */
export type NeedKind = 'oil' | 'oil_filter' | 'air_filter' | 'cabin_filter' | 'wipers' | 'plugs' | 'battery' | 'tires';
export type TireSeason = 'winter' | 'summer' | 'all';
export interface Need { kind: NeedKind; qty?: number; season?: TireSeason | null }
export interface Service extends Base {
  name_fr: string; name_en: string | null; category: string; price_cents: number | null; duration_min: number; taxable: boolean;
  is_promo: boolean; promo_until: string | null; includes: { fr: string; en?: string }[]; active: boolean; sort: number;
  /** needs the tire machine (mounting, balancing): only the truck (Part 24 terdecies) */
  needs_machine?: boolean;
  /** null: guessed from the name (inventory/needs.ts); [] uses nothing that depends on the car */
  needs?: Need[] | null;
}
export interface ServicePart extends Base { service_id: string; item_id: string; qty: number }
export interface InventoryItem extends Base {
  name: string; sku: string | null; category: string | null; unit: string; qty: number; min_qty: number | null; cost_cents: number | null;
  price_cents: number | null; supplier: string | null; notes: string | null; active: boolean;
  /** whose stock: the garage's (on the books) or the Coffre's (bought with the Coffre's money, no taxes); fixed once made */
  pool?: 'garage' | 'coffre';
}
export interface InventoryMove extends Base { item_id: string; delta: number; reason: 'used' | 'restock' | 'adjust' | 'return'; job_id: string | null; note: string | null }
export interface Job extends Base {
  number: number; customer_id: string | null; vehicle_id: string | null; day: string; block: BlockKey; truck_id: string | null; truck_pinned: boolean;
  stop_order: number | null; eta_min: number | null; travel_min: number | null; duration_min: number; status: JobStatus; problem: string | null; notes: string | null;
  address: string | null; unit: string | null; postal_code: string | null; lat: number | null; lng: number | null; card_on_file: boolean;
  lost_cents: number | null; lost_reason: string | null; started_at: string | null; arrived_at: string | null; finished_at: string | null; cancelled_at: string | null;
  /** paid by the « Coffre » (family and friends): no invoice, no taxes (Part 20) */
  coffre_id?: string | null;
  /** the car's km read at this visit (asked at « Je suis arrivé »; Part 24 duodecies) */
  odometer_km?: number | null;
  /** the work needs the tire machine; the vehicle asked when booking ('car' | 'truck', null: the app chooses) */
  needs_machine?: boolean; vehicle_kind?: 'car' | 'truck' | null;
  /** its place in its truck's route chosen by hand (1 = first), or null: the planner decides (Part 21) */
  manual_order?: number | null;
  /** booked « quand même » in a full block: the route goes past the truck's hours (Part 19) */
  forced?: boolean;
  pay_later: boolean; pay_later_reason: string | null; waiver_signed_at: string | null; waiver_signer: string | null; waiver_version: string | null; waiver_attachment: string | null;
  /** signed by the customer online (from the confirmation text) or at the door */
  waiver_via?: 'phone' | 'online' | null;
  estimate_signed_at?: string | null; estimate_signer?: string | null; estimate_attachment?: string | null; estimate_cents?: number | null;
  confirm_sent_at: string | null; source: 'phone' | 'walk_in' | 'quote' | 'web'; quote_id: string | null;
}
export interface JobItem extends Base {
  job_id: string; kind: ItemKind; service_id: string | null; item_id: string | null; description: string; qty: number; unit_cents: number; taxable: boolean;
  duration_min: number | null; status: ItemStatus; answered_at: string | null; answered_via: 'signature' | 'link' | 'verbal' | null; answer_attachment?: string | null; note: string | null; sort: number;
}
export interface QuoteItem { description: string; qty: number; unit_cents: number; taxable: boolean; service_id?: string | null; duration_min?: number | null; kind?: ItemKind }
export interface Quote extends Base {
  number: number; customer_id: string | null; vehicle_id: string | null; vehicle_text: string | null; contact_name: string | null; contact_phone: string | null;
  items: QuoteItem[]; notes: string | null; status: 'open' | 'sent' | 'accepted' | 'declined' | 'converted'; job_id: string | null; lang: Lang; valid_until: string | null;
}
export interface InvoiceLine { description: string; qty: number; unit_cents: number; taxable: boolean; total_cents?: number; kind?: ItemKind; item_id?: string }
export interface Invoice extends Base {
  job_id: string | null; customer_id: string | null; number: number | null; status: 'draft' | 'issued' | 'paid' | 'void'; issued_at: string | null; due_on: string | null;
  lines: InvoiceLine[]; taxes_on: boolean; subtotal_cents: number; taxable_cents: number; tps_cents: number; tvq_cents: number; total_cents: number; paid_cents: number;
  lang: Lang; notes: string | null; sent_at: string | null; voided_at: string | null; void_reason: string | null;
}
export interface Payment extends Base { invoice_id: string | null; job_id: string | null; amount_cents: number; method: PayMethod; paid_at: string; reference: string | null; stripe_session: string | null; note: string | null }
export interface Expense extends Base {
  day: string; vendor: string | null; category: string; description: string | null; subtotal_cents: number; tps_cents: number; tvq_cents: number; total_cents: number;
  method: string | null; truck_id: string | null; receipt_id: string | null; notes: string | null;
}
export interface Shift extends Base { staff_id: string; started_at: string; ended_at: string | null }
export interface Position extends Base { lat: number; lng: number; accuracy_m: number | null; heading: number | null; speed_kmh: number | null; job_id: string | null; at: string }
export interface Trip extends Base {
  /** null for a trip back to the start (kind 'return') */
  job_id: string | null; kind?: 'job' | 'return'; dest_label?: string | null; staff_id: string | null; status: 'active' | 'arrived' | 'cancelled'; started_at: string; ended_at: string | null; eta_at: string | null;
  km: number | null; minutes: number | null; route: [number, number][] | null; dest_lat: number | null; dest_lng: number | null; sms_status: string | null; expires_at: string;
}
export interface Message extends Base { job_id: string | null; customer_id: string | null; staff_id: string | null; kind: string; channel: 'sms' | 'email' | 'web'; to_addr: string | null; body: string | null; status: string; error: string | null }

export interface Access {
  id: string; full_name: string; short_name: string | null; email: string | null; phone: string | null; roles: Role[]; owner: boolean; lang: Lang;
  prefs: Record<string, unknown>; color: string | null; rights: Record<Right, boolean>; trucks: string[];
  /** the card payment link (Stripe) and the automatic texts (GoHighLevel) are switched on */
  card_online?: boolean; texts_online?: boolean;
}
