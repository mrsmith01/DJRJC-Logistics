-- 20260914000000_add_truck_driver_assignment.sql
--
-- Supports the admin dashboard's "assign truck to driver" capability.
-- There was previously no way to record which driver is currently
-- operating a given truck.

alter table public.trucks
  add column driver_id uuid references public.profiles (id) on delete set null;

create index trucks_driver_id_idx on public.trucks (driver_id);
