-- Part 7: inviting a mechanic with his truck: when he activates his access, he becomes the driver of that truck
-- (so « Ma journée » shows his jobs right away, without another step for the owner).
alter table public.invitations add column if not exists truck_id uuid references public.trucks(id) on delete set null;
