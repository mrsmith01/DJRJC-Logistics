-- 20260910000000_harden_role_security.sql
--
-- Fixes from the final whole-branch review of the DJRJC Logistics Foundation
-- plan (already applied to main; this migration hardens the live schema):
--
--   C1: private.handle_new_user() trusted client-supplied raw_user_meta_data
--       ->> 'role', letting anyone self-signup as 'owner'. Now always
--       inserts role = 'driver', ignoring any client-supplied role.
--   C2: profiles_update_self allowed an authenticated user to change their
--       own role/id/email via UPDATE (RLS can't express column-level
--       restrictions). Adds a BEFORE UPDATE trigger that blocks changes to
--       role/id/email unless the caller is already an owner.
--   I2: expenses.driver_id and trucks.owner_id used ON DELETE CASCADE,
--       silently destroying financial/operational history when a profile
--       is deleted. Changed to ON DELETE RESTRICT.

-- ============================================================
-- C1: never trust client-supplied role at signup
-- ============================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, name, email)
  values (
    new.id,
    'driver',
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    new.email
  );
  return new;
end;
$$;

-- ============================================================
-- C2: block self-service role/id/email escalation on profiles
-- ============================================================

create or replace function private.enforce_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_owner() then
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

create trigger profiles_enforce_self_update
  before update on public.profiles
  for each row execute function private.enforce_profile_self_update();

-- ============================================================
-- I2: preserve financial/operational history on profile deletion
-- ============================================================

alter table public.expenses
  drop constraint expenses_driver_id_fkey,
  add constraint expenses_driver_id_fkey
    foreign key (driver_id) references public.profiles (id) on delete restrict;

alter table public.trucks
  drop constraint trucks_owner_id_fkey,
  add constraint trucks_owner_id_fkey
    foreign key (owner_id) references public.profiles (id) on delete restrict;
