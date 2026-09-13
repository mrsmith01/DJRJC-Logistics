-- 20260913120000_trim_loads_schema_for_production.sql
--
-- Built against a real Amazon Relay Trip History export (not the Foundation
-- plan's guessed column layout): the CSV never provides city/state/zip for
-- either stop, and the owner scoped production `loads` fields down to
-- id/status/stops/rate/driver. This drops everything else `loads` doesn't
-- need, and adds the 'cancelled' status the real export requires (cancelled
-- trips can still carry a real settled rate, which the owner wants kept).

alter type public.load_status add value 'cancelled';

alter table public.loads
  drop column pickup_city,
  drop column pickup_state,
  drop column pickup_zip,
  drop column delivery_city,
  drop column delivery_state,
  drop column delivery_zip,
  drop column equipment_type,
  drop column duration_minutes,
  drop column rate_type,
  drop column notes,
  drop column truck_id,
  drop column source;

drop type public.load_source;

-- Rewritten to only diff columns that still exist; the previous version
-- referenced every column dropped above.
create or replace function private.enforce_driver_load_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_owner() or (select auth.uid()) is null then
    return new;
  end if;

  if new.driver_id is distinct from old.driver_id
     or new.external_load_id is distinct from old.external_load_id
     or new.pickup_facility_code is distinct from old.pickup_facility_code
     or new.pickup_datetime is distinct from old.pickup_datetime
     or new.delivery_facility_code is distinct from old.delivery_facility_code
     or new.delivery_datetime is distinct from old.delivery_datetime
     or new.distance_miles is distinct from old.distance_miles
     or new.rate_total is distinct from old.rate_total
     or new.rate_per_mile is distinct from old.rate_per_mile
     or new.assigned_driver_name is distinct from old.assigned_driver_name
  then
    raise exception 'drivers may only update status on their own loads';
  end if;

  return new;
end;
$$;
