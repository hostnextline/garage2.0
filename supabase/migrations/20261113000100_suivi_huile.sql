-- Part 24 sedecies: « Rappels d’huile » (#/oil): the cars due for an oil change, so the owner or the office calls their owner
-- (6 months after an oil change, 3 months after a visit without one; worked out by the app from the finished visits and from the
-- date the customer gave).
--   vehicles.last_oil_on         the car's last oil change as the customer said it when the car was added (done elsewhere), or null.
--                                The app takes the latest of this day and our own visits with an oil change.
--   vehicles.oil_followup        what was said at the last follow-up call for this car, or null:
--                                { at, by, again_on } = call back that day; { at, by, stop: true } = do not call for this car any more.
--                                A visit finished after `at` makes it old (the app no longer reads it). A direct change, like the rest
--                                of the car's file (the vehicles_upd policy decides who).
alter table public.vehicles add column if not exists oil_followup jsonb
  check (oil_followup is null or jsonb_typeof(oil_followup) = 'object');
alter table public.vehicles add column if not exists last_oil_on date;
