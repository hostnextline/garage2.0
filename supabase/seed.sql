-- The garage's own starting data, loaded once on the real project (safe to run again: nothing is duplicated).
-- Taken from the old app (prices, hours, trucks, tax numbers, rights). The durations of the services are first
-- estimates: the owner checks them in Réglages, Services et prix.

-- ---------- the business ----------
update public.settings set
  company = company || jsonb_build_object(
    'name', 'Mécanique Mobile H.I.S',
    'legal_name', 'Mécanique Mobile H.I.S',
    'phone', '438 901-6606',
    'email', 'host.nextline@gmail.com',
    'address', '8255 av. Mountain Sights, Montréal, QC H4P 2B5',
    'tps_no', '775958648 RT0001',
    'tvq_no', '1234321141 TQ0001',
    'footer_fr', 'Merci de votre confiance !',
    'footer_en', 'Thank you for your trust!'),
  billing = billing || jsonb_build_object('invoice_prefix', 'F-', 'pad', 4, 'due_days', 0, 'hourly_cents', 11500,
    'travel', jsonb_build_object('cents', 0, 'free_over_cents', null)),
  taxes = '{"enabled": true, "tps": 0.05, "tvq": 0.09975}'::jsonb,
  -- the rights set in the old app: the office doesn't see the treasury; a mechanic books, doesn't see the
  -- garage's numbers, changes the hours; the treasurer sees the agenda and corrects invoices
  role_rights = '{"office": {"treasury": false}, "mechanic": {"book": true, "money": false, "hours": true}, "treasurer": {"agenda": true, "edit_invoices": true}}'::jsonb,
  appearance = '{"theme": "his", "mode": "auto"}'::jsonb
where id = 1;

-- ---------- trucks (drivers are set when Saleh and Adam activate their access, or in Horaires) ----------
insert into public.trucks (id, name, active, color, sort) values
  ('7c1a0000-0000-4000-8000-000000000001', 'Camion Complet', true, '#D3000E', 1),
  ('7c1a0000-0000-4000-8000-000000000002', 'Voiture', true, '#2F6FD0', 2),
  ('7c1a0000-0000-4000-8000-000000000003', 'Camion 3', false, '#1F8A53', 3)
on conflict (id) do nothing;

-- the usual week (Sunday = 0): Camion Complet keeps the old garage hours, Voiture works Wednesday and Thursday
insert into public.truck_week (truck_id, dow, ranges)
select '7c1a0000-0000-4000-8000-000000000001'::uuid, d, r::jsonb from (values
  (0, '[[540,1140]]'), (1, '[]'), (2, '[]'), (3, '[[540,1140]]'), (4, '[[540,1140]]'), (5, '[[930,1200]]'), (6, '[[540,1140]]')
) v(d, r)
where not exists (select 1 from public.truck_week w where w.truck_id = '7c1a0000-0000-4000-8000-000000000001' and w.dow = v.d and w.deleted_at is null);
insert into public.truck_week (truck_id, dow, ranges)
select '7c1a0000-0000-4000-8000-000000000002'::uuid, d, r::jsonb from (values
  (0, '[]'), (1, '[]'), (2, '[]'), (3, '[[540,1200]]'), (4, '[[540,1200]]'), (5, '[]'), (6, '[]')
) v(d, r)
where not exists (select 1 from public.truck_week w where w.truck_id = '7c1a0000-0000-4000-8000-000000000002' and w.dow = v.d and w.deleted_at is null);
-- a date already changed in the old app: Friday November 6, 3 p.m. to 8 p.m.
insert into public.truck_days (truck_id, day, ranges, note)
select '7c1a0000-0000-4000-8000-000000000001'::uuid, date '2026-11-06', '[[900,1200]]'::jsonb, 'Repris de l’ancienne app'
where date '2026-11-06' >= public.local_today()
  and not exists (select 1 from public.truck_days d where d.truck_id = '7c1a0000-0000-4000-8000-000000000001' and d.day = date '2026-11-06' and d.deleted_at is null);

-- ---------- the price list (the sign's prices; durations to check) ----------
insert into public.services (id, name_fr, name_en, category, price_cents, duration_min, taxable, is_promo, includes, active, sort) values
  ('5e7a0000-0000-4000-8000-000000000001', 'Changement d’huile (5 L)', 'Oil change (5 L)', 'entretien', 8000, 45, true, false,
     '[{"fr": "Jusqu’à 5 L d’huile", "en": "Up to 5 L of oil"}, {"fr": "Filtre à huile", "en": "Oil filter"}]'::jsonb, true, 10),
  ('5e7a0000-0000-4000-8000-000000000002', 'Changement de pneus (déjà montés)', 'Tire change (mounted)', 'pneus', 6000, 45, true, false, '[]'::jsonb, true, 20),
  ('5e7a0000-0000-4000-8000-000000000003', 'Pneus : montage et changement (15, 16, 17 po)', 'Tires: mounting and change (15, 16, 17 in)', 'pneus', 8000, 60, true, false,
     '[{"fr": "Montage et équilibrage", "en": "Mounting and balancing"}]'::jsonb, true, 21),
  ('5e7a0000-0000-4000-8000-000000000004', 'Pneus : montage et changement (18, 19 po)', 'Tires: mounting and change (18, 19 in)', 'pneus', 9000, 60, true, false,
     '[{"fr": "Montage et équilibrage", "en": "Mounting and balancing"}]'::jsonb, true, 22),
  ('5e7a0000-0000-4000-8000-000000000005', 'Pneus : montage et changement (20 po et plus)', 'Tires: mounting and change (20 in and up)', 'pneus', 10000, 75, true, false,
     '[{"fr": "Montage et équilibrage", "en": "Mounting and balancing"}]'::jsonb, true, 23),
  ('5e7a0000-0000-4000-8000-000000000006', 'Diagnostic (30 min)', 'Diagnostic (30 min)', 'diagnostic', 6000, 30, true, false, '[]'::jsonb, true, 30),
  ('5e7a0000-0000-4000-8000-000000000007', 'Diagnostic (1 h)', 'Diagnostic (1 h)', 'diagnostic', 12000, 60, true, false, '[]'::jsonb, true, 31),
  ('5e7a0000-0000-4000-8000-000000000008', 'Inspection', 'Inspection', 'inspection', 10000, 60, true, false, '[]'::jsonb, true, 40),
  ('5e7a0000-0000-4000-8000-000000000009', 'Top up des liquides', 'Fluid top-up', 'entretien', 6000, 20, true, false, '[]'::jsonb, true, 11),
  ('5e7a0000-0000-4000-8000-000000000010', 'Promo : pneus non montés + huile + inspection', 'Promo: unmounted tires + oil + inspection', 'promo', 19999, 120, true, true,
     '[{"fr": "Changement de pneus non montés (montage et équilibrage)", "en": "Change of unmounted tires (mounting and balancing)"}, {"fr": "Changement d’huile et filtre", "en": "Oil and filter change"}, {"fr": "Inspection multipoints", "en": "Multi-point inspection"}, {"fr": "Top up des liquides", "en": "Fluid top-up"}]'::jsonb, true, 1),
  ('5e7a0000-0000-4000-8000-000000000011', 'Promo : pneus montés + huile', 'Promo: mounted tires + oil', 'promo', 11999, 75, true, true,
     '[{"fr": "Changement de pneus montés", "en": "Change of mounted tires"}, {"fr": "Changement d’huile et filtre", "en": "Oil and filter change"}]'::jsonb, true, 2)
on conflict (id) do nothing;
