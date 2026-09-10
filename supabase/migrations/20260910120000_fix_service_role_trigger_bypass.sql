-- 20260910120000_fix_service_role_trigger_bypass.sql

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
     or new.truck_id is distinct from old.truck_id
     or new.external_load_id is distinct from old.external_load_id
     or new.source is distinct from old.source
     or new.rate_type is distinct from old.rate_type
     or new.pickup_facility_code is distinct from old.pickup_facility_code
     or new.pickup_city is distinct from old.pickup_city
     or new.pickup_state is distinct from old.pickup_state
     or new.pickup_zip is distinct from old.pickup_zip
     or new.pickup_datetime is distinct from old.pickup_datetime
     or new.delivery_facility_code is distinct from old.delivery_facility_code
     or new.delivery_city is distinct from old.delivery_city
     or new.delivery_state is distinct from old.delivery_state
     or new.delivery_zip is distinct from old.delivery_zip
     or new.delivery_datetime is distinct from old.delivery_datetime
     or new.equipment_type is distinct from old.equipment_type
     or new.distance_miles is distinct from old.distance_miles
     or new.duration_minutes is distinct from old.duration_minutes
     or new.rate_total is distinct from old.rate_total
     or new.rate_per_mile is distinct from old.rate_per_mile
     or new.assigned_driver_name is distinct from old.assigned_driver_name
  then
    raise exception 'drivers may only update status and notes on their own loads';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_owner() or (select auth.uid()) is null then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.email is distinct from old.email
  then
    raise exception 'only an owner may change id, role, or email on a profile';
  end if;

  return new;
end;
$$;
