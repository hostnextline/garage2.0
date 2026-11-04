-- Part 8: a part taken off a service (kept as deleted, so other phones learn it) can be put back later:
-- only the parts in use must be unique per service.
alter table public.service_parts drop constraint if exists service_parts_service_id_item_id_key;
create unique index if not exists service_parts_one on public.service_parts(service_id, item_id) where deleted_at is null;
